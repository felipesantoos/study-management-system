import { h, clear } from "../lib/dom.js";
import { invoke, toast } from "../lib/bridge.js";
import { openStatusPicker, statusLabel } from "../lib/status-picker.js";
import { emptyState, EMPTY_ICONS } from "../lib/empty-state.js";

// Inline SVG icons for action buttons (Lucide-style, 24×24 viewBox displayed
// at 14×14, stroke-based, currentColor). The 24×24 viewBox lets us reuse
// well-tuned Lucide path geometry directly — at 14px display the strokes
// stay readable while the icons keep clean joins, even ends, and consistent
// optical weight across the set.
function makeActionIcon(name) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.style.flexShrink = "0";

    function stroke(d) {
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", d);
        p.setAttribute("fill", "none");
        p.setAttribute("stroke", "currentColor");
        p.setAttribute("stroke-width", "2");
        p.setAttribute("stroke-linecap", "round");
        p.setAttribute("stroke-linejoin", "round");
        svg.appendChild(p);
    }
    function fill(d) {
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", d);
        p.setAttribute("fill", "currentColor");
        svg.appendChild(p);
    }

    switch (name) {
        case "up":          stroke("M18 15l-6-6-6 6"); break;          // chevron-up
        case "down":        stroke("M6 9l6 6 6-6"); break;             // chevron-down
        case "play":        fill("M6 3v18l14-9z"); break;              // solid triangle
        case "file":
            // file-text: paper outline + corner fold + 3 text lines
            stroke("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z");
            stroke("M14 2v6h6");
            stroke("M16 13H8M16 17H8M10 9H8");
            break;
        case "plus":        stroke("M12 5v14M5 12h14"); break;
        case "pencil":
            // pencil-line — diagonal pencil with a distinct tip and cap line
            stroke("M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z");
            stroke("M15 5l3 3");
            break;
        case "trash":
            // trash-2 — lid + bin body + 2 inner ribs
            stroke("M3 6h18");
            stroke("M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2");
            stroke("M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6");
            stroke("M10 11v6M14 11v6");
            break;
        case "arrow-right": stroke("M5 12h14M13 5l7 7-7 7"); break;
        case "droplet":
            // droplet — closed teardrop, no extraneous strokes
            stroke("M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z");
            break;
    }

    return svg;
}

// Inline SVG chevron used as the expand/collapse indicator. Rotates 90° via
// CSS when the .is-open class is set. Right-pointing in the closed state so
// the rotation animates around the natural visual anchor.
function makeCaret(isOpen) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "smsys-tree-caret" + (isOpen ? " is-open" : ""));
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "10");
    svg.setAttribute("height", "10");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", "M6 4l4 4-4 4");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("fill", "none");
    svg.appendChild(path);
    return svg;
}

// Stats panel — three icon+number pills (due, new, learning) replacing the
// old text "3 due / 1 new / 2 lrn" tokens. Returned alongside the pill
// container so callers can update individual values asynchronously.
function makeStatsPanel() {
    const dueEl = h("span.smsys-stat.is-due",  { title: "0 due"     }, "↩ ·");
    const newEl = h("span.smsys-stat.is-new",  { title: "0 new"     }, "✦ ·");
    const lrnEl = h("span.smsys-stat.is-lrn",  { title: "0 learning"}, "◐ ·");
    const statsEl = h(".smsys-subject-stats.is-loading", null, dueEl, newEl, lrnEl);
    return { statsEl, dueEl, newEl, lrnEl };
}

function applyStat(entry, stat) {
    const { statsEl, dueEl, newEl, lrnEl } = entry;
    statsEl.classList.remove("is-loading");
    statsEl.classList.toggle("is-all-zero", stat.due === 0 && stat.new === 0 && stat.lrn === 0);
    dueEl.textContent = `↩ ${stat.due}`;
    newEl.textContent = `✦ ${stat.new}`;
    lrnEl.textContent = `◐ ${stat.lrn}`;
    dueEl.title = `${stat.due} due`;
    newEl.title = `${stat.new} new`;
    lrnEl.title = `${stat.lrn} learning`;
}

function makeStatusDot(node, nodeType) {
    const status = node.study_status ?? "backlog";
    return h("button.smsys-status-dot", {
        "data-status": status,
        "aria-label": `Status: ${statusLabel(status)} — click to change`,
        "aria-haspopup": "listbox",
        "aria-expanded": "false",
        title: statusLabel(status),
        type: "button",
        onClick: (e) => {
            e.stopPropagation();
            e.preventDefault();
            openStatusPicker(e.currentTarget, node.id, nodeType);
        },
    });
}

let dragState = null; // { type, id, disciplineId?, subjectId? }

// ============================================================
// Reordering
// ============================================================

async function reorderDisciplines(container) {
    const ids = [...container.querySelectorAll(":scope > .smsys-tree-discipline")]
        .map(el => parseInt(el.dataset.id, 10));
    try {
        await invoke("disciplines.reorder", { ids });
    } catch (e) {
        toast(e.message, { error: true });
    }
}

async function reorderSubjects(container, disciplineId) {
    const ids = [...container.querySelectorAll(":scope > .smsys-tree-subject")]
        .map(el => parseInt(el.dataset.id, 10));
    try {
        await invoke("subjects.reorder", { discipline_id: disciplineId, ids });
    } catch (e) {
        toast(e.message, { error: true });
    }
}

async function reorderTopics(container, subjectId) {
    const ids = [...container.querySelectorAll(":scope > .smsys-tree-row.is-topic")]
        .map(el => parseInt(el.dataset.id, 10));
    try {
        await invoke("topics.reorder", { subject_id: subjectId, ids });
    } catch (e) {
        toast(e.message, { error: true });
    }
}

function clearDragOver() {
    document.querySelectorAll(".is-drag-over-before, .is-drag-over-after")
        .forEach(el => el.classList.remove("is-drag-over-before", "is-drag-over-after"));
}

// ============================================================
// Drag wiring
// ============================================================

