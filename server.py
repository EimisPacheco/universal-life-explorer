#!/usr/bin/env python3
"""Local anatomy viewer server with persistent project settings."""

from __future__ import annotations

import json
import os
import ssl
import urllib.error
import urllib.request
import uuid

# This macOS python.org build ships without a usable system CA store, so
# urllib's default HTTPS verification fails on api.openai.com ("unable to get
# local issuer certificate"). certifi provides the CA bundle; fall back to the
# default context if it is somehow absent.
try:
    import certifi
    _SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except Exception:  # pragma: no cover - defensive
    _SSL_CONTEXT = ssl.create_default_context()
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
SETTINGS_PATH = ROOT / "anatomy-settings.json"
MAX_REQUEST_BYTES = 1_000_000


def _load_openai_env(path: Path) -> None:
    """Load ONLY the OPENAI_* keys from a local .env, so the key placed there
    works without a manual export. PORT/SERVER_PORT and the React/Google/
    Databricks vars in that shared .env are deliberately ignored — this .env is
    shared with another project that sets PORT=3000, which would move the server
    off 8010. Existing environment values always win over the file."""
    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key.startswith("OPENAI_") and key not in os.environ:
                os.environ[key] = value.strip().strip('"').strip("'")
    except OSError:
        pass


_load_openai_env(ROOT / ".env")

# --- OpenAI (voice guide + realtime + anatomy tutor) ---
OPENAI_API_URL = 'https://api.openai.com/v1/responses'
OPENAI_REALTIME_URL = 'https://api.openai.com/v1/realtime/calls'
OPENAI_TEXT_MODEL = os.environ.get('OPENAI_TEXT_MODEL', 'gpt-5.6-luna')
OPENAI_REALTIME_MODEL = os.environ.get('OPENAI_REALTIME_MODEL', 'gpt-realtime-2.1')
REALTIME_VOICE = 'marin'

OPENAI_TIMEOUT_SECONDS = 30

# ---------------------------------------------------------------------------
# Ask-anything tutor
# ---------------------------------------------------------------------------
# The browser never sees the API key: it posts a question to /api/ask and this
# process adds the credential. Set it before starting the server:
#
#     export ANTHROPIC_API_KEY=sk-ant-...
#     python3 server.py
#
# Without the variable the endpoint returns a clear 503 and the UI explains
# what to do, so the rest of the app keeps working untouched.
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
# Haiku is the right tier here: answers are short and spoken aloud, so latency
# matters far more than depth. Swap the id below for a larger model if you would
# rather have richer explanations than fast ones.
TUTOR_MODEL = os.environ.get("ANATOMY_TUTOR_MODEL", "claude-haiku-4-5-20251001")
TUTOR_MAX_TOKENS = 400
TUTOR_TIMEOUT_SECONDS = 30

TUTOR_SYSTEM = (
    "You are a friendly anatomy tutor built into a 3D anatomy app. The user is "
    "holding a 3D model of one of their own organs and asking about it out loud, "
    "so their question arrives via speech recognition and may be slightly "
    "garbled — interpret it charitably.\n\n"
    "Rules:\n"
    "- Answer in 2-4 short sentences. It is read aloud, so be conversational and "
    "avoid lists, markdown, symbols, parentheses and abbreviations.\n"
    "- Stay on the organ named in the context unless the user clearly asks about "
    "something else.\n"
    "- Be accurate. If you are unsure, say so plainly.\n"
    "- You are an educational tool, not a doctor. If the user describes their own "
    "symptoms or asks for diagnosis or treatment, give general educational "
    "information and tell them to speak to a real clinician.\n"
    "- If the question is not about the body at all, say so briefly and steer back."
)


