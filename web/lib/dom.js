// Minimal DOM helpers. Keeps route code declarative without a framework.

/**
 * h("div.foo#bar", {attr}, [children...])
 * h("button", "Click me")
 * h("p", null, "Hello", h("b", null, "world"))
 * Returns a real DOM node.
 */
export function h(spec, attrs, ...children) {
    // Allow h(tag, "text") shorthand.
    if (
        typeof attrs === "string" ||
        typeof attrs === "number" ||
        attrs instanceof Node ||
        Array.isArray(attrs)
    ) {
        children = [attrs, ...children];
        attrs = null;
    }
    const { tag, id, classes } = parseSpec(spec);
    const el = document.createElement(tag);
    if (id) el.id = id;
    if (classes.length) el.className = classes.join(" ");
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v == null || v === false) continue;
            if (k === "class") {
                el.className = (el.className ? el.className + " " : "") + v;
            } else if (k === "style" && typeof v === "object") {
                Object.assign(el.style, v);
            } else if (k.startsWith("on") && typeof v === "function") {
                el.addEventListener(k.slice(2).toLowerCase(), v);
            } else if (k === "dataset" && typeof v === "object") {
                Object.assign(el.dataset, v);
            } else if (v === true) {
                el.setAttribute(k, "");
            } else {
                el.setAttribute(k, String(v));
            }
        }
    }
    appendAll(el, children);
    return el;
}

function appendAll(parent, items) {
    for (const item of items) {
        if (item == null || item === false) continue;
        if (Array.isArray(item)) {
            appendAll(parent, item);
        } else if (item instanceof Node) {
            parent.appendChild(item);
        } else {
            parent.appendChild(document.createTextNode(String(item)));
        }
    }
}

function parseSpec(spec) {
    let tag = "div";
    const classes = [];
    let id = null;
    const m = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+|#[\w-]+)*)$/.exec(spec);
    if (m) {
        if (m[1]) tag = m[1];
        const rest = m[2] || "";
        for (const tok of rest.match(/[.#][\w-]+/g) || []) {
            if (tok[0] === ".") classes.push(tok.slice(1));
            else if (tok[0] === "#") id = tok.slice(1);
        }
    }
    return { tag, id, classes };
}

/** Remove all children of `el`. */
export function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}