// Only the drag handle is the drag SOURCE — keeping the wrap non-draggable
// prevents click-vs-drag conflicts on the row (toggleCollapse + action buttons)
// and stops descendant drags (subjects, topics) from being captured by the
// outer wrap. The wrap remains the dragover / drop TARGET so the visual
// indicator and drop logic still wrap the whole subtree.
function wireDisciplineDrag(wrap, handle, d) {
    wrap.dataset.id = d.id;
    handle.draggable = true;

    handle.addEventListener("dragstart", e => {
        dragState = { type: "discipline", id: d.id };
        wrap.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        // Some Chromium-based webviews drop the drop event entirely if
        // dataTransfer has no data set during dragstart.
        e.dataTransfer.setData("text/plain", `discipline:${d.id}`);
        const header = wrap.querySelector(":scope > .smsys-tree-row.is-discipline");
        if (header) e.dataTransfer.setDragImage(header, 16, header.offsetHeight / 2);
    });

    handle.addEventListener("dragend", () => {
        wrap.classList.remove("is-dragging");
        clearDragOver();
        dragState = null;
    });

    wrap.addEventListener("dragover", e => {
        if (!dragState || dragState.type !== "discipline" || dragState.id === d.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        // Use the header row's rect — the wrap can be very tall when its
        // children are expanded, which would otherwise push the midpoint
        // far below the visible header.
        const header = wrap.querySelector(":scope > .smsys-tree-row.is-discipline");
        const rect = (header || wrap).getBoundingClientRect();
        const isAfter = e.clientY > rect.top + rect.height / 2;
        wrap.classList.toggle("is-drag-over-before", !isAfter);
        wrap.classList.toggle("is-drag-over-after", isAfter);
    });

    wrap.addEventListener("dragleave", e => {
        if (!wrap.contains(e.relatedTarget)) {
            wrap.classList.remove("is-drag-over-before", "is-drag-over-after");
        }
    });

    wrap.addEventListener("drop", e => {
        if (!dragState || dragState.type !== "discipline" || dragState.id === d.id) return;
        e.preventDefault();
        const container = wrap.parentElement;
        const srcEl = container.querySelector(`:scope > .smsys-tree-discipline[data-id="${dragState.id}"]`);
        if (!srcEl) return;
        const isAfter = wrap.classList.contains("is-drag-over-after");
        wrap.classList.remove("is-drag-over-before", "is-drag-over-after");
        if (isAfter) { wrap.after(srcEl); } else { wrap.before(srcEl); }
        reorderDisciplines(container);
    });
}

function wireSubjectDrag(wrap, handle, s, disciplineId, container) {
    wrap.dataset.id = s.id;
    handle.draggable = true;

    handle.addEventListener("dragstart", e => {
        dragState = { type: "subject", id: s.id, disciplineId };
        wrap.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `subject:${s.id}`);
        const header = wrap.querySelector(":scope > .smsys-tree-row.is-subject");
        if (header) e.dataTransfer.setDragImage(header, 16, header.offsetHeight / 2);
    });

    handle.addEventListener("dragend", () => {
        wrap.classList.remove("is-dragging");
        clearDragOver();
        dragState = null;
    });

    wrap.addEventListener("dragover", e => {
        if (!dragState || dragState.type !== "subject"
            || dragState.disciplineId !== disciplineId
            || dragState.id === s.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const header = wrap.querySelector(":scope > .smsys-tree-row.is-subject");
        const rect = (header || wrap).getBoundingClientRect();
        const isAfter = e.clientY > rect.top + rect.height / 2;
        wrap.classList.toggle("is-drag-over-before", !isAfter);
        wrap.classList.toggle("is-drag-over-after", isAfter);
    });

    wrap.addEventListener("dragleave", e => {
        if (!wrap.contains(e.relatedTarget)) {
            wrap.classList.remove("is-drag-over-before", "is-drag-over-after");
        }
    });

    wrap.addEventListener("drop", e => {
        if (!dragState || dragState.type !== "subject"
            || dragState.disciplineId !== disciplineId
            || dragState.id === s.id) return;
        e.preventDefault();
        const srcEl = container.querySelector(`:scope > .smsys-tree-subject[data-id="${dragState.id}"]`);
        if (!srcEl) return;
        const isAfter = wrap.classList.contains("is-drag-over-after");
        wrap.classList.remove("is-drag-over-before", "is-drag-over-after");
        if (isAfter) { wrap.after(srcEl); } else { wrap.before(srcEl); }
        reorderSubjects(container, disciplineId);
    });
}

function wireTopicDrag(row, handle, t, subjectId, container) {
    row.dataset.id = t.id;
    handle.draggable = true;

    handle.addEventListener("dragstart", e => {
        dragState = { type: "topic", id: t.id, subjectId };
        row.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `topic:${t.id}`);
        e.dataTransfer.setDragImage(row, 16, row.offsetHeight / 2);
    });

    handle.addEventListener("dragend", () => {
        row.classList.remove("is-dragging");
        clearDragOver();
        dragState = null;
    });

    row.addEventListener("dragover", e => {
        if (!dragState || dragState.type !== "topic"
            || dragState.subjectId !== subjectId
            || dragState.id === t.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = row.getBoundingClientRect();
        const isAfter = e.clientY > rect.top + rect.height / 2;
        row.classList.toggle("is-drag-over-before", !isAfter);
        row.classList.toggle("is-drag-over-after", isAfter);
    });

    row.addEventListener("dragleave", e => {
        if (!row.contains(e.relatedTarget)) {
            row.classList.remove("is-drag-over-before", "is-drag-over-after");
        }
    });

    row.addEventListener("drop", e => {
        if (!dragState || dragState.type !== "topic"
            || dragState.subjectId !== subjectId
            || dragState.id === t.id) return;
        e.preventDefault();
        const srcEl = container.querySelector(`:scope > .smsys-tree-row.is-topic[data-id="${dragState.id}"]`);
        if (!srcEl) return;
        const isAfter = row.classList.contains("is-drag-over-after");
        row.classList.remove("is-drag-over-before", "is-drag-over-after");
        if (isAfter) { row.after(srcEl); } else { row.before(srcEl); }
        reorderTopics(container, subjectId);
    });
}

// ============================================================
// Page entry
// ============================================================

export async function render(container) {
    const page = h(".smsys-page");
    container.appendChild(page);

    page.appendChild(
        h(".smsys-page-header", null,
            h("h1.smsys-page-title", "Disciplines, Subjects & Topics"),
            h("div.smsys-page-actions", null,
                h("button.smsys-btn",
                    { onClick: () => refresh(), "aria-label": "Refresh disciplines" },
                    "↺ Refresh"
                ),
            )
        )
    );

    const filterInput = h("input.smsys-filter-input", {
        type: "search",
        placeholder: "Filter disciplines, subjects, and topics…",
        "aria-label": "Filter disciplines, subjects, and topics",
        onInput: e => applyFilter(e.target.value),
    });

    // Status filter chips (stretch from FDA-715). Clicking a chip narrows the
    // tree to nodes whose data-status matches. Ancestors of a matching node
    // stay visible so the path remains navigable.
    const STATUS_CHIPS = [
        { value: "",            label: "All" },
        { value: "backlog",     label: "Backlog" },
        { value: "todo",        label: "To Do" },
        { value: "in-progress", label: "In Progress" },
        { value: "blocked",     label: "Blocked" },
        { value: "done",        label: "Done" },
        { value: "archived",    label: "Archived" },
    ];
    let activeStatus = "";
    const chipEls = STATUS_CHIPS.map(c => h("button.smsys-filter-chip", {
        type: "button",
        "data-status": c.value || "all",
        "aria-pressed": c.value === activeStatus ? "true" : "false",
        "aria-label": c.value
            ? `Filter by status: ${c.label}`
            : "Show all statuses",
        onClick: () => {
            activeStatus = c.value;
            for (const el of chipEls) {
                const v = el.dataset.status === "all" ? "" : el.dataset.status;
                el.classList.toggle("is-active", v === activeStatus);
                el.setAttribute("aria-pressed", v === activeStatus ? "true" : "false");
            }
            applyFilter(filterInput.value);
        },
    }, c.label));
    chipEls[0].classList.add("is-active");

    const toolbar = h(".smsys-tree-toolbar", null,
        h(".smsys-tree-toolbar-row", null,
            filterInput,
            h("button.smsys-btn.smsys-btn-primary",
                { onClick: onNewDiscipline, "aria-label": "Create new discipline" },
                "+ New Discipline"
            ),
        ),
        h(".smsys-tree-filter-chips", { role: "group", "aria-label": "Filter by study status" }, ...chipEls),
    );
    page.appendChild(toolbar);

    const treeEl = h(".smsys-tree");
    page.appendChild(treeEl);

    // "No matches" empty state shown when an active filter (text query or
    // status chip) hides every discipline. Tracked at this scope so applyFilter
    // can mount/dismount it across calls; refresh() nulls it when treeEl is
    // cleared so we don't hold onto a detached node.
    let filterEmptyEl = null;

    // Tree-level dragover catch-all. Without this, when the cursor sits over
    // the source's own wrap (or its descendants, or any wrap that bails on
    // type/scope mismatch), no handler calls preventDefault and the browser
    // shows the "not-allowed" cursor — making the user think dnd is broken.
    // Accepting the drag tree-wide keeps the "move" cursor active everywhere;
    // wrap-level handlers still control the drop-indicator highlight and the
    // actual drop logic.
    treeEl.addEventListener("dragover", e => {
        if (!dragState) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    });

    async function refresh() {
        clear(treeEl);
        filterEmptyEl = null;
        treeEl.appendChild(h(".smsys-tree-skeleton"));
        treeEl.appendChild(h(".smsys-tree-skeleton"));
        let disciplines;
        try {
            disciplines = await invoke("disciplines.list");
        } catch (e) {
            clear(treeEl);
            treeEl.appendChild(
                h(".smsys-empty", `Could not load disciplines: ${e.message}`)
            );
            return;
        }

        clear(treeEl);
        if (!disciplines.length) {
            treeEl.appendChild(emptyState({
                icon: EMPTY_ICONS.folder,
                title: "No disciplines yet",
                sub: "Group your notes by subject area to track progress and find what to study next.",
                cta: { label: "+ Create first discipline", onClick: onNewDiscipline },
            }));
            return;
        }

        const discStatEls = new Map();
        for (const d of disciplines) {
            const { wrap, statsEl, dueEl, newEl, lrnEl } = await renderDiscipline(d, refresh);
            treeEl.appendChild(wrap);
            discStatEls.set(d.id, { statsEl, dueEl, newEl, lrnEl });
        }

        try {
            const ids = disciplines.map(d => d.id);
            const statsList = await invoke("disciplines.stats", { ids });
            for (const stat of statsList) {
                const entry = discStatEls.get(stat.id);
                if (!entry) continue;
                applyStat(entry, stat);
            }
        } catch (_) {
            for (const { statsEl } of discStatEls.values()) {
                statsEl.classList.replace("is-loading", "is-error");
            }
        }

        if (filterInput.value.trim() || activeStatus) applyFilter(filterInput.value);
    }

    await refresh();

    function applyFilter(raw) {
        const query = (raw || "").trim().toLowerCase();
        const sFilter = activeStatus;
        const noFilters = !query && !sFilter;

        function statusMatches(row) {
            if (!sFilter) return true;
            return row?.dataset?.status === sFilter;
        }

        treeEl.querySelectorAll(":scope > .smsys-tree-discipline").forEach(dWrap => {
            const dRow = dWrap.querySelector(":scope > .smsys-tree-row");
            const dNameEl = dRow?.querySelector(".smsys-tree-name");
            const dChildren = dWrap.querySelector(":scope > .smsys-tree-children");
            const dCaret = dRow?.querySelector(".smsys-tree-caret");
            const dKey = dWrap.dataset.storageKey;

            if (noFilters) {
                dWrap.style.display = "";
                const wasCollapsed = !dKey || localStorage.getItem(dKey) !== "0";
                if (dChildren) dChildren.style.display = wasCollapsed ? "none" : "";
                if (dCaret) dCaret.classList.toggle("is-open", !wasCollapsed);
                if (dChildren) {
                    dChildren.querySelectorAll(".smsys-tree-subject")
                        .forEach(sWrap => {
                            sWrap.style.display = "";
                            const sChildren = sWrap.querySelector(":scope > .smsys-tree-children");
                            const sCaret = sWrap.querySelector(":scope > .smsys-tree-row .smsys-tree-caret");
                            const sKey = sWrap.dataset.storageKey;
                            const sWasCollapsed = !sKey || localStorage.getItem(sKey) !== "0";
                            if (sChildren) sChildren.style.display = sWasCollapsed ? "none" : "";
                            if (sCaret) sCaret.classList.toggle("is-open", !sWasCollapsed);
                            sWrap.querySelectorAll(".smsys-tree-row.is-topic")
                                .forEach(r => { r.style.display = ""; });
                        });
                    dChildren.querySelectorAll(".smsys-tree-name").forEach(restoreHighlight);
                }
                restoreHighlight(dNameEl);
                return;
            }

            const dRaw = dNameEl ? (dNameEl.dataset.raw || dNameEl.textContent) : "";
            const dTextMatches = !query || dRaw.toLowerCase().includes(query);
            const dStatusOk = statusMatches(dRow);
            const dMatches = dTextMatches && dStatusOk;
            let anyChildMatch = false;

            if (dChildren) {
                dChildren.querySelectorAll(":scope > .smsys-tree-subject").forEach(sWrap => {
                    const sRow = sWrap.querySelector(":scope > .smsys-tree-row");
                    const sNameEl = sRow?.querySelector(".smsys-tree-name");
                    const sRaw = sNameEl ? (sNameEl.dataset.raw || sNameEl.textContent) : "";
                    const sChildren = sWrap.querySelector(":scope > .smsys-tree-children");
                    const sCaret = sRow?.querySelector(".smsys-tree-caret");
                    const sTextMatches = !query || sRaw.toLowerCase().includes(query);
                    const sStatusOk = statusMatches(sRow);
                    const sSelfMatches = sTextMatches && sStatusOk;
                    let anyTopicMatch = false;

                    if (sChildren) {
                        sChildren.querySelectorAll(":scope > .smsys-tree-row.is-topic").forEach(tRow => {
                            const tNameEl = tRow.querySelector(".smsys-tree-name");
                            const tRaw = tNameEl ? (tNameEl.dataset.raw || tNameEl.textContent) : "";
                            const tTextMatches = !query || tRaw.toLowerCase().includes(query);
                            const tStatusOk = statusMatches(tRow);
                            const tMatches = tTextMatches && tStatusOk;
                            // Show topic if it matches OR if an ancestor textually matches AND
                            // the status filter is satisfied at the topic itself (so a status
                            // filter still narrows leaves).
                            if (tMatches) {
                                anyTopicMatch = true;
                                tRow.style.display = "";
                                if (query) highlight(tNameEl, tRaw, query); else restoreHighlight(tNameEl);
                            } else {
                                tRow.style.display = "none";
                                restoreHighlight(tNameEl);
                            }
                        });
                    }

                    if (sSelfMatches || anyTopicMatch) {
                        anyChildMatch = true;
                        sWrap.style.display = "";
                        if (sChildren) sChildren.style.display = "";
                        if (sCaret) sCaret.classList.add("is-open");
                        if (sSelfMatches && query) highlight(sNameEl, sRaw, query);
                        else restoreHighlight(sNameEl);
                    } else {
                        sWrap.style.display = "none";
                        restoreHighlight(sNameEl);
                    }
                });
            }

            if (dMatches || anyChildMatch) {
                dWrap.style.display = "";
                if (dChildren) dChildren.style.display = "";
                if (dCaret) dCaret.classList.add("is-open");
                if (dMatches && query) highlight(dNameEl, dRaw, query);
                else restoreHighlight(dNameEl);
            } else {
                dWrap.style.display = "none";
                restoreHighlight(dNameEl);
            }
        });

        if (noFilters) {
            removeFilterEmpty();
            return;
        }

        // When there are zero disciplines the "No disciplines yet" empty state
        // is already mounted by refresh(); don't stack a second one on top.
        const allWraps = [...treeEl.querySelectorAll(":scope > .smsys-tree-discipline")];
        if (!allWraps.length) {
            removeFilterEmpty();
            return;
        }

        const anyVisible = allWraps.some(el => el.style.display !== "none");
        if (anyVisible) removeFilterEmpty();
        else showFilterEmpty((raw || "").trim(), sFilter);
    }

    function showFilterEmpty(trimmedQuery, statusValue) {
        if (filterEmptyEl) filterEmptyEl.remove();
        const statusChip = STATUS_CHIPS.find(c => c.value === statusValue);
        const parts = [];
        if (trimmedQuery) parts.push(`“${trimmedQuery}”`);
        if (statusChip && statusValue) parts.push(`status “${statusChip.label}”`);
        const detail = parts.join(" and ");
        filterEmptyEl = emptyState({
            icon: EMPTY_ICONS.search,
            title: "No matches",
            sub: detail
                ? `Nothing matched ${detail}. Try a different search or clear the filters.`
                : "Nothing matched your filters. Try a different search or clear them.",
            cta: { label: "Clear filters", onClick: clearAllFilters },
        });
        treeEl.appendChild(filterEmptyEl);
    }

    function removeFilterEmpty() {
        if (!filterEmptyEl) return;
        filterEmptyEl.remove();
        filterEmptyEl = null;
    }

    function clearAllFilters() {
        filterInput.value = "";
        activeStatus = "";
        for (const el of chipEls) {
            const v = el.dataset.status === "all" ? "" : el.dataset.status;
            const isActive = v === activeStatus;
            el.classList.toggle("is-active", isActive);
            el.setAttribute("aria-pressed", isActive ? "true" : "false");
        }
        applyFilter("");
        filterInput.focus();
    }

    function highlight(el, rawText, query) {
        if (!el || !rawText || !query) return;
        if (!el.dataset.raw) el.dataset.raw = rawText;
        const text = el.dataset.raw;
        const lc = text.toLowerCase();
        const idx = lc.indexOf(query);
        clear(el);
        if (idx === -1) {
            el.appendChild(document.createTextNode(text));
            return;
        }
        if (idx > 0) el.appendChild(document.createTextNode(text.slice(0, idx)));
        const mark = document.createElement("mark");
        mark.className = "smsys-highlight";
        mark.textContent = text.slice(idx, idx + query.length);
        el.appendChild(mark);
        if (idx + query.length < text.length) {
            el.appendChild(document.createTextNode(text.slice(idx + query.length)));
        }
    }

    function restoreHighlight(el) {
        if (!el || !el.dataset.raw) return;
        const raw = el.dataset.raw;
        delete el.dataset.raw;
        clear(el);
        el.appendChild(document.createTextNode(raw));
    }

    function onNewDiscipline() {
        dismissActiveInline();
        showInlineInput(
            el => treeEl.insertBefore(el, treeEl.firstChild),
            {
                placeholder: "New discipline name",
                async onConfirm(name) {
                    try {
                        await invoke("disciplines.create", { name });
                        toast("Discipline created.", { type: "success" });
                        await refresh();
                    } catch (e) {
                        toast(e.message, { error: true });
                    }
                }
            }
        );
    }
}

// ============================================================
// Discipline render
// ============================================================

async function renderDiscipline(d, refreshAll) {
    const wrap = h(".smsys-tree-discipline");
    const childrenEl = h(".smsys-tree-children");

    // Left-edge color bar (FDA-715). The wrap already has a 1px neutral border
    // from the base style; setting border-left to 4px in the discipline color
    // turns that edge into a vertical bar without needing a separate element.
    if (d.color) {
        wrap.style.borderLeftColor = d.color;
        wrap.style.borderLeftWidth = "4px";
    }

    const storageKey = `smsys_discipline_collapsed_${d.id}`;
    wrap.dataset.storageKey = storageKey;
    // Default collapsed (like subjects). "0" means user explicitly opened it.
    const startCollapsed = localStorage.getItem(storageKey) !== "0";

    const caretEl = makeCaret(!startCollapsed);
    if (startCollapsed) childrenEl.style.display = "none";

    function toggleCollapse(e) {
        e.stopPropagation();
        const collapsed = childrenEl.style.display === "none";
        childrenEl.style.display = collapsed ? "" : "none";
        caretEl.classList.toggle("is-open", collapsed);
        localStorage.setItem(storageKey, collapsed ? "0" : "1");
    }

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = d.color || "#0d6efd";
    colorInput.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;opacity:0;";
    colorInput.addEventListener("change", async () => {
        const color = colorInput.value;
        try {
            await invoke("disciplines.set_color", { id: d.id, color });
            d.color = color;
            wrap.style.borderLeftColor = color;
            wrap.style.borderLeftWidth = "4px";
        } catch (err) {
            toast(err.message, { error: true });
        }
    });

    const swatchBtn = h("button.smsys-tree-action.smsys-color-btn",
        {
            title: "Set color",
            "aria-label": `Change color of ${d.name}`,
            onClick: (e) => { e.stopPropagation(); colorInput.click(); },
        },
        makeActionIcon("droplet")
    );
    swatchBtn.appendChild(colorInput);

    const dragHandle = h("span.smsys-drag-handle",
        { title: "Drag to reorder", "aria-label": `Drag to reorder ${d.name}` },
        "⠿"
    );

    const discStats = makeStatsPanel();

    const headerRow = h(".smsys-tree-row.is-discipline", {
        "data-status": d.study_status ?? "backlog",
        onClick: toggleCollapse,
    },
        dragHandle,
        caretEl,
        makeStatusDot(d, "discipline"),
        h("span.smsys-tree-name", { title: d.name }, d.name),
        h(".smsys-tree-meta", null,
            h("span.smsys-badge", `${d.note_count} notes`),
            d.subject_count > 0 && h("span.smsys-badge", `${d.subject_count} subject${d.subject_count === 1 ? "" : "s"}`),
            discStats.statsEl,
        ),
        h(".smsys-tree-actions", null,
            h("button.smsys-tree-action",
                {
                    title: "Move up",
                    "aria-label": `Move ${d.name} up`,
                    onClick: async (e) => {
                        e.stopPropagation();
                        const container = wrap.parentElement;
                        const prev = wrap.previousElementSibling;
                        if (prev?.classList.contains("smsys-tree-discipline")) {
                            container.insertBefore(wrap, prev);
                            await reorderDisciplines(container);
                        }
                    }
                },
                makeActionIcon("up")
            ),
            h("button.smsys-tree-action",
                {
                    title: "Move down",
                    "aria-label": `Move ${d.name} down`,
                    onClick: async (e) => {
                        e.stopPropagation();
                        const container = wrap.parentElement;
                        const next = wrap.nextElementSibling;
                        if (next?.classList.contains("smsys-tree-discipline")) {
                            container.insertBefore(next, wrap);
                            await reorderDisciplines(container);
                        }
                    }
                },
                makeActionIcon("down")
            ),
            swatchBtn,
            h("button.smsys-tree-action.smsys-tree-action--study",
                { title: "Study every note under this discipline",
                  "aria-label": `Study every note under ${d.name}`,
                  onClick: (e) => { e.stopPropagation(); onStudyDiscipline(d); } },
                makeActionIcon("play")
            ),
            h("button.smsys-tree-action.smsys-tree-action--notes",
                { title: "Show every note under this discipline in Browser",
                  "aria-label": `Show notes under ${d.name} in Browser`,
                  onClick: (e) => { e.stopPropagation(); onShowDisciplineNotes(d); } },
                makeActionIcon("file")
            ),
            h("button.smsys-tree-action.smsys-tree-action--add",
                { title: "Add subject",
                  "aria-label": `Add subject to ${d.name}`,
                  onClick: (e) => { e.stopPropagation(); onAddSubject(d, childrenEl, refreshAll); } },
                makeActionIcon("plus")
            ),
            h("button.smsys-tree-action.smsys-tree-action--edit",
                { title: "Rename",
                  "aria-label": `Rename ${d.name}`,
                  onClick: (e) => { e.stopPropagation(); onRenameDiscipline(d, headerRow, refreshAll); } },
                makeActionIcon("pencil")
            ),
            h("button.smsys-tree-action.smsys-tree-action--delete",
                { title: "Delete",
                  "aria-label": `Delete ${d.name}`,
                  onClick: (e) => { e.stopPropagation(); onDeleteDiscipline(d, headerRow, refreshAll); } },
                makeActionIcon("trash")
            ),
        )
    );

    wrap.appendChild(headerRow);
    wrap.appendChild(childrenEl);
    wireDisciplineDrag(wrap, dragHandle, d);
    await loadSubjects(d.id, childrenEl, refreshAll);
    return { wrap, ...discStats };
}

// ============================================================
// Subject layer
// ============================================================

async function loadSubjects(disciplineId, container, refreshAll) {
    clear(container);
    let subjects = [];
    try {
        subjects = await invoke("subjects.list", { discipline_id: disciplineId });
    } catch (e) {
        container.appendChild(h(".smsys-empty", `Error: ${e.message}`));
        return;
    }
    if (!subjects.length) {
        container.appendChild(h(".smsys-empty", "No subjects in this discipline yet."));
        return;
    }

    const statEls = new Map();

    for (const s of subjects) {
        const subjectWrap = await renderSubject(s, disciplineId, container, refreshAll, statEls);
        container.appendChild(subjectWrap);
    }

    try {
        const ids = subjects.map(s => s.id);
        const statsList = await invoke("subjects.stats", { ids });
        for (const stat of statsList) {
            const entry = statEls.get(stat.id);
            if (!entry) continue;
            applyStat(entry, stat);
        }
    } catch (_) {
        for (const { statsEl } of statEls.values()) {
            statsEl.classList.replace("is-loading", "is-error");
        }
    }
}

async function renderSubject(s, disciplineId, siblingContainer, refreshAll, statEls) {
    const wrap = h(".smsys-tree-subject");
    const topicsEl = h(".smsys-tree-children.is-topics");

    const storageKey = `smsys_subject_collapsed_${s.id}`;
    wrap.dataset.storageKey = storageKey;
    const startCollapsed = localStorage.getItem(storageKey) !== "0";
    // Topics start collapsed by default to keep the tree compact.

    const caretEl = makeCaret(!startCollapsed);
    if (startCollapsed) topicsEl.style.display = "none";
    let topicsLoaded = !startCollapsed;

    async function toggleCollapse(e) {
        e.stopPropagation();
        const collapsed = topicsEl.style.display === "none";
        topicsEl.style.display = collapsed ? "" : "none";
        caretEl.classList.toggle("is-open", collapsed);
        localStorage.setItem(storageKey, collapsed ? "0" : "1");
        if (collapsed && !topicsLoaded) {
            topicsLoaded = true;
            await loadTopics(s.id, topicsEl, refreshAll);
        }
    }

    const stats = makeStatsPanel();
    statEls.set(s.id, stats);

    const dragHandle = h("span.smsys-drag-handle",
        { title: "Drag to reorder", "aria-label": `Drag to reorder ${s.name}` },
        "⠿"
    );
    const row = h(".smsys-tree-row.is-subject", {
        "data-status": s.study_status ?? "backlog",
        onClick: toggleCollapse,
    },
        dragHandle,
        caretEl,
        makeStatusDot(s, "subject"),
        h("span.smsys-tree-name", { title: s.name }, s.name),
        h(".smsys-tree-meta", null,
            h("span.smsys-badge", `${s.note_count} notes`),
            s.topic_count > 0 && h("span.smsys-badge", `${s.topic_count} topic${s.topic_count === 1 ? "" : "s"}`),
            stats.statsEl,
        ),
        h(".smsys-tree-actions", null,
            h("button.smsys-tree-action",
                {
                    title: "Move up",
                    "aria-label": `Move ${s.name} up`,
                    onClick: async (e) => {
                        e.stopPropagation();
                        const container = wrap.parentElement;
                        const prev = wrap.previousElementSibling;
                        if (prev?.classList.contains("smsys-tree-subject")) {
                            container.insertBefore(wrap, prev);
                            await reorderSubjects(container, disciplineId);
                        }
                    }
                },
                makeActionIcon("up")
            ),
            h("button.smsys-tree-action",
                {
                    title: "Move down",
                    "aria-label": `Move ${s.name} down`,
                    onClick: async (e) => {
                        e.stopPropagation();
                        const container = wrap.parentElement;
                        const next = wrap.nextElementSibling;
                        if (next?.classList.contains("smsys-tree-subject")) {
                            container.insertBefore(next, wrap);
                            await reorderSubjects(container, disciplineId);
                        }
                    }
                },
                makeActionIcon("down")
            ),
            h("button.smsys-tree-action.smsys-tree-action--study",
                { title: "Start a study session for this subject (incl. its topics)",
                  "aria-label": `Study ${s.name} and its topics`,
                  onClick: (e) => { e.stopPropagation(); onStudySubject(s); } },
                makeActionIcon("play")
            ),
            h("button.smsys-tree-action.smsys-tree-action--notes",
                { title: "Show notes in Browser",
                  "aria-label": `Show notes under ${s.name} in Browser`,
                  onClick: (e) => { e.stopPropagation(); onShowSubjectNotes(s); } },
                makeActionIcon("file")
            ),
            h("button.smsys-tree-action.smsys-tree-action--add",
                { title: "Add topic",
                  "aria-label": `Add topic to ${s.name}`,
                  onClick: (e) => { e.stopPropagation(); onAddTopic(s, topicsEl, refreshAll); } },
                makeActionIcon("plus")
            ),
            h("button.smsys-tree-action.smsys-tree-action--move",
                { title: "Move all notes to another placement",
                  "aria-label": `Move all notes from ${s.name} elsewhere`,
                  onClick: (e) => { e.stopPropagation(); onMoveAllNotes("subject", s, refreshAll); } },
                makeActionIcon("arrow-right")
            ),
            h("button.smsys-tree-action.smsys-tree-action--edit",
                { title: "Rename",
                  "aria-label": `Rename ${s.name}`,
                  onClick: (e) => { e.stopPropagation(); onRenameSubject(s, row, refreshAll); } },
                makeActionIcon("pencil")
            ),
            h("button.smsys-tree-action.smsys-tree-action--delete",
                { title: "Delete",
                  "aria-label": `Delete ${s.name}`,
                  onClick: (e) => { e.stopPropagation(); onDeleteSubject(s, row, refreshAll); } },
                makeActionIcon("trash")
            ),
        )
    );

    wrap.appendChild(row);
    wrap.appendChild(topicsEl);
    wireSubjectDrag(wrap, dragHandle, s, disciplineId, siblingContainer);
    if (!startCollapsed) {
        await loadTopics(s.id, topicsEl, refreshAll);
    }
    return wrap;
}

// ============================================================
// Topic layer
// ============================================================

async function loadTopics(subjectId, container, refreshAll) {
    clear(container);
    let topics = [];
    try {
        topics = await invoke("topics.list", { subject_id: subjectId });
    } catch (e) {
        container.appendChild(h(".smsys-empty", `Error: ${e.message}`));
        return;
    }
    if (!topics.length) {
        container.appendChild(h(".smsys-empty.is-topic-empty", "No topics yet."));
        return;
    }

    const statEls = new Map();

    for (const t of topics) {
        const stats = makeStatsPanel();
        statEls.set(t.id, stats);

        const dragHandle = h("span.smsys-drag-handle",
            { title: "Drag to reorder", "aria-label": `Drag to reorder ${t.name}` },
            "⠿"
        );
        const row = h(".smsys-tree-row.is-topic", {
            "data-status": t.study_status ?? "backlog",
        },
            dragHandle,
            makeStatusDot(t, "topic"),
            h("span.smsys-tree-name", { title: t.name }, t.name),
            h(".smsys-tree-meta", null,
                h("span.smsys-badge", `${t.note_count} notes`),
                stats.statsEl,
            ),
            h(".smsys-tree-actions", null,
                h("button.smsys-tree-action",
                    {
                        title: "Move up",
                        "aria-label": `Move ${t.name} up`,
                        onClick: async (e) => {
                            e.stopPropagation();
                            const prev = row.previousElementSibling;
                            if (prev?.classList.contains("is-topic")) {
                                container.insertBefore(row, prev);
                                await reorderTopics(container, subjectId);
                            }
                        }
                    },
                    makeActionIcon("up")
                ),
                h("button.smsys-tree-action",
                    {
                        title: "Move down",
                        "aria-label": `Move ${t.name} down`,
                        onClick: async (e) => {
                            e.stopPropagation();
                            const next = row.nextElementSibling;
                            if (next?.classList.contains("is-topic")) {
                                container.insertBefore(next, row);
                                await reorderTopics(container, subjectId);
                            }
                        }
                    },
                    makeActionIcon("down")
                ),
                h("button.smsys-tree-action.smsys-tree-action--study",
                    { title: "Start a study session for this topic",
                      "aria-label": `Study ${t.name}`,
                      onClick: () => onStudyTopic(t) },
                    makeActionIcon("play")
                ),
                h("button.smsys-tree-action.smsys-tree-action--notes",
                    { title: "Show notes in Browser",
                      "aria-label": `Show notes under ${t.name} in Browser`,
                      onClick: () => onShowTopicNotes(t) },
                    makeActionIcon("file")
                ),
                h("button.smsys-tree-action.smsys-tree-action--move",
                    { title: "Move all notes to another placement",
                      "aria-label": `Move all notes from ${t.name} elsewhere`,
                      onClick: () => onMoveAllNotes("topic", t, refreshAll) },
                    makeActionIcon("arrow-right")
                ),
                h("button.smsys-tree-action.smsys-tree-action--edit",
                    { title: "Rename",
                      "aria-label": `Rename ${t.name}`,
                      onClick: () => onRenameTopic(t, row, refreshAll) },
                    makeActionIcon("pencil")
                ),
                h("button.smsys-tree-action.smsys-tree-action--delete",
                    { title: "Delete",
                      "aria-label": `Delete ${t.name}`,
                      onClick: () => onDeleteTopic(t, row, refreshAll) },
                    makeActionIcon("trash")
                ),
            )
        );
        wireTopicDrag(row, dragHandle, t, subjectId, container);
        container.appendChild(row);
    }

    try {
        const ids = topics.map(t => t.id);
        const statsList = await invoke("topics.stats", { ids });
        for (const stat of statsList) {
            const entry = statEls.get(stat.id);
            if (!entry) continue;
            applyStat(entry, stat);
        }
    } catch (_) {
        for (const { statsEl } of statEls.values()) {
            statsEl.classList.replace("is-loading", "is-error");
        }
    }
}

// ============================================================
// CRUD actions
// ============================================================

function onAddSubject(d, childrenEl, refreshAll) {
    dismissActiveInline();
    showInlineInput(
        el => childrenEl.insertBefore(el, childrenEl.firstChild),
        {
            placeholder: `New subject under "${d.name}"`,
            async onConfirm(name) {
                try {
                    await invoke("subjects.create", { discipline_id: d.id, name });
                    toast("Subject created.", { type: "success" });
                    await loadSubjects(d.id, childrenEl, refreshAll);
                } catch (e) {
                    toast(e.message, { error: true });
                }
            }
        }
    );
}

function onAddTopic(s, childrenEl, refreshAll) {
    dismissActiveInline();
    showInlineInput(
        el => childrenEl.insertBefore(el, childrenEl.firstChild),
        {
            placeholder: `New topic under "${s.name}"`,
            async onConfirm(name) {
                try {
                    await invoke("topics.create", { subject_id: s.id, name });
                    toast("Topic created.", { type: "success" });
                    await loadTopics(s.id, childrenEl, refreshAll);
                } catch (e) {
                    toast(e.message, { error: true });
                }
            }
        }
    );
}

function onRenameDiscipline(d, anchorEl, refreshAll) {
    dismissActiveInline();
    showInlineInput(
        el => anchorEl.after(el),
        {
            defaultValue: d.name,
            placeholder: "Discipline name",
            async onConfirm(name) {
                if (name === d.name) return;
                try {
                    await invoke("disciplines.rename", { id: d.id, name });
                    toast("Renamed.", { type: "success" });
                    await refreshAll();
                } catch (e) {
                    toast(e.message, { error: true });
                }
            }
        }
    );
}

function onDeleteDiscipline(d, anchorEl, refreshAll) {
    dismissActiveInline();
    showInlineConfirm(
        el => anchorEl.after(el),
        {
            message: `Delete "${d.name}" and all its subjects + topics?`,
            async onConfirm() {
                try {
                    await invoke("disciplines.delete", { id: d.id });
                    toast("Deleted.", { type: "success" });
                    await refreshAll();
                } catch (e) {
                    toast(e.message, { error: true });
                }
            }
        }
    );
}

function onRenameSubject(s, anchorEl, refreshAll) {
    dismissActiveInline();
    showInlineInput(
        el => anchorEl.after(el),
        {
            defaultValue: s.name,
            placeholder: "Subject name",
            async onConfirm(name) {
                if (name === s.name) return;
                try {
                    await invoke("subjects.rename", { id: s.id, name });
                    toast("Renamed.", { type: "success" });
                    await refreshAll();
                } catch (e) {
                    toast(e.message, { error: true });
                }
            }
        }
    );
}

function onDeleteSubject(s, anchorEl, refreshAll) {
    dismissActiveInline();
    showInlineConfirm(
        el => anchorEl.after(el),
        {
            message: `Delete subject "${s.name}" and its topics? Note assignments will be cleared.`,
            async onConfirm() {
                try {
                    await invoke("subjects.delete", { id: s.id });
                    toast("Deleted.", { type: "success" });
                    await refreshAll();
                } catch (e) {
                    toast(e.message, { error: true });
                }
            }
        }
    );
}

function onRenameTopic(t, anchorEl, refreshAll) {
    dismissActiveInline();
    showInlineInput(
        el => anchorEl.after(el),
        {
            defaultValue: t.name,
            placeholder: "Topic name",
            async onConfirm(name) {
                if (name === t.name) return;
                try {
                    await invoke("topics.rename", { id: t.id, name });
                    toast("Renamed.", { type: "success" });
                    await refreshAll();
                } catch (e) {
                    toast(e.message, { error: true });
                }
            }
        }
    );
}

function onDeleteTopic(t, anchorEl, refreshAll) {
    dismissActiveInline();
    showInlineConfirm(
        el => anchorEl.after(el),
        {
            message: `Delete topic "${t.name}"? Note assignments will be cleared.`,
            async onConfirm() {
                try {
                    await invoke("topics.delete", { id: t.id });
                    toast("Deleted.", { type: "success" });
                    await refreshAll();
                } catch (e) {
                    toast(e.message, { error: true });
                }
            }
        }
    );
}

// ============================================================
// Study / browse actions
// ============================================================

async function onStudyDiscipline(d) {
    try {
        await invoke("anki.study_discipline", { discipline_id: d.id });
    } catch (e) {
        toast(e.message, { error: true });
    }
}

async function onStudySubject(s) {
    try {
        await invoke("anki.study_subject", { subject_id: s.id });
    } catch (e) {
        toast(e.message, { error: true });
    }
}

async function onStudyTopic(t) {
    try {
        await invoke("anki.study_topic", { topic_id: t.id });
    } catch (e) {
        toast(e.message, { error: true });
    }
}

async function onShowDisciplineNotes(d) {
    try {
        const noteIds = await invoke("disciplines.note_ids", { id: d.id });
        if (!noteIds.length) {
            toast("No notes under this discipline yet.");
            return;
        }
        await invoke("anki.open_browser_for_notes", { note_ids: noteIds });
    } catch (e) {
        toast(e.message, { error: true });
    }
}

async function onShowSubjectNotes(s) {
    try {
        const noteIds = await invoke("subjects.note_ids", { id: s.id });
        if (!noteIds.length) {
            toast("No notes under this subject (or its topics) yet.");
            return;
        }
        await invoke("anki.open_browser_for_notes", { note_ids: noteIds });
    } catch (e) {
        toast(e.message, { error: true });
    }
}

async function onShowTopicNotes(t) {
    try {
        const noteIds = await invoke("topics.note_ids", { id: t.id });
        if (!noteIds.length) {
            toast("No notes assigned to this topic yet.");
            return;
        }
        await invoke("anki.open_browser_for_notes", { note_ids: noteIds });
    } catch (e) {
        toast(e.message, { error: true });
    }
}

// ============================================================
// Move-all flow
// ============================================================

async function onMoveAllNotes(sourceKind, source, refreshAll) {
    const ipcKind = sourceKind === "topic" ? "topics" : "subjects";
    let noteIds;
    try {
        noteIds = await invoke(`${ipcKind}.note_ids`, { id: source.id });
    } catch (e) {
        toast(e.message, { error: true });
        return;
    }
    if (!noteIds.length) {
        toast(`No notes to move from this ${sourceKind}.`);
        return;
    }

    let disciplines;
    try {
        disciplines = await invoke("disciplines.list");
    } catch (e) {
        toast(e.message, { error: true });
        return;
    }

    showAssignmentPickerModal({
        title: "Move all notes",
        statusText: `Moving ${noteIds.length} note${noteIds.length === 1 ? "" : "s"} from "${source.name}".`,
        disciplines,
        exclude: { kind: sourceKind, id: source.id },
        async onConfirm({ kind, id }) {
            try {
                const moved = await invoke("notes.bulk_assign", {
                    note_ids: noteIds,
                    target_kind: kind,
                    target_id: id,
                });
                toast(`Moved ${moved} note${moved === 1 ? "" : "s"}.`, { type: "success" });
                await refreshAll();
            } catch (e) {
                toast(e.message, { error: true });
            }
        },
    });
}

// ============================================================
// Inline form helpers (unchanged)
// ============================================================

function dismissActiveInline() {
    document.querySelectorAll(".smsys-inline-form, .smsys-inline-confirm")
        .forEach(el => el.remove());
}

function showInlineInput(insert, { defaultValue = "", placeholder = "Name", onConfirm, onCancel }) {
    const input = h("input.smsys-inline-input", {
        type: "text",
        value: defaultValue,
        placeholder,
    });

    const widget = h(".smsys-inline-form", null,
        input,
        h("button.smsys-btn.smsys-btn-primary", { onClick: commit }, "Save"),
        h("button.smsys-btn", { onClick: dismiss }, "Cancel"),
    );

    insert(widget);
    input.focus();
    input.select();

    function commit() {
        const val = input.value.trim();
        if (!val) { input.focus(); return; }
        widget.remove();
        onConfirm(val);
    }

    function dismiss() {
        widget.remove();
        if (onCancel) onCancel();
    }

    input.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") dismiss();
    });
}

