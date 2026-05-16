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
    { path: "/", label: "Home", icon: "home" },
    { path: "/disciplines", label: "Disciplines & Topics", icon: "layers" },
    { path: "/unassigned", label: "Unassigned Notes", icon: "inbox", badgeId: "smsys-unassigned-badge" },
];

// Inline SVG icons for the sidebar nav (16×16, stroke-based, currentColor).
function makeSidebarIcon(name) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.classList.add("smsys-nav-icon");

    const shapes = {
        home:   ["M2.5 7L8 2l5.5 5v6.5h-4v-3h-3v3h-4V7z"],
        layers: ["M8 1.5L1.5 5l6.5 3.5 6.5-3.5z", "M1.5 8l6.5 3.5 6.5-3.5", "M1.5 11l6.5 3.5 6.5-3.5"],
        inbox:  ["M2 3.5h12v7.5H2V3.5z", "M2 9h3l1.5 2h3L11 9h3"],
    };
    for (const d of shapes[name] || []) {
        const path = document.createElementNS(NS, "path");
        path.setAttribute("d", d);
        svg.appendChild(path);
    }
    return svg;
}

function buildShell() {
    const root = document.getElementById("smsys-root");
    if (!root) return null;

    const sidebar = h(".smsys-sidebar", null,
        h(".smsys-sidebar-title", "Study Manager"),
        ...NAV.map((item) => {
            const children = [item.label];
            if (item.badgeId) {
                children.push(h("span.smsys-badge", { id: item.badgeId, style: { marginLeft: "auto", marginRight: "0" } }));
            }
            // Use a click handler + router.navigate instead of letting the
            // browser change window.location.hash via <a href="#/…">. Anki's
            // mw.web rejects same-page fragment navigation in
            // AnkiWebView.acceptNavigationRequest (prints "onclick handler
            // needs to return false"), which silently swallowed every
            // sidebar click except the initial default route.
            return h("a.smsys-nav-item",
                {
                    href: "#" + item.path,
                    dataset: { path: item.path },
                    onClick: (e) => {
                        e.preventDefault();
                        router.navigate(item.path);
                    },
                },
                makeSidebarIcon(item.icon),
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
        const count = await invoke("notes.unassigned_count");
        const badge = document.getElementById("smsys-unassigned-badge");
        if (badge) badge.textContent = String(count);
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
