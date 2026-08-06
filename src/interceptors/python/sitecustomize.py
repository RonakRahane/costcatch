"""
Python HTTP interceptor — sitecustomize.py

Auto-imported by CPython at startup because costcatch prepends this directory
to PYTHONPATH. It patches httpx (sync + async) and urllib3 to observe LLM API
calls and append them to the NDJSON file named by COSTCATCH_OUTPUT.

── The one rule ───────────────────────────────────────────────────────────────
This module is PURELY OBSERVATIONAL. If anything here fails, the user's program
must still run, still see byte-identical response bodies, and still exit with
its own status code. Every patched path degrades to "we captured nothing"
rather than "we broke your agent".

── Why chaining matters ───────────────────────────────────────────────────────
`sitecustomize` is a single global name. By placing ours first on PYTHONPATH we
SHADOW any sitecustomize the user's environment already had (conda, Debian,
corporate site-packages, coverage.py's subprocess hook). We therefore locate and
execute the original at the end of this file — otherwise merely tracing a script
would silently disable the user's own startup configuration.

── Contract ───────────────────────────────────────────────────────────────────
The env var names below are duplicated from src/core/constants.ts (this file is
a runtime asset and cannot import TypeScript).
tests/unit/core/constants.test.ts asserts they stay in sync.
"""

import os
import sys

# ── Contract with src/core/constants.ts ───────────────────────────────────────
ENV_OUTPUT = "COSTCATCH_OUTPUT"
ENV_ACTIVE = "COSTCATCH_ACTIVE"
ENV_MAX_BODY_BYTES = "COSTCATCH_MAX_BODY_BYTES"
ENV_MAX_TRACE_BYTES = "COSTCATCH_MAX_TRACE_BYTES"
DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024
DEFAULT_MAX_TRACE_BYTES = 64 * 1024 * 1024

TRACE_OUTPUT = os.environ.get(ENV_OUTPUT)

# Guard against double-installation: this directory can appear twice on
# PYTHONPATH, and re-patching an already-patched send would double-count.
_ALREADY_INSTALLED = getattr(sys, "_costcatch_installed", False)

