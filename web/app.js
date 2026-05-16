// Study Management System — SPA entry point.
//
// Loaded by Anki via a <script type="module"> tag injected in mw.web's
// stdHtml body. We build the chrome (sidebar + content area), register
// routes, and start the router.

import { h } from "./lib/dom.js";
import * as router from "./lib/router.js";

import * as homeRoute from "./routes/home.js";
import * as disciplinesRoute from "./routes/disciplines.js";

const NAV = [
    { path: "/", label: "Home" },
    { path: "/disciplines", label: "Disciplines & Subjects" },
];

function buildShell() {
    const root = document.getElementById("smsys-root");
    if (!root) return null;

    const sidebar = h(".smsys-sidebar", null,
        h(".smsys-sidebar-title", "Study Manager"),
        ...NAV.map((item) =>
            h("a.smsys-nav-item",
                {
                    href: "#" + item.path,
                    dataset: { path: item.path },
                },
                item.label
            )
        )
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

function main() {
    const shell = buildShell();
    if (!shell) return;

    router.register("/", homeRoute.render);
    router.register("/disciplines", disciplinesRoute.render);

    router.start(shell.content, {
        defaultPath: "/disciplines",
        onChange: (path) => highlightActive(shell.sidebar, path),
    });
}

main();