def openai_answer(system: str, user: str, max_output_tokens: int = 400) -> tuple[int, dict[str, Any]]:
    """Relay one prompt to the OpenAI Responses API. Returns (status, payload)."""
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        return 503, {
            "error": "no_key",
            "message": "The AI guide needs an API key.",
            "hint": "Set OPENAI_API_KEY on the server, then restart.",
        }

    body = json.dumps({
        "model": OPENAI_TEXT_MODEL,
        "instructions": system,
        "input": user,
        "max_output_tokens": max_output_tokens,
    }).encode("utf-8")

    request = urllib.request.Request(
        OPENAI_API_URL,
        data=body,
        headers={
            "content-type": "application/json",
            "authorization": "Bearer " + api_key,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=OPENAI_TIMEOUT_SECONDS, context=_SSL_CONTEXT) as response:
            result = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        message = "The AI service rejected the request."
        if exc.code in (401, 403):
            message = "That API key was rejected."
        elif exc.code == 429:
            message = "Rate limited — wait a moment and ask again."
        return 502, {"error": "upstream", "message": message, "detail": detail}
    except urllib.error.URLError as exc:
        return 502, {
            "error": "network",
            "message": "Could not reach the AI service.",
            "detail": str(exc.reason),
        }
    except (TimeoutError, json.JSONDecodeError) as exc:
        return 502, {"error": "upstream", "message": "The AI service timed out.", "detail": str(exc)}

    # Responses API: walk output[] messages and join output_text parts.
    parts: list[str] = []
    for item in result.get("output", []) or []:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for content in item.get("content", []) or []:
            if isinstance(content, dict) and content.get("type") == "output_text":
                parts.append(content.get("text", ""))
    text = "".join(parts).strip()
    if not text:
        # Some responses expose the flattened convenience field.
        fallback = result.get("output_text")
        if isinstance(fallback, str):
            text = fallback.strip()
    if not text:
        return 502, {"error": "empty", "message": "The AI service returned nothing."}
    return 200, {"answer": text}


def ask_tutor(question: str, organ: str, organ_facts: str) -> tuple[int, dict[str, Any]]:
    """Relay one anatomy question to OpenAI. Returns (status, payload)."""
    if not os.environ.get("OPENAI_API_KEY", "").strip():
        return 503, {
            "error": "no_key",
            "message": "The voice tutor needs an API key.",
            "hint": "Set OPENAI_API_KEY on the server, then restart.",
        }

    context = f"The user is currently holding: {organ}."
    if organ_facts:
        context += f"\nWhat the app already tells them about it: {organ_facts}"
    user = f"{context}\n\nTheir question: {question}"
    return openai_answer(TUTOR_SYSTEM, user, TUTOR_MAX_TOKENS)


def guide_answer(question: str, mode: str, target: str, facts: str) -> tuple[int, dict[str, Any]]:
    """Answer one Universal Explorer question. Returns (status, payload)."""
    system = (
        "You are a friendly guide inside a Universal Explorer app. The user explores "
        f"a scene in '{mode}' mode and is physically pointing with their nose at "
        f"'{target}', asking about it out loud, so their question arrives via speech "
        "recognition and may be slightly garbled — interpret it charitably.\n\n"
        "Rules:\n"
        "- Answer in 2 to 4 short sentences. It is read aloud, so be conversational "
        "and avoid lists, markdown, symbols, parentheses and abbreviations.\n"
        f"- Stay on topic for the '{mode}' mode and focus on what they are pointing "
        "at unless they clearly ask about something else.\n"
        "- Be accurate and educational. If you are unsure, say so plainly.\n"
        "- If the question is off topic, say so briefly and steer back."
    )
    context = f"They are pointing at: {target}."
    if facts:
        context += f"\nWhat the app already knows about it: {facts}"
    user = f"{context}\n\nTheir question: {question}"
    return openai_answer(system, user, 400)


def read_settings() -> dict[str, Any]:
    try:
        data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {"version": 1, "pinnedOrgans": {}}


def write_settings(settings: dict[str, Any]) -> None:
    temporary_path = SETTINGS_PATH.with_suffix(".json.tmp")
    temporary_path.write_text(
        json.dumps(settings, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary_path, SETTINGS_PATH)


class AnatomyRequestHandler(SimpleHTTPRequestHandler):
    # The vendored MediaPipe runtime is streamed-compiled by the browser, which
    # requires the exact application/wasm type; the default guess would make
    # WebAssembly.instantiateStreaming reject the response.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".mjs": "text/javascript",
        ".task": "application/octet-stream",
    }

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def read_json_body(self) -> dict[str, Any] | None:
        """Read and parse a JSON request body, or send an error and return None."""
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(HTTPStatus.BAD_REQUEST, {"message": "Invalid content length"})
            return None
        if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
            self.send_json(HTTPStatus.BAD_REQUEST, {"message": "Invalid request size"})
            return None
        try:
            incoming = json.loads(self.rfile.read(content_length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(HTTPStatus.BAD_REQUEST, {"message": "Invalid JSON"})
            return None
        if not isinstance(incoming, dict):
            self.send_json(HTTPStatus.BAD_REQUEST, {"message": "Body must be a JSON object"})
            return None
        return incoming

    def handle_ask(self) -> None:
        incoming = self.read_json_body()
        if incoming is None:
            return
        question = str(incoming.get("question", "")).strip()
        if not question:
            self.send_json(HTTPStatus.BAD_REQUEST, {"message": "No question was heard."})
            return
        # Speech recognition occasionally emits very long runs; cap the relay.
        question = question[:600]
        organ = str(incoming.get("organ", "this organ")).strip()[:80] or "this organ"
        facts = str(incoming.get("facts", "")).strip()[:1200]
        status, payload = ask_tutor(question, organ, facts)
        self.send_json(status, payload)

    def handle_guide(self) -> None:
        incoming = self.read_json_body()
        if incoming is None:
            return
        question = str(incoming.get("question", "")).strip()
        if not question:
            self.send_json(HTTPStatus.BAD_REQUEST, {"message": "No question was heard."})
            return
        question = question[:600]
        target = str(incoming.get("target", "this")).strip()[:80] or "this"
        mode = str(incoming.get("mode", "explore")).strip()[:80] or "explore"
        facts = str(incoming.get("facts", "")).strip()[:1200]
        status, payload = guide_answer(question, mode, target, facts)
        self.send_json(status, payload)

    def handle_session(self) -> None:
        api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {
                "error": "no_key",
                "message": "Voice is not configured",
                "hint": "Set OPENAI_API_KEY on the server, then restart.",
            })
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(HTTPStatus.BAD_REQUEST, {"message": "Invalid content length"})
            return
        if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
            self.send_json(HTTPStatus.BAD_REQUEST, {"message": "Invalid request size"})
            return
        offer_sdp = self.rfile.read(content_length).decode("utf-8", "replace")

        session = json.dumps({
            "type": "realtime",
            "model": OPENAI_REALTIME_MODEL,
            "audio": {"output": {"voice": REALTIME_VOICE}},
        })

        boundary = "----anatomy" + uuid.uuid4().hex
        parts = [
            f"--{boundary}",
            'Content-Disposition: form-data; name="sdp"',
            "",
            offer_sdp,
            f"--{boundary}",
            'Content-Disposition: form-data; name="session"',
            "",
            session,
            f"--{boundary}--",
            "",
        ]
        multipart_body = "\r\n".join(parts).encode("utf-8")

        request = urllib.request.Request(
            OPENAI_REALTIME_URL,
            data=multipart_body,
            headers={
                "authorization": "Bearer " + api_key,
                "content-type": f"multipart/form-data; boundary={boundary}",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=OPENAI_TIMEOUT_SECONDS, context=_SSL_CONTEXT) as response:
                answer_sdp = response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:400]
            self.send_json(HTTPStatus.BAD_GATEWAY, {
                "error": "upstream",
                "message": "Voice session failed",
                "detail": detail,
            })
            return
        except (urllib.error.URLError, TimeoutError) as exc:
            reason = getattr(exc, "reason", exc)
            self.send_json(HTTPStatus.BAD_GATEWAY, {
                "error": "upstream",
                "message": "Voice session failed",
                "detail": str(reason)[:400],
            })
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/sdp")
        self.send_header("Content-Length", str(len(answer_sdp)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(answer_sdp)

    def send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        route = self.path.split("?", 1)[0]
        if route == "/api/settings":
            self.send_json(HTTPStatus.OK, read_settings())
            return
        if route == "/api/guide-status":
            self.send_json(HTTPStatus.OK, {
                "available": bool(os.environ.get("OPENAI_API_KEY", "").strip()),
                "textModel": OPENAI_TEXT_MODEL,
                "realtimeModel": OPENAI_REALTIME_MODEL,
            })
            return
        if route == "/api/tutor-status":
            self.send_json(HTTPStatus.OK, {
                "available": bool(os.environ.get("OPENAI_API_KEY", "").strip()),
                "model": OPENAI_TEXT_MODEL,
            })
            return
        super().do_GET()

    def do_POST(self) -> None:
        route = self.path.split("?", 1)[0]
        if route == "/api/ask":
            self.handle_ask()
            return

        if route == "/api/guide":
            self.handle_guide()
            return
        if route == "/session":
            self.handle_session()
            return
        if route != "/api/settings":
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid content length"})
            return

        if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid request size"})
            return

        try:
            incoming = json.loads(self.rfile.read(content_length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
            return

        if not isinstance(incoming, dict):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Body must be a JSON object"})
            return

        settings = read_settings()
        existing = settings.get("pinnedOrgans")
        if not isinstance(existing, dict):
            existing = {}

        # Merge only — never wipe other pinned organs when one organ is saved.
        if isinstance(incoming.get("pinnedOrgans"), dict):
            for organ_id, placement in incoming["pinnedOrgans"].items():
                if not isinstance(organ_id, str) or not organ_id:
                    continue
                if placement is None:
                    existing.pop(organ_id, None)
                elif isinstance(placement, dict):
                    existing[organ_id] = placement

        # Single-organ update: { "organId": "liver", "placement": {...} }
        organ_id = incoming.get("organId")
        placement = incoming.get("placement")
        if isinstance(organ_id, str) and organ_id:
            if placement is None:
                existing.pop(organ_id, None)
            elif isinstance(placement, dict):
                existing[organ_id] = placement

        # Body shape / bone thickness multipliers, pinned like organ placements.
        existing_shape = settings.get("shape")
        if not isinstance(existing_shape, dict):
            existing_shape = {}
        incoming_shape = incoming.get("shape")
        if isinstance(incoming_shape, dict):
            for key, value in incoming_shape.items():
                if not isinstance(key, str) or not key:
                    continue
                if value is None:
                    existing_shape.pop(key, None)
                elif isinstance(value, (int, float)):
                    existing_shape[key] = float(value)
                elif isinstance(value, list) and all(isinstance(v, (int, float)) for v in value):
                    existing_shape[key] = [float(v) for v in value]

        existing_pose = settings.get("pose")
        if not isinstance(existing_pose, dict):
            existing_pose = {}
        incoming_pose = incoming.get("pose")
        if isinstance(incoming_pose, dict):
            for key in ("armSpread", "armAngle", "legSpread", "legAngle"):
                value = incoming_pose.get(key)
                if isinstance(value, (int, float)):
                    existing_pose[key] = float(value)

        settings["version"] = 1
        settings["pinnedOrgans"] = existing
        settings["pose"] = existing_pose
        settings["shape"] = existing_shape
        write_settings(settings)
        self.send_json(
            HTTPStatus.OK,
            {
                "saved": True,
                "path": SETTINGS_PATH.name,
                "pinnedOrgans": existing,
                "shape": existing_shape,
                "pose": existing_pose,
            },
        )


def main() -> None:
    host = "127.0.0.1"
    port = int(os.environ.get("PORT", "8010"))
    server = ThreadingHTTPServer((host, port), AnatomyRequestHandler)
    print(f"Anatomy viewer: http://{host}:{port}")
    print(f"Persistent settings: {SETTINGS_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
