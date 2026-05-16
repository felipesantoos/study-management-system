// Study Management System — SPA entry point.
//
// Loaded by Anki via a <script type="module"> tag injected in mw.web's
// stdHtml body. We build the chrome (sidebar + content area), register
// routes, and start the router.

import { h } from "./lib/dom.js";
import { invoke } from "./lib/bridge.js";
import * as router from "./lib/router.js";

import * as homeRoute from "./routes/home.js";
import * as disciplinesRoute from "./routes/disciplines.js";
import * as unassignedRoute from "./routes/unassigned.js";

const NAV = [
    { path: "/", label: "Home" },
    { path: "/disciplines", label: "Disciplines & Subjects" },
    { path: "/unassigned", label: "Unassigned Notes", badgeId: "smsys-unassigned-badge" },
];

function buildShell() {
    const root = document.getElementById("smsys-root");
    if (!root) return null;

    const sidebar = h(".smsys-sidebar", null,
        h(".smsys-sidebar-title", "Study Manager"),
        ...NAV.map((item) => {
            const children = [item.label];
            if (item.badgeId) {
                children.push(h("span.smsys-badge", { id: item.badgeId, style: { marginLeft: "6px", marginRight: "0" } }));
            }
            return h("a.smsys-nav-item",
                {
                    href: "#" + item.path,
                    dataset: { path: item.path },
                },
                ...children
            );
        })
    );

    const main = h(".smsys-main");
    const content = h("div");
    main.appendChild(content);

    root.appendChild(sidebar);
    root.appendChild(main);

    return { sidebar, content };
}

function highlightActive(sidebar, path) {
    for (const item of sidebar.querySelectorAll(".smsys-nav-item")) {
        item.classList.toggle("is-active", item.dataset.path === path);
    }
}

async function refreshUnassignedCount() {
    try {
        const ids = await invoke("notes.unassigned_ids");
        const badge = document.getElementById("smsys-unassigned-badge");
        if (badge) badge.textContent = String(ids.length);
    } catch (_) {
        // Badge stays empty if the call fails
    }
}

function main() {
    const shell = buildShell();
    if (!shell) return;

    router.register("/", homeRoute.render);
    router.register("/disciplines", disciplinesRoute.render);
    router.register("/unassigned", unassignedRoute.render);

    router.start(shell.content, {
        defaultPath: "/disciplines",
        onChange: (path) => highlightActive(shell.sidebar, path),
    });

    refreshUnassignedCount();
}

main();