function showInlineConfirm(insert, { message, onConfirm, onCancel }) {
    const widget = h(".smsys-inline-confirm", null,
        h("span.smsys-inline-confirm-msg", message),
        h("button.smsys-btn.smsys-btn-danger-solid", {
            onClick: () => { teardown(); onConfirm(); }
        }, "Delete"),
        h("button.smsys-btn", {
            onClick: () => { teardown(); if (onCancel) onCancel(); }
        }, "Cancel"),
    );

    function teardown() {
        widget.remove();
        document.removeEventListener("keydown", onKey, true);
    }

    function onKey(e) {
        if (e.key !== "Escape") return;
        e.preventDefault();
        teardown();
        if (onCancel) onCancel();
    }

    insert(widget);
    document.addEventListener("keydown", onKey, true);
}

// ============================================================
// Assignment picker modal (Discipline → Subject → Topic)
// ============================================================

function showAssignmentPickerModal({
    title,
    statusText,
    disciplines,
    exclude = null, // { kind, id }
    onConfirm,
    onCancel,
}) {
    const subjectsCache = new Map(); // discipline_id -> [subjects]
    const topicsCache = new Map();   // subject_id -> [topics]
    let chosen = null;

    const discSelect = h("select.smsys-modal-select",
        h("option", { value: "" }, "— Select a discipline —"),
        ...disciplines.map(d => h("option", { value: String(d.id) }, d.name))
    );

    const subjSelect = h("select.smsys-modal-select", { disabled: true },
        h("option", { value: "" }, "— Pick a discipline first —"),
    );

    const topicSelect = h("select.smsys-modal-select", { disabled: true },
        h("option", { value: "" }, "— Pick a subject first —"),
    );

    const saveBtn = h("button.smsys-btn.smsys-btn-primary",
        { disabled: true, onClick: commit },
        "Move"
    );

    function statusFromChosen() {
        if (!chosen) return "Pick at least a discipline.";
        if (chosen.kind === "topic") return "Will move under selected topic.";
        if (chosen.kind === "subject") return "Will move under selected subject (no topic).";
        return "Will move under selected discipline (no subject, no topic).";
    }
    const placementHint = h("p.smsys-modal-hint", statusFromChosen());

    const overlay = h(".smsys-modal-overlay", { onClick: onOverlayClick },
        h(".smsys-modal", { onClick: e => e.stopPropagation() },
            h("h2.smsys-modal-title", title),
            statusText ? h("p.smsys-modal-status", statusText) : null,
            h(".smsys-modal-label", "Discipline"),
            discSelect,
            h(".smsys-modal-label", "Subject (optional)"),
            subjSelect,
            h(".smsys-modal-label", "Topic (optional)"),
            topicSelect,
            placementHint,
            h(".smsys-modal-actions", null,
                h("button.smsys-btn", { onClick: dismiss }, "Cancel"),
                saveBtn,
            ),
        )
    );

    discSelect.addEventListener("change", onDisciplineChange);
    subjSelect.addEventListener("change", onSubjectChange);
    topicSelect.addEventListener("change", onTopicChange);
    document.addEventListener("keydown", onKeydown);

    document.body.appendChild(overlay);
    discSelect.focus();

    async function onDisciplineChange() {
        chosen = null;
        clear(topicSelect);
        topicSelect.appendChild(h("option", { value: "" }, "— Pick a subject first —"));
        topicSelect.disabled = true;
        clear(subjSelect);
        subjSelect.appendChild(h("option", { value: "" }, "Loading…"));
        subjSelect.disabled = true;

        const dId = discSelect.value;
        if (!dId) {
            clear(subjSelect);
            subjSelect.appendChild(h("option", { value: "" }, "— Pick a discipline first —"));
            updateChoice();
            return;
        }
        let subjects = subjectsCache.get(dId);
        if (!subjects) {
            try {
                subjects = await invoke("subjects.list", {
                    discipline_id: Number(dId),
                });
            } catch (e) {
                toast(e.message, { error: true });
                clear(subjSelect);
                subjSelect.appendChild(h("option", { value: "" }, "(error)"));
                return;
            }
            subjectsCache.set(dId, subjects);
        }
        clear(subjSelect);
        subjSelect.appendChild(h("option", { value: "" }, "— None (assign at discipline) —"));
        for (const s of subjects) {
            if (exclude?.kind === "subject" && exclude.id === s.id) continue;
            subjSelect.appendChild(h("option", { value: String(s.id) }, s.name));
        }
        subjSelect.disabled = false;
        updateChoice();
    }

    async function onSubjectChange() {
        clear(topicSelect);
        topicSelect.appendChild(h("option", { value: "" }, "Loading…"));
        topicSelect.disabled = true;
        const sId = subjSelect.value;
        if (!sId) {
            clear(topicSelect);
            topicSelect.appendChild(h("option", { value: "" }, "— Pick a subject first —"));
            updateChoice();
            return;
        }
        let topics = topicsCache.get(sId);
        if (!topics) {
            try {
                topics = await invoke("topics.list", { subject_id: Number(sId) });
            } catch (e) {
                toast(e.message, { error: true });
                clear(topicSelect);
                topicSelect.appendChild(h("option", { value: "" }, "(error)"));
                return;
            }
            topicsCache.set(sId, topics);
        }
        clear(topicSelect);
        topicSelect.appendChild(h("option", { value: "" }, "— None (assign at subject) —"));
        for (const t of topics) {
            if (exclude?.kind === "topic" && exclude.id === t.id) continue;
            topicSelect.appendChild(h("option", { value: String(t.id) }, t.name));
        }
        topicSelect.disabled = false;
        updateChoice();
    }

    function onTopicChange() {
        updateChoice();
    }

    function updateChoice() {
        const dId = discSelect.value;
        const sId = subjSelect.value;
        const tId = topicSelect.value;
        if (tId) {
            chosen = { kind: "topic", id: Number(tId) };
        } else if (sId) {
            chosen = { kind: "subject", id: Number(sId) };
        } else if (dId) {
            chosen = { kind: "discipline", id: Number(dId) };
        } else {
            chosen = null;
        }
        if (chosen && exclude && chosen.kind === exclude.kind && chosen.id === exclude.id) {
            chosen = null;
        }
        saveBtn.disabled = chosen == null;
        placementHint.textContent = statusFromChosen();
    }

    function commit() {
        if (chosen == null) return;
        teardown();
        onConfirm(chosen);
    }

    function dismiss() {
        teardown();
        if (onCancel) onCancel();
    }

    function onOverlayClick() {
        dismiss();
    }

    function onKeydown(e) {
        if (e.key === "Escape") { e.preventDefault(); dismiss(); }
        if (e.key === "Enter" && !saveBtn.disabled) { e.preventDefault(); commit(); }
    }

    function teardown() {
        document.removeEventListener("keydown", onKeydown);
        overlay.remove();
    }
}
