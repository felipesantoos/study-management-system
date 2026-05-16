// Bridge client. Wraps Anki's `pycmd` into a promise-based RPC.
// Python resolves us by calling window.__smsysResolve(id, {data|error}).

const pending = new Map();
let nextId = 0;

// Exposed globally so Python's mw.web.eval(...) can resolve us.
window.__smsysResolve = function (id, payload) {
    const entry = pending.get(String(id));
    if (!entry) return;
    pending.delete(String(id));
    if (payload && "error" in payload) {
        entry.reject(new Error(payload.error));
    } else {
        entry.resolve(payload ? payload.data : undefined);
    }
};

// `pycmd` is installed asynchronously by Anki via QWebChannel after the
// document is ready. Module scripts (type="module") run before that
// completes, so we have to poll for it on first invoke.
let _pycmdReady = null;

function waitForPycmd(timeoutMs = 5000) {
    if (typeof window.pycmd === "function") return Promise.resolve();
    if (_pycmdReady) return _pycmdReady;
    _pycmdReady = new Promise((resolve, reject) => {
        const start = Date.now();
        (function tick() {
            if (typeof window.pycmd === "function") return resolve();
            if (Date.now() - start > timeoutMs) {
                return reject(new Error("pycmd unavailable (timed out waiting for QWebChannel)"));
            }
            setTimeout(tick, 16);
        })();
    });
    return _pycmdReady;
}

/**
 * Invoke a Python-side handler registered via `bridge.register(...)`.
 *
 * @param {string} method  Dotted method name (e.g. "disciplines.list").
 * @param {object} [params]  Keyword args passed as the handler's **kwargs.
 * @returns {Promise<any>}  Resolves with the handler's return value;
 *                          rejects with `Error(message)` on failure.
 */
export async function invoke(method, params = {}) {
    await waitForPycmd();
    const id = String(++nextId);
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        window.pycmd("smsys:" + JSON.stringify({ id, method, params }));
    });
}

/** Convenience: pass-through that surfaces errors via toast. */
export async function safeInvoke(method, params) {
    try {
        return await invoke(method, params);
    } catch (e) {
        toast(e.message || String(e), { error: true });
        throw e;
    }
}

// ----- toast stack (top-right, up to 3, icon-prefixed, slide-in) -----
//
// Public API:
//   toast("Saved.")                       // info (default)
//   toast("Saved.", { type: "success" })  // success (green check)
//   toast("Boom.", { type: "error" })     // error  (red x, 5s)
//   toast("Note.", { type: "info"  })     // info   (brand i)
//
// Back-compat: { error: true } still works and maps to { type: "error" }.
//
// Behaviour contract:
//   - Stacked top-right (newest on top). Cap = 3 visible at a time; the
//     oldest is evicted when a fourth arrives so the user always sees the
//     freshest message.
//   - Auto-dismiss: 3000ms normal, 5000ms for errors.
//   - Slide-in from the right on entry, fade on exit.

const TOAST_MAX = 3;
const TOAST_TTL_NORMAL = 3000;
const TOAST_TTL_ERROR = 5000;

let toastStackEl = null;
const liveToasts = []; // newest at index 0

function ensureToastStack() {
    if (toastStackEl && document.body.contains(toastStackEl)) return toastStackEl;
    toastStackEl = document.createElement("div");
    toastStackEl.className = "smsys-toast-stack";
    toastStackEl.setAttribute("role", "region");
    toastStackEl.setAttribute("aria-label", "Notifications");
    document.body.appendChild(toastStackEl);
    return toastStackEl;
}

function toastIconSvg(type) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "smsys-toast-icon");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = document.createElementNS(NS, "path");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("fill", "none");
    if (type === "success") {
        path.setAttribute("d", "M3 8.5l3 3 7-7");
    } else if (type === "error") {
        path.setAttribute("d", "M4 4l8 8M12 4l-8 8");
    } else {
        // info — vertical line + dot
        path.setAttribute("d", "M8 7v5M8 4.25v.5");
    }
    svg.appendChild(path);
    return svg;
}

function dismissToast(entry) {
    if (entry.dismissed) return;
    entry.dismissed = true;
    clearTimeout(entry.timer);
    entry.el.classList.add("is-leaving");
    const remove = () => {
        entry.el.removeEventListener("transitionend", remove);
        entry.el.remove();
        const i = liveToasts.indexOf(entry);
        if (i >= 0) liveToasts.splice(i, 1);
    };
    entry.el.addEventListener("transitionend", remove);
    // Safety net in case transitionend never fires.
    setTimeout(remove, 400);
}

export function toast(message, opts = {}) {
    const type = opts.type || (opts.error ? "error" : "info");
    const ttl = type === "error" ? TOAST_TTL_ERROR : TOAST_TTL_NORMAL;
    const stack = ensureToastStack();

    const el = document.createElement("div");
    el.className = `smsys-toast smsys-toast--${type}`;
    el.setAttribute("role", type === "error" ? "alert" : "status");
    el.appendChild(toastIconSvg(type));
    const msg = document.createElement("span");
    msg.className = "smsys-toast-msg";
    msg.textContent = message;
    el.appendChild(msg);

    // Insert newest on top so the stack reads chronologically downward.
    stack.insertBefore(el, stack.firstChild);
    const entry = { el, timer: null, dismissed: false };
    liveToasts.unshift(entry);

    // Cap visible toasts at 3 by evicting the oldest.
    while (liveToasts.length > TOAST_MAX) {
        dismissToast(liveToasts[liveToasts.length - 1]);
    }

    // Force layout so the entry animation actually plays.
    void el.offsetWidth;
    el.classList.add("is-visible");

    entry.timer = setTimeout(() => dismissToast(entry), ttl);
    el.addEventListener("click", () => dismissToast(entry));
    return entry;
}
