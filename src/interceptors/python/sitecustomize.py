"""
Python HTTP interceptor — sitecustomize.py

This file is auto-imported by Python at startup when our directory
is prepended to PYTHONPATH. It patches httpx and urllib3 to capture
LLM API calls.

CRITICAL: All code is wrapped in try/except — if we crash,
the user's script MUST still work.
"""

import os
import sys
import json
import time
import threading

# Output file path — set by agent-trace before spawning the process
TRACE_OUTPUT = os.environ.get("AGENT_TRACE_OUTPUT")
if not TRACE_OUTPUT:
    # Not running under agent-trace — do nothing
    pass
else:
    # URL patterns that indicate an LLM API call
    LLM_PATTERNS = [
        "api.openai.com",
        "openai.azure.com",
        "api.anthropic.com",
        "openrouter.ai",
        "api.groq.com",
        "api.mistral.ai",
        "generativelanguage.googleapis.com",
        "aiplatform.googleapis.com",
        "localhost:11434",
        "127.0.0.1:11434",
        "api.cohere.com",
        "/chat/completions",
        "/v1/messages",
    ]

    # Thread lock for file writes
    _write_lock = threading.Lock()

    # Monotonic id + lock so we can correlate a "start" marker with completion.
    _id_lock = threading.Lock()
    _seq = {"n": 0}

    def _next_id():
        with _id_lock:
            _seq["n"] += 1
            return _seq["n"]

    def _is_llm_call(url):
        """Check if a URL looks like an LLM API call."""
        url_str = str(url)
        return any(p in url_str for p in LLM_PATTERNS)

    def _guess_provider(url):
        """Best-effort provider name from a URL host."""
        u = str(url)
        if "openai.azure.com" in u:
            return "azure"
        if "api.openai.com" in u:
            return "openai"
        if "anthropic.com" in u:
            return "anthropic"
        if "openrouter.ai" in u:
            return "openrouter"
        if "groq.com" in u:
            return "groq"
        if "mistral.ai" in u:
            return "mistral"
        if "googleapis.com" in u:
            return "google"
        if "11434" in u:
            return "ollama"
        if "cohere.com" in u:
            return "cohere"
        return "unknown"

    def _extract_model(req_body):
        """Best-effort model name from a parsed request body."""
        try:
            if isinstance(req_body, dict):
                model = req_body.get("model")
                if isinstance(model, str):
                    return model
        except Exception:
            pass
        return None

    def _write_call(call_data):
        """Append a captured call to the NDJSON output file."""
        try:
            line = json.dumps(call_data, default=str) + "\n"
            with _write_lock:
                with open(TRACE_OUTPUT, "a", encoding="utf-8") as f:
                    f.write(line)
                    f.flush()
        except Exception:
            pass  # Non-critical

    def _write_start(call_id, url, req_body, start_ms):
        """Emit a lightweight 'start' marker for the live UI."""
        _write_call({
            "phase": "start",
            "id": call_id,
            "url": str(url),
            "model": _extract_model(req_body),
            "provider": _guess_provider(url),
            "startMs": start_ms,
        })

    def _read_body_nondestructive(response):
        """
        Read a urllib3 response body without consuming it for the caller.

        If the body was already preloaded (preload_content=True), just return it.
        Otherwise read the raw bytes and splice a fresh BytesIO back in as the
        response's file object so the user's code (e.g. requests) can still read
        the full payload. Never raises — returns b"" on any problem.
        """
        try:
            import io as _io

            # Already buffered (preload_content=True) — safe to read directly.
            if getattr(response, "_body", None) is not None:
                data = response._body
                return data if isinstance(data, (bytes, bytearray)) else bytes(data)

            # Streamed body: read raw (undecoded) so we can restore it verbatim.
            raw = response.read(decode_content=False)

            # Restore a readable file object for the downstream consumer.
            response._fp = _io.BytesIO(raw)
            try:
                response._fp_bytes_read = 0
            except Exception:
                pass
            try:
                response.length_remaining = len(raw)
            except Exception:
                pass
            try:
                # urllib3 caches decoded output here; clear so re-reads recompute.
                response._body = None
            except Exception:
                pass
            return raw
        except Exception:
            return b""

    def _safe_json_parse(data):
        """Safely parse a JSON string or bytes."""
        if data is None:
            return None
        try:
            if isinstance(data, bytes):
                data = data.decode("utf-8", errors="replace")
            return json.loads(data)
        except Exception:
            return str(data)[:2000]  # Truncate long non-JSON data

    def _parse_sse_response(body_text):
        """Parse an SSE streaming response into a reconstructed JSON object."""
        usage = None
        model = None
        finish_reason = None
        content_parts = []

        for line in body_text.split("\n"):
            if not line.startswith("data: "):
                continue
            data = line[6:].strip()
            if data == "[DONE]":
                continue

            try:
                parsed = json.loads(data)

                if "model" in parsed and parsed["model"]:
                    model = parsed["model"]

                # OpenAI streaming
                if "choices" in parsed and parsed["choices"]:
                    choice = parsed["choices"][0]
                    delta = choice.get("delta", {})
                    if "content" in delta and delta["content"]:
                        content_parts.append(delta["content"])
                    if choice.get("finish_reason"):
                        finish_reason = choice["finish_reason"]

                if "usage" in parsed and parsed["usage"]:
                    usage = parsed["usage"]

                # Anthropic streaming
                msg_type = parsed.get("type", "")
                if msg_type == "message_start":
                    msg = parsed.get("message", {})
                    if "model" in msg:
                        model = msg["model"]
                    if "usage" in msg:
                        usage = usage or {}
                        usage["input_tokens"] = msg["usage"].get("input_tokens")

                if msg_type == "content_block_delta":
                    delta = parsed.get("delta", {})
                    if "text" in delta:
                        content_parts.append(delta["text"])

                if msg_type == "message_delta":
                    if "usage" in parsed:
                        usage = usage or {}
                        usage["output_tokens"] = parsed["usage"].get("output_tokens")
                    delta = parsed.get("delta", {})
                    if "stop_reason" in delta:
                        finish_reason = delta["stop_reason"]

            except Exception:
                continue

        accumulated = "".join(content_parts)

        if usage:
            return {
                "model": model,
                "usage": usage,
                "choices": [{
                    "message": {"content": accumulated, "role": "assistant"},
                    "finish_reason": finish_reason or "stop",
                }],
                "content": [{"type": "text", "text": accumulated}],
                "stop_reason": finish_reason,
            }

        return {"_raw": "streaming_response", "_warning": "usage_unavailable"}

    # -----------------------------------------------------------------------
    # Lazy patching via background thread
    # -----------------------------------------------------------------------

    _patched_modules = set()

    def _patch_httpx(httpx_module):
        """Patch httpx.Client.send and httpx.AsyncClient.send.

        RACE-SAFETY: the polling thread may observe `httpx` in sys.modules while
        it is still mid-import (its Client/AsyncClient classes not yet defined).
        We therefore (a) require both classes to exist before touching anything,
        and (b) only mark httpx as patched AFTER a send method is successfully
        replaced. Marking-then-failing would permanently skip the real patch.
        """
        if "httpx" in _patched_modules:
            return

        # Bail out if the module isn't fully initialized yet — try again next poll.
        if not hasattr(httpx_module, "Client") or not hasattr(httpx_module, "AsyncClient"):
            return
        if not hasattr(httpx_module.Client, "send"):
            return

        patched_any = False

        try:
            # Patch synchronous client
            original_send = httpx_module.Client.send

            def patched_send(self, request, *args, **kwargs):
                url = str(request.url)
                if not _is_llm_call(url):
                    return original_send(self, request, *args, **kwargs)

                start_ms = int(time.time() * 1000)
                request_body = _safe_json_parse(request.content)
                call_id = _next_id()
                _write_start(call_id, url, request_body, start_ms)

                try:
                    response = original_send(self, request, *args, **kwargs)

                    body_text = response.text
                    content_type = response.headers.get("content-type", "")
                    is_sse = "text/event-stream" in content_type or "data: {" in body_text

                    if is_sse:
                        parsed_response = _parse_sse_response(body_text)
                    else:
                        parsed_response = _safe_json_parse(body_text)

                    _write_call({
                        "phase": "end",
                        "id": call_id,
                        "url": url,
                        "method": str(request.method),
                        "requestBody": request_body,
                        "responseBody": parsed_response,
                        "statusCode": response.status_code,
                        "startMs": start_ms,
                        "endMs": int(time.time() * 1000),
                        "isStreaming": is_sse,
                    })

                    return response
                except Exception:
                    raise  # Re-raise so the user sees the original error

            httpx_module.Client.send = patched_send
            patched_any = True
        except Exception:
            pass  # If patching fails, continue silently

        try:
            # Patch async client
            original_async_send = httpx_module.AsyncClient.send

            async def patched_async_send(self, request, *args, **kwargs):
                url = str(request.url)
                if not _is_llm_call(url):
                    return await original_async_send(self, request, *args, **kwargs)

                start_ms = int(time.time() * 1000)
                request_body = _safe_json_parse(request.content)
                call_id = _next_id()
                _write_start(call_id, url, request_body, start_ms)

                try:
                    response = await original_async_send(self, request, *args, **kwargs)

                    # Check if this is a streaming response
                    try:
                        body_text = response.text
                    except Exception:
                        # Streaming response — capture metadata from request
                        model = _extract_model(request_body)

                        _write_call({
                            "phase": "end",
                            "id": call_id,
                            "url": url,
                            "method": str(request.method),
                            "requestBody": request_body,
                            "responseBody": {
                                "model": model,
                                "_streaming": True,
                            },
                            "statusCode": response.status_code,
                            "startMs": start_ms,
                            "endMs": int(time.time() * 1000),
                            "isStreaming": True,
                        })
                        return response

                    # Non-streaming response — process normally
                    content_type = response.headers.get("content-type", "")
                    is_sse = "text/event-stream" in content_type or "data: {" in body_text

                    if is_sse:
                        parsed_response = _parse_sse_response(body_text)
                    else:
                        parsed_response = _safe_json_parse(body_text)

                    _write_call({
                        "phase": "end",
                        "id": call_id,
                        "url": url,
                        "method": str(request.method),
                        "requestBody": request_body,
                        "responseBody": parsed_response,
                        "statusCode": response.status_code,
                        "startMs": start_ms,
                        "endMs": int(time.time() * 1000),
                        "isStreaming": is_sse,
                    })

                    return response
                except Exception:
                    raise

            httpx_module.AsyncClient.send = patched_async_send
            patched_any = True
        except Exception:
            pass

        # Only mark httpx as done once we actually replaced a send method.
        if patched_any:
            _patched_modules.add("httpx")

    def _patch_urllib3(urllib3_module):
        """Patch urllib3.HTTPConnectionPool.urlopen (race-safe — see _patch_httpx)."""
        if "urllib3" in _patched_modules:
            return
        if not hasattr(urllib3_module, "HTTPConnectionPool"):
            return
        if not hasattr(urllib3_module.HTTPConnectionPool, "urlopen"):
            return

        try:
            original_urlopen = urllib3_module.HTTPConnectionPool.urlopen

            def patched_urlopen(self, method, url, body=None, **kwargs):
                full_url = f"{self.scheme}://{self.host}:{self.port}{url}"
                if not _is_llm_call(full_url):
                    return original_urlopen(self, method, url, body=body, **kwargs)

                start_ms = int(time.time() * 1000)
                request_body = _safe_json_parse(body)
                call_id = _next_id()
                _write_start(call_id, full_url, request_body, start_ms)

                try:
                    response = original_urlopen(self, method, url, body=body, **kwargs)

                    # CRITICAL: read the body WITHOUT consuming it for the caller.
                    # `requests` (and urllib3 stream mode) sets preload_content=False,
                    # so `.data`/`.read()` would drain the socket and the user's
                    # code would then decode an empty body — breaking their script.
                    # We snapshot the raw bytes and splice a fresh BytesIO back in
                    # as the response's file object so downstream reads see the full
                    # payload again.
                    raw = _read_body_nondestructive(response)
                    body_text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw or "")
                    is_sse = "data: {" in body_text

                    if is_sse:
                        parsed_response = _parse_sse_response(body_text)
                    else:
                        parsed_response = _safe_json_parse(body_text)

                    _write_call({
                        "phase": "end",
                        "id": call_id,
                        "url": full_url,
                        "method": method,
                        "requestBody": request_body,
                        "responseBody": parsed_response,
                        "statusCode": response.status,
                        "startMs": start_ms,
                        "endMs": int(time.time() * 1000),
                        "isStreaming": is_sse,
                    })

                    return response
                except Exception:
                    raise

            urllib3_module.HTTPConnectionPool.urlopen = patched_urlopen
            _patched_modules.add("urllib3")
        except Exception:
            pass

    def _try_patch_all():
        """Patch any HTTP libs that are imported and ready. Cheap + idempotent."""
        try:
            if "httpx" in sys.modules and "httpx" not in _patched_modules:
                _patch_httpx(sys.modules["httpx"])
        except Exception:
            pass
        try:
            if "urllib3" in sys.modules and "urllib3" not in _patched_modules:
                _patch_urllib3(sys.modules["urllib3"])
        except Exception:
            pass

    # -----------------------------------------------------------------------
    # Primary mechanism: wrap builtins.__import__.
    #
    # The instant an `import httpx` / `import urllib3` statement finishes, the
    # module is fully initialized and we patch it SYNCHRONOUSLY — before the
    # next line of user code runs. This eliminates both the race (module seen
    # mid-import) and the latency (first calls slipping through) that a pure
    # polling approach suffers from.
    # -----------------------------------------------------------------------

    import builtins

    _original_import = builtins.__import__

    def _patched_import(name, *args, **kwargs):
        module = _original_import(name, *args, **kwargs)
        # Only bother when a relevant top-level package just became available.
        if name.split(".", 1)[0] in ("httpx", "urllib3"):
            _try_patch_all()
        return module

    try:
        builtins.__import__ = _patched_import
    except Exception:
        pass

    # -----------------------------------------------------------------------
    # Fallback: a background poller. Covers imports that bypass builtins
    # (e.g. importlib.import_module → _bootstrap._gcd_import). Stops itself
    # after a bounded window so it never spins for the life of a long process.
    # -----------------------------------------------------------------------

    def _poll_and_patch():
        import time as _time
        deadline = _time.time() + 30.0  # imports almost always happen at startup
        while _time.time() < deadline:
            _try_patch_all()
            if "httpx" in _patched_modules and "urllib3" in _patched_modules:
                return
            _time.sleep(0.05)

    # Patch anything already imported before we installed the hook.
    _try_patch_all()

    # Start the fallback poller.
    _patcher_thread = threading.Thread(target=_poll_and_patch, daemon=True)
    _patcher_thread.start()
