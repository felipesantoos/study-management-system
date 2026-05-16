// Tiny hash-based router. Routes are registered by path; the handler is
// `async (container, params) => void` and gets a fresh empty <div> to
// render into.

const routes = new Map();
let mountEl = null;
let currentPath = null;
let onChange = null;

/** Register a route handler. Pattern is a literal path like "/disciplines". */
export function register(path, handler) {
    routes.set(path, handler);
}

/** Programmatic navigation. */
export function navigate(path) {
    if (path === currentPath) {
        return render();
    }
    window.location.hash = path;
    // hashchange will fire render()
}

/** Initialize the router. mount is the container element. */
export function start(mount, opts = {}) {
    mountEl = mount;
    onChange = opts.onChange || null;
    window.addEventListener("hashchange", render);
    if (!window.location.hash) {
        window.location.hash = opts.defaultPath || "/";
    } else {
        render();
    }
}

export function getCurrentPath() {
    return currentPath;
}

async function render() {
    const path = window.location.hash.replace(/^#/, "") || "/";
    currentPath = path;
    if (onChange) onChange(path);
    const handler = routes.get(path) || routes.get("*");
    mountEl.innerHTML = "";
    if (!handler) {
        mountEl.textContent = `No route registered for ${path}.`;
        return;
    }
    try {
        await handler(mountEl, {});
    } catch (e) {
        mountEl.innerHTML =
            `<div class="smsys-page"><h2>Render error</h2>` +
            `<pre>${escapeHtml(e.stack || e.message)}</pre></div>`;
    }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
}
