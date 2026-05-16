"""JS <-> Python RPC bridge.

Protocol (over Anki's pycmd):
    JS  → pycmd("smsys:" + JSON.stringify({id, method, params}))
    Py  → mw.web.eval("window.__smsysResolve(id, {data|error})")

Register handlers with the `@register("namespace.method")` decorator.
Handlers receive their `params` as keyword arguments. Their return value
(must be JSON-serializable) becomes `{data}`; raising any exception turns
into `{error: str(exc)}`.
"""
from __future__ import annotations

import json
import traceback
from typing import Any, Callable

from aqt import gui_hooks, mw


_PREFIX = "smsys:"
_handlers: dict[str, Callable[..., Any]] = {}


def register(method: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Register `fn` as the handler for `method` (e.g. "disciplines.list").

    Re-registration overrides; that's intentional, so reloading the addon
    during development doesn't pile up stale handlers.
    """

    def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
        _handlers[method] = fn
        return fn

    return decorator


def _resolve_js(request_id: str, payload: dict[str, Any]) -> None:
    if mw is None or mw.web is None:
        return
    js = (
        f"window.__smsysResolve && window.__smsysResolve("
        f"{json.dumps(request_id)}, {json.dumps(payload)});"
    )
    mw.web.eval(js)


def _dispatch(message_body: str) -> None:
    try:
        payload = json.loads(message_body)
        request_id = str(payload["id"])
        method = str(payload["method"])
        params = payload.get("params") or {}
    except Exception as exc:
        # Malformed request — nothing to resolve against.
        print(f"[smsys] bad bridge message: {exc!r}")
        return

    handler = _handlers.get(method)
    if handler is None:
        _resolve_js(request_id, {"error": f"Unknown method: {method}"})
        return

    try:
        data = handler(**params) if isinstance(params, dict) else handler(params)
    except Exception as exc:
        traceback.print_exc()
        _resolve_js(request_id, {"error": str(exc) or exc.__class__.__name__})
        return

    _resolve_js(request_id, {"data": data})


def _on_js_message(
    handled: tuple[bool, Any], message: str, context: Any
) -> tuple[bool, Any]:
    if not message.startswith(_PREFIX):
        return handled
    _dispatch(message[len(_PREFIX) :])
    return (True, None)


def install() -> None:
    gui_hooks.webview_did_receive_js_message.append(_on_js_message)