if TRACE_OUTPUT and not _ALREADY_INSTALLED:
    sys._costcatch_installed = True

    import json
    import time
    import threading
    import atexit

    os.environ[ENV_ACTIVE] = "1"

    def _env_int(name, fallback):
        try:
            value = int(os.environ.get(name, ""))
            return value if value > 0 else fallback
        except Exception:
            return fallback

    MAX_BODY_BYTES = _env_int(ENV_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES)
    MAX_TRACE_BYTES = _env_int(ENV_MAX_TRACE_BYTES, DEFAULT_MAX_TRACE_BYTES)

    # URL substrings that indicate an LLM API call. Mirrors src/providers/*.
    LLM_PATTERNS = (
        "api.openai.com",
        "openai.azure.com",
        "api.anthropic.com",
        "openrouter.ai",
        "api.groq.com",
        "api.mistral.ai",
        "generativelanguage.googleapis.com",
        "aiplatform.googleapis.com",
        ":11434",
        "api.cohere.com",
        "api.cohere.ai",
        "/chat/completions",
        "/v1/messages",
        "/v1/responses",
        ":generateContent",
        ":streamGenerateContent",
    )

    _write_lock = threading.Lock()
    _id_lock = threading.Lock()

    # Seeded from the pid: COSTCATCH_OUTPUT is inherited by child processes, so
    # several traced processes may append to the same file. A plain 1,2,3…
    # counter would collide and pair one process's "start" with another's end.
    _seq = {"n": (os.getpid() % 100000) * 1000000}
    _bytes_written = {"n": 0, "limit_notified": False}

    def _next_id():
        with _id_lock:
            _seq["n"] += 1
            return _seq["n"]

    def _is_llm_call(url):
        url_str = str(url)
        return any(p in url_str for p in LLM_PATTERNS)

    def _guess_provider(url):
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
        if ":11434" in u:
            return "ollama"
        if "cohere.com" in u or "cohere.ai" in u:
            return "cohere"
        return "unknown"

    def _extract_model(req_body):
        try:
            if isinstance(req_body, dict):
                model = req_body.get("model")
                if isinstance(model, str):
                    return model
        except Exception:
            pass
        return None

    def _write_call(call_data):
        """Append one record to the NDJSON output file. Never raises."""
        try:
            if _bytes_written["n"] >= MAX_TRACE_BYTES:
                if _bytes_written["limit_notified"]:
                    return
                _bytes_written["limit_notified"] = True
                call_data = {
                    "phase": "end",
                    "id": _next_id(),
                    "url": "costcatch://capture-limit",
                    "method": "GET",
                    "requestBody": None,
                    "responseBody": {
                        "error": {
                            "message": (
                                "costcatch: capture limit reached (%d bytes); later "
                                "calls in this run were not recorded" % MAX_TRACE_BYTES
                            )
                        }
                    },
                    "statusCode": 0,
                    "startMs": int(time.time() * 1000),
                    "endMs": int(time.time() * 1000),
                    "isStreaming": False,
                }
            line = json.dumps(call_data, default=str) + "\n"
            with _write_lock:
                _bytes_written["n"] += len(line.encode("utf-8", errors="replace"))
                with open(TRACE_OUTPUT, "a", encoding="utf-8") as f:
                    f.write(line)
                    f.flush()
        except Exception:
            pass  # Non-critical — never fail the user's program over a trace write.

    def _write_start(call_id, url, req_body, start_ms):
        _write_call(
            {
                "phase": "start",
                "id": call_id,
                "url": str(url),
                "model": _extract_model(req_body),
                "provider": _guess_provider(url),
                "startMs": start_ms,
            }
        )

    def _write_end(call_id, url, method, request_body, body_text, status_code, start_ms, truncated=False):
        """Parse a captured body and emit the completion record."""
        is_sse = body_text.startswith("data:") or "\ndata: " in body_text
        parsed = _parse_sse_response(body_text) if is_sse else _safe_json_parse(body_text)
        record = {
            "phase": "end",
            "id": call_id,
            "url": str(url),
            "method": str(method),
            "requestBody": request_body,
            "responseBody": parsed,
            "statusCode": status_code,
            "startMs": start_ms,
            "endMs": int(time.time() * 1000),
            "isStreaming": is_sse,
        }
        if truncated:
            record["bodyTruncated"] = True
        _write_call(record)

    def _write_transport_error(call_id, url, method, request_body, start_ms, exc):
        _write_call(
            {
                "phase": "end",
                "id": call_id,
                "url": str(url),
                "method": str(method),
                "requestBody": request_body,
                "responseBody": {"error": {"type": "transport_error", "message": str(exc)}},
                "statusCode": 0,
                "startMs": start_ms,
                "endMs": int(time.time() * 1000),
                "isStreaming": False,
            }
        )

    def _safe_json_parse(data):
        if data is None:
            return None
        try:
            if isinstance(data, (bytes, bytearray)):
                data = bytes(data).decode("utf-8", errors="replace")
            return json.loads(data)
        except Exception:
            text = str(data)
            return text[:4096] + "…[truncated]" if len(text) > 4096 else text

    def _parse_sse_response(body_text):
        """Fold an SSE stream back into one response object our parsers accept."""
        usage = None
        model = None
        finish_reason = None
        content_parts = []
        last_data = None

        for raw_line in body_text.split("\n"):
            line = raw_line.rstrip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data or data == "[DONE]":
                continue

            try:
                parsed = json.loads(data)
            except Exception:
                continue
            if not isinstance(parsed, dict):
                continue
            last_data = parsed

            if parsed.get("model"):
                model = parsed["model"]

            # ── OpenAI-compatible ──
            choices = parsed.get("choices")
            if choices:
                choice = choices[0] or {}
                delta = choice.get("delta") or {}
                if delta.get("content"):
                    content_parts.append(delta["content"])
                if choice.get("finish_reason"):
                    finish_reason = choice["finish_reason"]
            if parsed.get("usage"):
                usage = parsed["usage"]

            # ── Anthropic ──
            msg_type = parsed.get("type", "")
            if msg_type == "message_start":
                msg = parsed.get("message") or {}
                if msg.get("model"):
                    model = msg["model"]
                msg_usage = msg.get("usage") or {}
                if msg_usage:
                    usage = usage or {}
                    usage["input_tokens"] = msg_usage.get("input_tokens")
                    if msg_usage.get("cache_read_input_tokens") is not None:
                        usage["cache_read_input_tokens"] = msg_usage["cache_read_input_tokens"]
            elif msg_type == "content_block_delta":
                delta = parsed.get("delta") or {}
                if delta.get("text"):
                    content_parts.append(delta["text"])
            elif msg_type == "message_delta":
                delta_usage = parsed.get("usage") or {}
                if delta_usage.get("output_tokens") is not None:
                    usage = usage or {}
                    usage["output_tokens"] = delta_usage["output_tokens"]
                delta = parsed.get("delta") or {}
                if delta.get("stop_reason"):
                    finish_reason = delta["stop_reason"]

        accumulated = "".join(content_parts)

        if usage:
            return {
                "model": model,
                "usage": usage,
                "choices": [
                    {
                        "message": {"content": accumulated, "role": "assistant"},
                        "finish_reason": finish_reason or "stop",
                    }
                ],
                "content": [{"type": "text", "text": accumulated}],
                "stop_reason": finish_reason,
            }

        if last_data is not None:
            return last_data
        return {"_raw": "streaming_response", "_warning": "usage_unavailable"}

    # -------------------------------------------------------------------------
    # Streaming tee
    #
    # For a streamed response the body does not exist yet when `send` returns —
    # reading `.text` raises httpx.ResponseNotRead, which is exactly the bug
    # that used to propagate out of the patch and crash the traced agent. We
    # instead wrap the response's byte iterators, accumulate a bounded copy as
    # the USER consumes them, and emit the completion record when the stream is
    # exhausted (or closed, or at interpreter exit).
    # -------------------------------------------------------------------------

    _pending_streams = {}
    _pending_lock = threading.Lock()

    class _StreamCapture:
        __slots__ = ("call_id", "url", "method", "request_body", "start_ms", "status_code",
                     "chunks", "size", "truncated", "flushed", "lock")

        def __init__(self, call_id, url, method, request_body, start_ms, status_code):
            self.call_id = call_id
            self.url = url
            self.method = method
            self.request_body = request_body
            self.start_ms = start_ms
            self.status_code = status_code
            self.chunks = []
            self.size = 0
            self.truncated = False
            self.flushed = False
            self.lock = threading.Lock()

        def feed(self, chunk):
            try:
                if self.truncated or not chunk:
                    return
                data = chunk if isinstance(chunk, (bytes, bytearray)) else str(chunk).encode("utf-8", "replace")
                room = MAX_BODY_BYTES - self.size
                if len(data) >= room:
                    self.chunks.append(bytes(data[:max(0, room)]))
                    self.size = MAX_BODY_BYTES
                    self.truncated = True
                else:
                    self.chunks.append(bytes(data))
                    self.size += len(data)
            except Exception:
                self.truncated = True

        def flush(self):
            with self.lock:
                if self.flushed:
                    return
                self.flushed = True
            try:
                text = b"".join(self.chunks).decode("utf-8", errors="replace")
                _write_end(
                    self.call_id, self.url, self.method, self.request_body,
                    text, self.status_code, self.start_ms, self.truncated,
                )
            except Exception:
                pass
            finally:
                self.chunks = []
                with _pending_lock:
                    _pending_streams.pop(id(self), None)

    def _register_pending(capture):
        with _pending_lock:
            _pending_streams[id(capture)] = capture

    @atexit.register
    def _flush_pending_streams():
        """Emit records for streams the program never fully consumed."""
        with _pending_lock:
            pending = list(_pending_streams.values())
        for capture in pending:
            capture.flush()

    def _instrument_streaming_response(response, capture):
        """
        Tee the response's byte iterators onto `capture`.

        Overrides are set on the INSTANCE, so `iter_lines`/`iter_text` (which the
        OpenAI and Anthropic SDKs use for SSE) resolve to our wrappers through
        normal attribute lookup while every other response is untouched.
        """
        _register_pending(capture)

        def wrap_sync(name):
            original = getattr(response, name, None)
            if original is None:
                return
            def wrapper(*args, **kwargs):
                try:
                    for chunk in original(*args, **kwargs):
                        capture.feed(chunk)
                        yield chunk
                finally:
                    capture.flush()
            try:
                setattr(response, name, wrapper)
            except Exception:
                pass

        def wrap_async(name):
            original = getattr(response, name, None)
            if original is None:
                return
            async def wrapper(*args, **kwargs):
                try:
                    async for chunk in original(*args, **kwargs):
                        capture.feed(chunk)
                        yield chunk
                finally:
                    capture.flush()
            try:
                setattr(response, name, wrapper)
            except Exception:
                pass

        for name in ("iter_bytes", "iter_raw"):
            wrap_sync(name)
        for name in ("aiter_bytes", "aiter_raw"):
            wrap_async(name)

        # A response closed without being iterated still deserves a record.
        for close_name, is_async in (("close", False), ("aclose", True)):
            original_close = getattr(response, close_name, None)
            if original_close is None:
                continue
            if is_async:
                async def async_close(*a, _orig=original_close, **kw):
                    try:
                        return await _orig(*a, **kw)
                    finally:
                        capture.flush()
                try:
                    setattr(response, close_name, async_close)
                except Exception:
                    pass
            else:
                def sync_close(*a, _orig=original_close, **kw):
                    try:
                        return _orig(*a, **kw)
                    finally:
                        capture.flush()
                try:
                    setattr(response, close_name, sync_close)
                except Exception:
                    pass

    def _response_already_read(response):
        """True when `.text` is safe to touch without raising ResponseNotRead."""
        try:
            if getattr(response, "is_stream_consumed", False):
                return True
            # httpx sets `_content` only after the body has been read.
            return hasattr(response, "_content")
        except Exception:
            return False

    # -------------------------------------------------------------------------
    # httpx
    # -------------------------------------------------------------------------

    _patched_modules = set()

    def _capture_httpx_response(response, call_id, url, method, request_body, start_ms):
        """
        Record a completed httpx response.

        Never touches `.text` unless the body is definitely in memory: on a
        streamed response that attribute raises, and the exception used to
        escape the patch and kill the traced program.
        """
        try:
            if _response_already_read(response):
                body_text = response.text
                _write_end(call_id, url, method, request_body, body_text, response.status_code, start_ms)
            else:
                capture = _StreamCapture(call_id, url, method, request_body, start_ms, response.status_code)
                _instrument_streaming_response(response, capture)
        except Exception:
            # Fall back to a metadata-only record rather than losing the call.
            try:
                _write_call(
                    {
                        "phase": "end",
                        "id": call_id,
                        "url": str(url),
                        "method": str(method),
                        "requestBody": request_body,
                        "responseBody": {"model": _extract_model(request_body), "_streaming": True},
                        "statusCode": getattr(response, "status_code", 0),
                        "startMs": start_ms,
                        "endMs": int(time.time() * 1000),
                        "isStreaming": True,
                    }
                )
            except Exception:
                pass

    def _patch_httpx(httpx_module):
        """Patch httpx.Client.send and httpx.AsyncClient.send.

        RACE-SAFETY: the polling thread may observe `httpx` in sys.modules while
        it is still mid-import (Client/AsyncClient not yet defined). We require
        both classes to exist before touching anything, and only mark httpx as
        patched AFTER a send method is successfully replaced — marking-then-
        failing would permanently skip the real patch.
        """
        if "httpx" in _patched_modules:
            return
        if not hasattr(httpx_module, "Client") or not hasattr(httpx_module, "AsyncClient"):
            return
        if not hasattr(httpx_module.Client, "send"):
            return

        patched_any = False

        try:
            original_send = httpx_module.Client.send

            def patched_send(self, request, *args, **kwargs):
                url = str(request.url)
                if not _is_llm_call(url):
                    return original_send(self, request, *args, **kwargs)

                start_ms = int(time.time() * 1000)
                try:
                    request_body = _safe_json_parse(request.content)
                except Exception:
                    request_body = None
                call_id = _next_id()
                _write_start(call_id, url, request_body, start_ms)

                try:
                    response = original_send(self, request, *args, **kwargs)
                except Exception as exc:
                    _write_transport_error(call_id, url, request.method, request_body, start_ms, exc)
                    raise  # the user must see their original error, unchanged

                _capture_httpx_response(response, call_id, url, request.method, request_body, start_ms)
                return response

            httpx_module.Client.send = patched_send
            patched_any = True
        except Exception:
            pass

        try:
            original_async_send = httpx_module.AsyncClient.send

            async def patched_async_send(self, request, *args, **kwargs):
                url = str(request.url)
                if not _is_llm_call(url):
                    return await original_async_send(self, request, *args, **kwargs)

                start_ms = int(time.time() * 1000)
                try:
                    request_body = _safe_json_parse(request.content)
                except Exception:
                    request_body = None
                call_id = _next_id()
                _write_start(call_id, url, request_body, start_ms)

                try:
                    response = await original_async_send(self, request, *args, **kwargs)
                except Exception as exc:
                    _write_transport_error(call_id, url, request.method, request_body, start_ms, exc)
                    raise

                _capture_httpx_response(response, call_id, url, request.method, request_body, start_ms)
                return response

            httpx_module.AsyncClient.send = patched_async_send
            patched_any = True
        except Exception:
            pass

        if patched_any:
            _patched_modules.add("httpx")

    # -------------------------------------------------------------------------
    # urllib3 (covers `requests`)
    # -------------------------------------------------------------------------

    def _decode_for_capture(raw, headers):
        """
        Decompress a COPY of the raw body for our own parsing.

        We deliberately restore the *undecoded* bytes to the user's response so
        their read path is byte-identical to an untraced run. That leaves our
        copy still gzip/deflate/br/zstd encoded, so we undo it here. Unknown or
        unavailable codecs simply yield an unparseable body — never an error.
        """
        try:
            encoding = ""
            try:
                encoding = (headers.get("content-encoding") or "").lower().strip()
            except Exception:
                encoding = ""
            if not encoding or not raw:
                return raw
            if encoding in ("gzip", "x-gzip"):
                import gzip as _gzip
                return _gzip.decompress(raw)
            if encoding == "deflate":
                import zlib as _zlib
                try:
                    return _zlib.decompress(raw)
                except Exception:
                    return _zlib.decompress(raw, -_zlib.MAX_WBITS)
            if encoding == "br":
                try:
                    import brotli as _brotli
                    return _brotli.decompress(raw)
                except Exception:
                    return b""
            if encoding == "zstd":
                try:
                    import zstandard as _zstd
                    return _zstd.ZstdDecompressor().decompressobj().decompress(raw)
                except Exception:
                    return b""
            return raw
        except Exception:
            return b""

    def _read_body_nondestructive(response):
        """
        Snapshot a urllib3 response body without consuming it for the caller.

        `requests` sets preload_content=False, so `.data`/`.read()` here would
        drain the socket and the user's code would then decode an empty body.
        We read the raw (undecoded) bytes and splice a fresh BytesIO back in as
        the response's file object so downstream reads see the full payload.

        Returns (bytes_for_capture, needs_decoding).
        """
        try:
            import io as _io

            # Already buffered (preload_content=True): urllib3 has decoded it.
            body = getattr(response, "_body", None)
            if body is not None:
                data = body if isinstance(body, (bytes, bytearray)) else bytes(body)
                return bytes(data[:MAX_BODY_BYTES]), False

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
            return raw[:MAX_BODY_BYTES], True
        except Exception:
            return b"", False

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
                try:
                    full_url = "%s://%s:%s%s" % (self.scheme, self.host, self.port, url)
                except Exception:
                    return original_urlopen(self, method, url, body=body, **kwargs)

                if not _is_llm_call(full_url):
                    return original_urlopen(self, method, url, body=body, **kwargs)

                start_ms = int(time.time() * 1000)
                request_body = _safe_json_parse(body) if isinstance(body, (str, bytes, bytearray)) else None
                call_id = _next_id()
                _write_start(call_id, full_url, request_body, start_ms)

                try:
                    response = original_urlopen(self, method, url, body=body, **kwargs)
                except Exception as exc:
                    _write_transport_error(call_id, full_url, method, request_body, start_ms, exc)
                    raise

                try:
                    raw, needs_decoding = _read_body_nondestructive(response)
                    if needs_decoding:
                        raw = _decode_for_capture(raw, getattr(response, "headers", {}))
                    body_text = raw.decode("utf-8", errors="replace") if isinstance(raw, (bytes, bytearray)) else str(raw or "")
                    _write_end(call_id, full_url, method, request_body, body_text, response.status, start_ms)
                except Exception:
                    pass  # capture failure must not disturb the user's response

                return response

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

    # -------------------------------------------------------------------------
    # Primary mechanism: wrap builtins.__import__.
    #
    # The instant an `import httpx` / `import urllib3` statement finishes, the
    # module is fully initialized and we patch it SYNCHRONOUSLY — before the
    # next line of user code runs. This eliminates both the race (module seen
    # mid-import) and the latency (first calls slipping through) that a pure
    # polling approach suffers from.
    # -------------------------------------------------------------------------

    import builtins

    _original_import = builtins.__import__

    def _patched_import(name, *args, **kwargs):
        module = _original_import(name, *args, **kwargs)
        try:
            if name.split(".", 1)[0] in ("httpx", "urllib3", "requests"):
                _try_patch_all()
        except Exception:
            pass
        return module

    try:
        builtins.__import__ = _patched_import
    except Exception:
        pass

    # -------------------------------------------------------------------------
    # Fallback: a background poller. Covers imports that bypass builtins
    # (e.g. importlib.import_module → _bootstrap._gcd_import). Stops itself
    # after a bounded window so it never spins for the life of a long process.
    # -------------------------------------------------------------------------

    def _poll_and_patch():
        import time as _time

        deadline = _time.time() + 30.0  # imports almost always happen at startup
        while _time.time() < deadline:
            _try_patch_all()
            if "httpx" in _patched_modules and "urllib3" in _patched_modules:
                return
            _time.sleep(0.05)

    _try_patch_all()
    threading.Thread(target=_poll_and_patch, daemon=True).start()


# -----------------------------------------------------------------------------
# Chain to the sitecustomize we shadowed.
#
# Runs unconditionally — even when costcatch is inactive — so having this
# directory on PYTHONPATH never costs the user their own startup hooks.
# -----------------------------------------------------------------------------

def _chain_original_sitecustomize():
    try:
        import importlib.util

        here = os.path.dirname(os.path.abspath(__file__))
        for entry in list(sys.path):
            try:
                if not entry:
                    continue
                resolved = os.path.abspath(entry)
                if resolved == here:
                    continue
                candidate = os.path.join(resolved, "sitecustomize.py")
                if not os.path.isfile(candidate):
                    continue
                spec = importlib.util.spec_from_file_location("_costcatch_chained_sitecustomize", candidate)
                if spec is None or spec.loader is None:
                    continue
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                return
            except Exception:
                continue
    except Exception:
        pass


_chain_original_sitecustomize()
