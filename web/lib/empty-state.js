// Illustrated empty-state component (FDA-716).
//
// Usage:
//   import { emptyState, EMPTY_ICONS } from "../lib/empty-state.js";
//   container.appendChild(emptyState({
//       icon:  EMPTY_ICONS.folder,
//       title: "No disciplines yet",
//       sub:   "Group your notes by subject area to organise your study.",
//       cta:   { label: "+ Create first discipline", onClick: ... },
//   }));
//
// Icons are returned from EMPTY_ICONS as functions that build an SVG node on
// demand — each empty state needs its own DOM node, so we can't share one.
// All paths use `stroke="currentColor"` and inherit colour from the parent
// `.smsys-empty-state-icon` rule, so they recolour with light/dark mode.

import { h } from "./dom.js";

const NS = "http://www.w3.org/2000/svg";

function makeSvg(paths, { viewBox = "0 0 64 64" } = {}) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "smsys-empty-state-icon");
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    for (const d of paths) {
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", d);
        svg.appendChild(p);
    }
    return svg;
}

export const EMPTY_ICONS = {
    // Folder + plus — Disciplines (none yet).
    folder: () => makeSvg([
        "M8 18a3 3 0 013-3h11l4 5h22a3 3 0 013 3v23a3 3 0 01-3 3H11a3 3 0 01-3-3V18z",
        "M32 30v14",
        "M25 37h14",
    ]),
    // Checkmark inside circle — all caught up / all assigned.
    check: () => makeSvg([
        "M32 6a26 26 0 100 52 26 26 0 000-52z",
        "M20 33l9 9 16-18",
    ]),
    // Document with question mark — unassigned notes.
    inbox: () => makeSvg([
        "M14 8h26l10 10v34a4 4 0 01-4 4H14a4 4 0 01-4-4V12a4 4 0 014-4z",
        "M40 8v10h10",
        "M26 30c0-3 2-5 5-5s5 2 5 5-2 4-4 5-2 2-2 4",
        "M30 44v.5",
    ]),
    // Magnifying glass — filter / search returned no matches.
    search: () => makeSvg([
        "M28 14a14 14 0 100 28 14 14 0 000-28z",
        "M38 38l12 12",
    ]),
};

export function emptyState({ icon, title, sub, cta = null }) {
    return h(".smsys-empty-state",
        { role: "status" },
        icon ? icon() : null,
        title ? h("p.smsys-empty-state-title", title) : null,
        sub   ? h("p.smsys-empty-state-sub",   sub)   : null,
        cta
            ? h(
                "button.smsys-btn.smsys-btn-primary.smsys-empty-state-cta",
                { type: "button", onClick: cta.onClick },
                cta.label,
            )
            : null,
    );
}
