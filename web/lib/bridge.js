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

// ----- tiny toast helper (used by safeInvoke) -----
let toastEl = null;
let toastTimer = null;

export function toast(message, opts = {}) {
    if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.className = "smsys-toast";
        document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.style.color = opts.error ? "#fff" : "";
    toastEl.style.background = opts.error
        ? "var(--smsys-danger)"
        : "var(--smsys-fg)";
    toastEl.classList.add("is-visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toastEl.classList.remove("is-visible");
    }, 2200);
}
