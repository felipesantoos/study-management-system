// Floating status picker for tree nodes (disciplines, subjects, topics).
// Behaviour contract is documented in FDA-708 design spec §4.

import { h } from "./dom.js";
import { invoke, toast } from "./bridge.js";

const STATUSES = [
    { slug: "backlog",     label: "Backlog",     desc: "Captured but not yet scheduled" },
    { slug: "todo",        label: "To Do",       desc: "Next up — committed to start soon" },
    { slug: "in-progress", label: "In Progress", desc: "Actively creating flashcards" },
    { slug: "blocked",     label: "Blocked",     desc: "Cannot progress — external dependency" },
    { slug: "done",        label: "Done",        desc: "All necessary flashcards created" },
    { slug: "archived",    label: "Archived",    desc: "No longer relevant — retired" },
];

const STATUS_LABELS = Object.fromEntries(STATUSES.map(s => [s.slug, s.label]));

export function statusLabel(slug) {
    return STATUS_LABELS[slug] ?? "Backlog";
}

let activePicker = null;
let pickerInstanceCounter = 0;

export function closeStatusPicker({ restoreFocus = true } = {}) {
    if (!activePicker) return;
    const { pickerEl, triggerEl, onDocMouseDown, onKeydown } = activePicker;
    document.removeEventListener("mousedown", onDocMouseDown, true);
    document.removeEventListener("keydown", onKeydown, true);
    pickerEl.remove();
    activePicker = null;
    if (triggerEl) {
        triggerEl.setAttribute("aria-expanded", "false");
        triggerEl.removeAttribute("aria-controls");
        if (restoreFocus && typeof triggerEl.focus === "function") {
            triggerEl.focus();
        }
    }
}

export function openStatusPicker(triggerEl, nodeId, nodeType) {
    closeStatusPicker();

    const currentStatus = triggerEl.dataset.status || "backlog";
    const options = [];

    const pickerId = `smsys-status-picker-${++pickerInstanceCounter}`;
    // tabindex=-1 lets us move browser focus onto the listbox programmatically
    // so screen readers observe aria-activedescendant updates inside it. The
    // trigger gets aria-controls so AT can follow the relationship.
    const pickerEl = h("div.smsys-status-picker", {
        id: pickerId,
        role: "listbox",
        tabindex: "-1",
        "aria-label": "Change status",
    });

    for (const s of STATUSES) {
        const optionEl = h("button.smsys-status-option", {
            role: "option",
            id: `smsys-status-opt-${s.slug}`,
            "data-status": s.slug,
            "aria-selected": s.slug === currentStatus ? "true" : "false",
            type: "button",
            tabindex: "-1",
            onClick: (e) => {
                e.preventDefault();
                e.stopPropagation();
                applySelection(s.slug);
            },
            onMouseEnter: () => setFocusedOption(optionEl),
        },
            h("span.smsys-status-dot-sm", { "data-status": s.slug }),
            h("span.smsys-status-option-content", null,
                h("span.smsys-status-option-label", s.label),
                h("span.smsys-status-option-desc", s.desc),
            ),
            s.slug === currentStatus
                ? h("span.smsys-status-option-check", "✓")
                : h("span.smsys-status-option-check"),
        );
        if (s.slug === currentStatus) optionEl.classList.add("is-current");
        options.push(optionEl);
        pickerEl.appendChild(optionEl);
    }

    document.body.appendChild(pickerEl);
    positionPicker(pickerEl, triggerEl);
    triggerEl.setAttribute("aria-expanded", "true");
    triggerEl.setAttribute("aria-controls", pickerId);

    const initialIndex = Math.max(0, options.findIndex(o => o.classList.contains("is-current")));
    setFocusedIndex(initialIndex);
    pickerEl.focus();

    function setFocusedOption(el) {
        for (const o of options) o.classList.remove("is-focused");
        el.classList.add("is-focused");
        pickerEl.setAttribute("aria-activedescendant", el.id);
    }

    function setFocusedIndex(idx) {
        const clamped = ((idx % options.length) + options.length) % options.length;
        setFocusedOption(options[clamped]);
    }

    function focusedIndex() {
        return options.findIndex(o => o.classList.contains("is-focused"));
    }

    async function applySelection(newStatus) {
        if (newStatus !== currentStatus) {
            try {
                await invoke("nodes.set_status", {
                    id: nodeId,
                    type: nodeType,
                    status: newStatus,
                });
                triggerEl.dataset.status = newStatus;
                triggerEl.setAttribute(
                    "aria-label",
                    `Status: ${statusLabel(newStatus)} — click to change`,
                );
                triggerEl.setAttribute("title", statusLabel(newStatus));
                // Closed-state CSS targets the row wrapper, not the dot.
                const row = triggerEl.closest(".smsys-tree-row");
                if (row) row.dataset.status = newStatus;
            } catch (e) {
                toast(e.message, { error: true });
                closeStatusPicker();
                return;
            }
        }
        closeStatusPicker();
    }

    function onDocMouseDown(e) {
        if (!pickerEl.contains(e.target)) {
            closeStatusPicker();
        }
    }

    function onKeydown(e) {
        if (!activePicker) return;
        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                setFocusedIndex(focusedIndex() + 1);
                break;
            case "ArrowUp":
                e.preventDefault();
                setFocusedIndex(focusedIndex() - 1);
                break;
            case "Home":
                e.preventDefault();
                setFocusedIndex(0);
                break;
            case "End":
                e.preventDefault();
                setFocusedIndex(options.length - 1);
                break;
            case "Enter":
            case " ":
                e.preventDefault();
                {
                    const idx = focusedIndex();
                    if (idx >= 0) applySelection(STATUSES[idx].slug);
                }
                break;
            case "Escape":
                e.preventDefault();
                closeStatusPicker();
                break;
            case "Tab":
                // Picker holds focus while open. Closing with restoreFocus: true
                // moves focus back to the trigger before the browser processes
                // Tab's default action — so the default then advances from the
                // trigger to the next/prev tabbable element, not from <body>.
                closeStatusPicker({ restoreFocus: true });
                break;
        }
    }

    document.addEventListener("mousedown", onDocMouseDown, true);
    document.addEventListener("keydown", onKeydown, true);

    activePicker = { pickerEl, triggerEl, onDocMouseDown, onKeydown };
}

function positionPicker(pickerEl, triggerEl) {
    // Make sure we know the picker's dimensions before clamping.
    pickerEl.style.left = "0px";
    pickerEl.style.top = "0px";
    const rect = triggerEl.getBoundingClientRect();
    const pickerRect = pickerEl.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = rect.left;
    let top = rect.bottom + 4;

    if (left + pickerRect.width > vw - margin) {
        left = vw - margin - pickerRect.width;
    }
    if (left < margin) left = margin;

    if (top + pickerRect.height > vh - margin) {
        const above = rect.top - pickerRect.height - 4;
        top = above >= margin ? above : Math.max(margin, vh - margin - pickerRect.height);
    }

    pickerEl.style.left = `${left}px`;
    pickerEl.style.top = `${top}px`;
}
