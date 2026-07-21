"""Imported at startup through PYTHONPATH. Patches httpx, httpx2 and urllib3 and appends each LLM
call as a JSON line to the file in COSTCATCH_OUTPUT, without changing what the program sees."""

import os
import sys

# Must match src/core/constants.ts, which constants.test.ts checks.
ENV_OUTPUT = "COSTCATCH_OUTPUT"
ENV_ACTIVE = "COSTCATCH_ACTIVE"
ENV_MAX_BODY_BYTES = "COSTCATCH_MAX_BODY_BYTES"
ENV_MAX_TRACE_BYTES = "COSTCATCH_MAX_TRACE_BYTES"
DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024
DEFAULT_MAX_TRACE_BYTES = 64 * 1024 * 1024

TRACE_OUTPUT = os.environ.get(ENV_OUTPUT)

# This directory can be on PYTHONPATH twice, and patching twice would count every call twice.
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

    # Keep in sync with the URL patterns in src/providers.
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

    import re

    # Must match NOT_A_MODEL_CALL in src/core/trace-builder.ts. These requests run no model.
    NOT_A_MODEL_CALL = re.compile(
        r"(?:/count_tokens|/input_tokens|:countTokens)/?$|/(?:files|uploads|batches)(?:/|$)|/moderations/?$",
        re.IGNORECASE,
    )

    _write_lock = threading.Lock()
    _id_lock = threading.Lock()

    # Seed ids by pid, because child processes append to the same output file.
    _seq = {"n": (os.getpid() % 100000) * 1000000}
    _bytes_written = {"n": 0, "limit_notified": False}

    def _reseed_after_fork():
        _seq["n"] = (os.getpid() % 100000) * 1000000

    try:
        os.register_at_fork(after_in_child=_reseed_after_fork)
    except Exception:
        pass

    def _next_id():
        with _id_lock:
            _seq["n"] += 1
            return _seq["n"]

    EMBEDDINGS_PATH = re.compile(r"/embeddings/?(?:[?#]|$)")

    def _is_llm_call(url):
        url_str = str(url)
        return any(p in url_str for p in LLM_PATTERNS) or EMBEDDINGS_PATH.search(url_str) is not None

    def _is_model_request(url, method):
        """Every model endpoint is a POST. A GET only lists models or fetches a stored result."""
        try:
            if str(method).upper() != "POST" or not _is_llm_call(url):
                return False
            from urllib.parse import urlsplit

            return not NOT_A_MODEL_CALL.search(urlsplit(str(url)).path)
        except Exception:
            return False

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
            try:
                line = json.dumps(call_data, default=str, allow_nan=False) + "\n"
            except ValueError:
                # Some servers send NaN or Infinity in logprobs, which JSON cannot hold.
                line = json.dumps(_finite(call_data), default=str) + "\n"
            with _write_lock:
                _bytes_written["n"] += len(line.encode("utf-8", errors="replace"))
                with open(TRACE_OUTPUT, "a", encoding="utf-8") as f:
                    f.write(line)
                    f.flush()
        except Exception:
            pass

    def _finite(value, depth=0):
        if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
            return None
        if depth > 64:
            return value
        if isinstance(value, dict):
            return {k: _finite(v, depth + 1) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [_finite(v, depth + 1) for v in value]
        return value

    def _write_start(call_id, url, req_body, start_ms):
        _write_call(
            {
                "phase": "start",
                "id": call_id,
                "url": str(url),
                "model": _extract_model(req_body),
                "provider": _guess_provider(url),
                "startMs": start_ms,
                # Lets costcatch close a call whose process died instead of showing it in flight forever.
                "pid": os.getpid(),
            }
        )

    def _write_end(call_id, url, method, request_body, body_text, status_code, start_ms, truncated=False, aborted=False):
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
        if aborted:
            record["aborted"] = True
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

    def _write_interrupted(call_id, url, method, request_body, status_code, start_ms, exc, message=None):
        _write_call(
            {
                "phase": "end",
                "id": call_id,
                "url": str(url),
                "method": str(method),
                "requestBody": request_body,
                "responseBody": {
                    "error": {
                        "type": "response_interrupted",
                        "message": message or "the connection broke before the response finished: %s" % (exc,),
                    }
                },
                "statusCode": status_code,
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

    def _merge_usage(into, frm):
        """A frame with a null count must not erase a count from an earlier frame."""
        out = dict(into or {})
        for key, value in frm.items():
            if value is not None:
                out[key] = value
        return out

    def _parse_sse_response(body_text):
        usage = None
        model = None
        finish_reason = None
        stream_error = None
        content_parts = []
        tool_blocks = {}
        openai_tools = {}
        tool_calls = []
        last_data = None
        gemini_text = []
        gemini_calls = []
        gemini_last = None

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

            # A stream can still fail after a 200, and without this the call looks successful.
            if isinstance(parsed.get("error"), dict) and (parsed.get("type") == "error" or not parsed.get("choices")):
                stream_error = parsed["error"]

            choices = parsed.get("choices")
            if choices:
                choice = choices[0] or {}
                delta = choice.get("delta") or {}
                if delta.get("content"):
                    content_parts.append(delta["content"])
                for tc in delta.get("tool_calls") or []:
                    if not isinstance(tc, dict):
                        continue
                    idx = tc.get("index")
                    if type(idx) is not int:
                        idx = len(openai_tools)
                    entry = openai_tools.setdefault(idx, {"function": {"name": "", "arguments": ""}})
                    if isinstance(tc.get("id"), str) and tc["id"]:
                        entry["id"] = tc["id"]
                    fn = tc.get("function") or {}
                    if isinstance(fn.get("name"), str):
                        entry["function"]["name"] += fn["name"]
                    if isinstance(fn.get("arguments"), str):
                        entry["function"]["arguments"] += fn["arguments"]
                if choice.get("finish_reason"):
                    finish_reason = choice["finish_reason"]
            if isinstance(parsed.get("usage"), dict):
                # Merge, or Anthropic's message_delta usage would wipe out message_start's counts.
                usage = _merge_usage(usage, parsed["usage"])
            x_groq = parsed.get("x_groq")
            if isinstance(x_groq, dict) and isinstance(x_groq.get("usage"), dict):
                usage = _merge_usage(usage, x_groq["usage"])
            candidates = parsed.get("candidates")
            if isinstance(candidates, list):
                gemini_last = parsed
                first = candidates[0] if candidates and isinstance(candidates[0], dict) else {}
                for part in ((first.get("content") or {}).get("parts") or []):
                    if not isinstance(part, dict):
                        continue
                    if isinstance(part.get("text"), str) and not part.get("thought"):
                        gemini_text.append(part["text"])
                    if part.get("functionCall"):
                        gemini_calls.append({"functionCall": part["functionCall"]})

            msg_type = parsed.get("type", "")
            if msg_type == "message_start":
                msg = parsed.get("message") or {}
                if msg.get("model"):
                    model = msg["model"]
                msg_usage = msg.get("usage") or {}
                if msg_usage:
                    usage = usage or {}
                    usage["input_tokens"] = msg_usage.get("input_tokens")
                    for field in ("cache_read_input_tokens", "cache_creation_input_tokens"):
                        if msg_usage.get(field) is not None:
                            usage[field] = msg_usage[field]
            elif msg_type == "content_block_start":
                block = parsed.get("content_block") or {}
                if block.get("type") == "tool_use":
                    tool_blocks[parsed.get("index")] = {
                        "id": block.get("id") if isinstance(block.get("id"), str) else "",
                        "name": block.get("name") or "",
                        "json": "",
                    }
            elif msg_type == "content_block_delta":
                delta = parsed.get("delta") or {}
                if delta.get("text"):
                    content_parts.append(delta["text"])
                if delta.get("type") == "input_json_delta" and isinstance(delta.get("partial_json"), str):
                    block = tool_blocks.get(parsed.get("index"))
                    if block is not None:
                        block["json"] += delta["partial_json"]
            elif msg_type == "message_delta":
                delta_usage = parsed.get("usage") or {}
                if delta_usage.get("output_tokens") is not None:
                    usage = usage or {}
                    usage["output_tokens"] = delta_usage["output_tokens"]
                delta = parsed.get("delta") or {}
                if delta.get("stop_reason"):
                    finish_reason = delta["stop_reason"]
            # Cohere v2 sends text in content-delta, and usage and the finish reason in message-end.
            elif msg_type == "content-delta":
                text = (((parsed.get("delta") or {}).get("message") or {}).get("content") or {}).get("text")
                if isinstance(text, str):
                    content_parts.append(text)
            elif msg_type == "message-end":
                delta = parsed.get("delta") or {}
                if isinstance(delta.get("usage"), dict):
                    usage = _merge_usage(usage, delta["usage"])
                if delta.get("finish_reason"):
                    finish_reason = delta["finish_reason"]

        accumulated = "".join(content_parts)

        for idx in sorted(openai_tools):
            tool_calls.append(openai_tools[idx])

        # Output tool calls in both OpenAI and Anthropic shapes so each provider parser finds its own.
        anthropic_tools = []
        for block in tool_blocks.values():
            if not block.get("name"):
                continue
            try:
                parsed_input = json.loads(block["json"]) if block["json"] else {}
            except Exception:
                parsed_input = {"_raw": block["json"]}
            ident = {"id": block["id"]} if block.get("id") else {}
            anthropic_tools.append({"type": "tool_use", **ident, "name": block["name"], "input": parsed_input})
            tool_calls.append({**ident, "function": {"name": block["name"], "arguments": block["json"] or "{}"}})

        # Gemini's last chunk has the total usage, but text and calls are spread over all chunks.
        if gemini_last is not None:
            first = gemini_last["candidates"][0] if gemini_last["candidates"] and isinstance(gemini_last["candidates"][0], dict) else {}
            parts = ([{"text": "".join(gemini_text)}] if gemini_text else []) + gemini_calls
            merged = dict(gemini_last)
            merged["candidates"] = [dict(first, content={"role": "model", "parts": parts})]
            if stream_error is not None:
                merged["error"] = stream_error
            return merged

        if usage or accumulated or tool_calls or stream_error is not None:
            message = {"content": accumulated, "role": "assistant"}
            if tool_calls:
                message["tool_calls"] = tool_calls
            folded = {
                "model": model,
                "choices": [
                    {
                        "message": message,
                        # Stays None when the stream was cut short.
                        "finish_reason": finish_reason,
                    }
                ],
                "content": [{"type": "text", "text": accumulated}] + anthropic_tools,
                "stop_reason": finish_reason,
            }
            if usage:
                folded["usage"] = usage
            if stream_error is not None:
                folded["error"] = stream_error
            return folded

        if last_data is not None:
            return last_data
        return {"_raw": "streaming_response", "_warning": "usage_unavailable"}

    # A streamed body has not arrived yet when send() returns, so copy it as the program reads it
    # and record it when it ends, is closed, or the program exits.
    _pending_streams = {}
    _pending_lock = threading.Lock()

    class _StreamCapture:
        __slots__ = ("call_id", "url", "method", "request_body", "start_ms", "status_code",
                     "chunks", "size", "truncated", "flushed", "lock", "headers", "error", "done", "read",
                     "advancing")

        def __init__(self, call_id, url, method, request_body, start_ms, status_code, headers=None):
            self.call_id = call_id
            self.url = url
            self.method = method
            self.request_body = request_body
            self.start_ms = start_ms
            self.status_code = status_code
            self.headers = headers or {}
            self.chunks = []
            self.size = 0
            self.truncated = False
            self.flushed = False
            self.lock = threading.Lock()
            self.error = None
            # done means the body reached its end. read means the program got at least some of it.
            self.done = False
            self.read = False
            # Reads in progress. httpx closes the response inside its iterator when the body ends,
            # so a close during a read must not record yet.
            self.advancing = 0

        def fail(self, exc):
            if self.error is None:
                self.error = exc

        def feed(self, chunk):
            try:
                if chunk:
                    self.read = True
                if self.truncated or not chunk:
                    return
                data = chunk if isinstance(chunk, (bytes, bytearray)) else str(chunk).encode("utf-8", "replace")
                room = MAX_BODY_BYTES - self.size
                if len(data) > room:
                    self.chunks.append(bytes(data[:max(0, room)]))
                    self.size = MAX_BODY_BYTES
                    self.truncated = True
                else:
                    self.chunks.append(bytes(data))
                    self.size += len(data)
            except Exception:
                self.truncated = True

        def flush(self, at_exit=False):
            with self.lock:
                if self.flushed:
                    return
                self.flushed = True
            try:
                if self.error is not None:
                    _write_interrupted(
                        self.call_id, self.url, self.method, self.request_body,
                        self.status_code, self.start_ms, self.error,
                    )
                    return
                if at_exit and self.read and not self.done:
                    # The program exited mid-read, so the reply was cut short but may still be billed.
                    _write_interrupted(
                        self.call_id, self.url, self.method, self.request_body,
                        self.status_code, self.start_ms, None,
                        message="the program exited before the response finished",
                    )
                    return
                # The raw iterators give undecoded bytes, so a gzip body has to be decompressed here.
                raw = _decode_for_capture(b"".join(self.chunks), self.headers)
                text = raw.decode("utf-8", errors="replace")
                _write_end(
                    self.call_id, self.url, self.method, self.request_body,
                    text, self.status_code, self.start_ms, self.truncated,
                    aborted=not self.done,
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
        with _pending_lock:
            pending = list(_pending_streams.values())
        for capture in pending:
            capture.flush(at_exit=True)

    def _instrument_streaming_response(response, capture):
        _register_pending(capture)

        def wrap_sync(name):
            original = getattr(response, name, None)
            if original is None:
                return
            def wrapper(*args, **kwargs):
                try:
                    chunks = iter(original(*args, **kwargs))
                    while True:
                        capture.advancing += 1
                        try:
                            chunk = next(chunks)
                        except StopIteration:
                            capture.done = True
                            break
                        finally:
                            capture.advancing -= 1
                        capture.feed(chunk)
                        yield chunk
                except GeneratorExit:
                    raise
                except Exception as exc:
                    capture.fail(exc)
                    raise
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
                    chunks = original(*args, **kwargs).__aiter__()
                    while True:
                        capture.advancing += 1
                        try:
                            chunk = await chunks.__anext__()
                        except StopAsyncIteration:
                            capture.done = True
                            break
                        finally:
                            capture.advancing -= 1
                        capture.feed(chunk)
                        yield chunk
                except GeneratorExit:
                    raise
                except Exception as exc:
                    capture.fail(exc)
                    raise
                finally:
                    capture.flush()
            try:
                setattr(response, name, wrapper)
            except Exception:
                pass

        # Wrap only the raw iterators, because iter_bytes calls iter_raw and would capture chunks twice.
        wrap_sync("iter_raw")
        wrap_async("aiter_raw")

        # Record a response that is closed without being read. A close during a read is recorded
        # when that read ends, since only the read knows whether the body finished.
        for close_name, is_async in (("close", False), ("aclose", True)):
            original_close = getattr(response, close_name, None)
            if original_close is None:
                continue
            if is_async:
                async def async_close(*a, _orig=original_close, **kw):
                    try:
                        return await _orig(*a, **kw)
                    finally:
                        if not capture.advancing:
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
                        if not capture.advancing:
                            capture.flush()
                try:
                    setattr(response, close_name, sync_close)
                except Exception:
                    pass

    def _response_already_read(response):
        """True when the body was read, so .text will not raise ResponseNotRead."""
        try:
            if getattr(response, "is_stream_consumed", False):
                return True
            # httpx sets `_content` only after the body has been read.
            return hasattr(response, "_content")
        except Exception:
            return False

    _patched_modules = set()
    # Two threads can import at once, and without the lock both could patch and chain a second wrapper.
    _patch_lock = threading.Lock()

    def _capture_httpx_response(response, call_id, url, method, request_body, start_ms):
        try:
            if _response_already_read(response):
                # Read the bytes instead of .text, because .text caches an encoding on the program's
                # response and a later `r.encoding = ...` then raises.
                content = response.content
                capture_truncated = len(content) > MAX_BODY_BYTES
                body_text = bytes(content[:MAX_BODY_BYTES]).decode("utf-8", errors="replace")
                _write_end(
                    call_id, url, method, request_body, body_text, response.status_code, start_ms,
                    truncated=capture_truncated,
                )
            else:
                capture = _StreamCapture(
                    call_id, url, method, request_body, start_ms, response.status_code,
                    getattr(response, "headers", {}),
                )
                _instrument_streaming_response(response, capture)
        except Exception:
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

    def _patch_httpx(httpx_module, name="httpx"):
        with _patch_lock:
            return _patch_httpx_locked(httpx_module, name)

    def _patch_httpx_locked(httpx_module, name):
        """The import hook can run mid-import, so only mark httpx patched once a send is replaced."""
        if name in _patched_modules:
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
                if not _is_model_request(url, request.method):
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
                    raise

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
                if not _is_model_request(url, request.method):
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
            _patched_modules.add(name)

    def _looks_compressed(raw, encoding):
        """urllib3 decodes the body itself but keeps Content-Encoding, so check the bytes."""
        if not raw:
            return False
        if encoding in ("gzip", "x-gzip"):
            return raw[:2] == b"\x1f\x8b"
        head = raw.lstrip()[:6]
        if head[:1] in (b"{", b"[") or head.startswith((b"data:", b"event:", b":")):
            return False
        if encoding == "deflate":
            # Raw deflate has no header to sniff, so just attempt it.
            return True
        return True

    def _decode_for_capture(raw, headers):
        try:
            encoding = ""
            try:
                encoding = (headers.get("content-encoding") or "").lower().strip()
            except Exception:
                encoding = ""
            if not encoding or not raw:
                return raw
            if not _looks_compressed(raw, encoding):
                return raw
            # Use decompressor objects, because decompress() fails on a body that was cut short.
            if encoding in ("gzip", "x-gzip"):
                import zlib as _zlib
                return _zlib.decompressobj(16 + _zlib.MAX_WBITS).decompress(raw)
            if encoding == "deflate":
                import zlib as _zlib
                for wbits in (_zlib.MAX_WBITS, -_zlib.MAX_WBITS):
                    try:
                        return _zlib.decompressobj(wbits).decompress(raw)
                    except Exception:
                        pass
                return raw
            if encoding == "br":
                try:
                    import brotli as _brotli
                    try:
                        return _brotli.Decompressor().process(raw)
                    except Exception:
                        return _brotli.decompress(raw)
                except Exception:
                    return raw
            if encoding == "zstd":
                try:
                    import zstandard as _zstd
                    return _zstd.ZstdDecompressor().decompressobj().decompress(raw)
                except Exception:
                    return raw
            return raw
        except Exception:
            return b""

    def _tee_urllib3_response(response, call_id, url, method, request_body, start_ms):
        """Capture the body as the program reads it, so stream=True callers are not stalled."""
        headers = getattr(response, "headers", {}) or {}
        capture = _StreamCapture(call_id, url, method, request_body, start_ms, response.status, headers)

        # urllib3 has already read and decoded a preloaded body.
        body = getattr(response, "_body", None)
        if body is not None:
            data = body if isinstance(body, (bytes, bytearray)) else bytes(body)
            capture.feed(data)
            capture.done = True
            capture.flush()
            return

        _register_pending(capture)

        def finish():
            # Decode before truncating, because cut compressed bytes no longer decompress. Clearing
            # the headers stops flush() from decoding again.
            try:
                raw = b"".join(capture.chunks)
                decoded = _decode_for_capture(raw, headers)
                capture.chunks = [decoded[:MAX_BODY_BYTES]]
                capture.headers = {}
                if len(decoded) > MAX_BODY_BYTES:
                    capture.truncated = True
            except Exception:
                pass
            capture.flush()

        def drained():
            # urllib3 stops reading a Content-Length body once it has all of it, with no final empty
            # read, so treat it as done once it is closed and empty.
            try:
                if not getattr(response, "closed", False):
                    return False
                buffered = getattr(response, "_decoded_buffer", None)
                if buffered is not None and len(buffered) > 0:
                    return False
                # urllib3 2.6+ limits how much one read decompresses, and the rest waits in the decoder.
                decoder = getattr(response, "_decoder", None)
                if decoder is not None and getattr(decoder, "has_unconsumed_tail", False):
                    return False
                return True
            except Exception:
                return False

        original_read = response.read
        original_read_chunked = getattr(response, "read_chunked", None)
        original_close = response.close
        # urllib3 closes the response inside a read that is about to fail, so that close waits for
        # the read's result. A close from another thread records at once.
        state = {"reading": 0, "reader": None, "close_pending": False}

        def patched_read(*args, **kwargs):
            state["reading"] += 1
            state["reader"] = threading.get_ident()
            try:
                data = original_read(*args, **kwargs)
            except Exception as exc:
                if not capture.flushed:
                    capture.fail(exc)
                finish()
                raise
            finally:
                state["reading"] -= 1
            try:
                if data:
                    capture.feed(data)
                if not data or not kwargs.get("amt", args[0] if args else None) or drained():
                    capture.done = True
                if capture.done or state["close_pending"]:
                    finish()
            except Exception:
                pass
            return data

        def _flagged(iterable):
            iterator = iter(iterable)
            while True:
                state["reading"] += 1
                state["reader"] = threading.get_ident()
                try:
                    chunk = next(iterator)
                except StopIteration:
                    return
                finally:
                    state["reading"] -= 1
                yield chunk

        def patched_read_chunked(*args, **kwargs):
            try:
                for chunk in _flagged(original_read_chunked(*args, **kwargs)):
                    try:
                        capture.feed(chunk)
                    except Exception:
                        pass
                    yield chunk
                capture.done = True
            except GeneratorExit:
                raise
            except Exception as exc:
                if not capture.flushed:
                    capture.fail(exc)
                raise
            finally:
                finish()

        def patched_close(*args, **kwargs):
            try:
                if state["reading"] and state["reader"] == threading.get_ident():
                    state["close_pending"] = True
                else:
                    finish()
            except Exception:
                pass
            return original_close(*args, **kwargs)

        try:
            # Wrap the low-level readers and not stream(), which calls them and would capture the
            # body twice. Chunked responses skip read(), so read_chunked is wrapped too.
            response.read = patched_read
            if callable(original_read_chunked):
                response.read_chunked = patched_read_chunked
            response.close = patched_close
        except Exception:
            capture.flush()

    def _patch_urllib3(urllib3_module):
        with _patch_lock:
            return _patch_urllib3_locked(urllib3_module)

    def _patch_urllib3_locked(urllib3_module):
        """Patching urlopen also covers requests, which is built on urllib3."""
        if "urllib3" in _patched_modules:
            return
        if not hasattr(urllib3_module, "HTTPConnectionPool"):
            return
        if not hasattr(urllib3_module.HTTPConnectionPool, "urlopen"):
            return

        try:
            original_urlopen = urllib3_module.HTTPConnectionPool.urlopen

            # Retries and redirects call urlopen again with positional args, so pass them through
            # unchanged and record only the outermost call.
            _in_urlopen = threading.local()

            def patched_urlopen(self, method, url, *args, **kwargs):
                if getattr(_in_urlopen, "active", False):
                    return original_urlopen(self, method, url, *args, **kwargs)

                try:
                    full_url = "%s://%s:%s%s" % (self.scheme, self.host, self.port, url)
                except Exception:
                    return original_urlopen(self, method, url, *args, **kwargs)

                if not _is_model_request(full_url, method):
                    return original_urlopen(self, method, url, *args, **kwargs)

                body = args[0] if args else kwargs.get("body")
                start_ms = int(time.time() * 1000)
                request_body = _safe_json_parse(body) if isinstance(body, (str, bytes, bytearray)) else None
                call_id = _next_id()
                _write_start(call_id, full_url, request_body, start_ms)

                _in_urlopen.active = True
                try:
                    response = original_urlopen(self, method, url, *args, **kwargs)
                except Exception as exc:
                    _write_transport_error(call_id, full_url, method, request_body, start_ms, exc)
                    raise
                finally:
                    _in_urlopen.active = False

                try:
                    _tee_urllib3_response(response, call_id, full_url, method, request_body, start_ms)
                except Exception:
                    pass

                return response

            urllib3_module.HTTPConnectionPool.urlopen = patched_urlopen
            _patched_modules.add("urllib3")
        except Exception:
            pass

    def _try_patch_all():
        """Runs on every hooked import, so it has to stay cheap."""
        for name in ("httpx", "httpx2"):
            try:
                if name in sys.modules and name not in _patched_modules:
                    _patch_httpx(sys.modules[name], name)
            except Exception:
                pass
        try:
            if "urllib3" in sys.modules and "urllib3" not in _patched_modules:
                _patch_urllib3(sys.modules["urllib3"])
        except Exception:
            pass

    import builtins

    _original_import = builtins.__import__

    def _patched_import(name, *args, **kwargs):
        module = _original_import(name, *args, **kwargs)
        try:
            if name.split(".", 1)[0] in ("httpx", "httpx2", "urllib3", "requests"):
                _try_patch_all()
        except Exception:
            pass
        return module

    try:
        builtins.__import__ = _patched_import
    except Exception:
        pass

    # importlib.import_module skips builtins.__import__, so hook it too. Polling from a thread
    # instead would make fork() in the traced program abort on macOS.
    try:
        import importlib

        _original_import_module = importlib.import_module

        def _patched_import_module(name, package=None):
            module = _original_import_module(name, package)
            try:
                if str(name).lstrip(".").split(".", 1)[0] in ("httpx", "httpx2", "urllib3", "requests"):
                    _try_patch_all()
            except Exception:
                pass
            return module

        importlib.import_module = _patched_import_module
    except Exception:
        pass

    _try_patch_all()


# Run the sitecustomize this file hides (conda, Debian, coverage.py), even when tracing is off,
# so the user's own startup hooks still run.
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
