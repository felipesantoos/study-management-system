import { h, clear } from "../lib/dom.js";
import { invoke, toast } from "../lib/bridge.js";

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
                    { onClick: () => refresh() },
                    "↺ Refresh"
                ),
                h("button.smsys-btn.smsys-btn-primary",
                    { onClick: onNewDiscipline },
                    "+ New Discipline"
                )
            )
        )
    );

    const filterInput = h("input.smsys-filter-input", {
        type: "search",
        placeholder: "Filter disciplines, subjects, and topics…",
        onInput: e => applyFilter(e.target.value),
    });
    page.appendChild(h(".smsys-filter-bar", null, filterInput));

    const treeEl = h(".smsys-tree");
    page.appendChild(treeEl);

    async function refresh() {
        clear(treeEl);
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
            treeEl.appendChild(
                h(".smsys-empty", "No disciplines yet. Click + New Discipline above.")
            );
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
                entry.statsEl.classList.remove("is-loading");
                entry.statsEl.classList.toggle("is-all-zero", stat.due === 0 && stat.new === 0 && stat.lrn === 0);
                entry.dueEl.textContent = `${stat.due} due`;
                entry.newEl.textContent = `${stat.new} new`;
                entry.lrnEl.textContent = `${stat.lrn} lrn`;
            }
        } catch (_) {
            for (const { statsEl } of discStatEls.values()) {
                statsEl.classList.replace("is-loading", "is-error");
            }
        }

        const q = filterInput.value.trim();
        if (q) applyFilter(q);
    }

    await refresh();

    function applyFilter(raw) {
        const query = raw.trim().toLowerCase();
        treeEl.querySelectorAll(":scope > .smsys-tree-discipline").forEach(dWrap => {
            const dNameEl = dWrap.querySelector(":scope > .smsys-tree-row .smsys-tree-name");
            const dChildren = dWrap.querySelector(":scope > .smsys-tree-children");
            const dCaret = dWrap.querySelector(":scope > .smsys-tree-row .smsys-tree-caret");
            const dKey = dWrap.dataset.storageKey;

            if (!query) {
                dWrap.style.display = "";
                const wasCollapsed = dKey && localStorage.getItem(dKey) === "1";
                if (dChildren) dChildren.style.display = wasCollapsed ? "none" : "";
                if (dCaret) dCaret.textContent = wasCollapsed ? "▸" : "▾";
                if (dChildren) {
                    dChildren.querySelectorAll(".smsys-tree-subject")
                        .forEach(sWrap => {
                            sWrap.style.display = "";
                            const sChildren = sWrap.querySelector(":scope > .smsys-tree-children");
                            const sCaret = sWrap.querySelector(":scope > .smsys-tree-row .smsys-tree-caret");
                            const sKey = sWrap.dataset.storageKey;
                            const sWasCollapsed = !sKey || localStorage.getItem(sKey) !== "0";
                            if (sChildren) sChildren.style.display = sWasCollapsed ? "none" : "";
                            if (sCaret) sCaret.textContent = sWasCollapsed ? "▸" : "▾";
                            sWrap.querySelectorAll(".smsys-tree-row.is-topic")
                                .forEach(r => { r.style.display = ""; });
                        });
                    dChildren.querySelectorAll(".smsys-tree-name").forEach(restoreHighlight);
                }
                restoreHighlight(dNameEl);
                return;
            }

            const dRaw = dNameEl ? (dNameEl.dataset.raw || dNameEl.textContent) : "";
            const dMatches = dRaw.toLowerCase().includes(query);
            let anyChildMatch = false;

            if (dChildren) {
                dChildren.querySelectorAll(":scope > .smsys-tree-subject").forEach(sWrap => {
                    const sNameEl = sWrap.querySelector(":scope > .smsys-tree-row .smsys-tree-name");
                    const sRaw = sNameEl ? (sNameEl.dataset.raw || sNameEl.textContent) : "";
                    const sMatches = sRaw.toLowerCase().includes(query);
                    const sChildren = sWrap.querySelector(":scope > .smsys-tree-children");
                    const sCaret = sWrap.querySelector(":scope > .smsys-tree-row .smsys-tree-caret");
                    let anyTopicMatch = false;

                    if (sChildren) {
                        sChildren.querySelectorAll(":scope > .smsys-tree-row.is-topic").forEach(tRow => {
                            const tNameEl = tRow.querySelector(".smsys-tree-name");
                            const tRaw = tNameEl ? (tNameEl.dataset.raw || tNameEl.textContent) : "";
                            const tMatches = tRaw.toLowerCase().includes(query);
                            if (dMatches || sMatches) {
                                tRow.style.display = "";
                                highlight(tNameEl, tRaw, query);
                            } else if (tMatches) {
                                anyTopicMatch = true;
                                tRow.style.display = "";
                                highlight(tNameEl, tRaw, query);
                            } else {
                                tRow.style.display = "none";
                                restoreHighlight(tNameEl);
                            }
                        });
                    }

                    if (dMatches || sMatches || anyTopicMatch) {
                        anyChildMatch = true;
                        sWrap.style.display = "";
                        if (sChildren) sChildren.style.display = "";
                        if (sCaret) sCaret.textContent = "▾";
                        highlight(sNameEl, sRaw, query);
                    } else {
                        sWrap.style.display = "none";
                        restoreHighlight(sNameEl);
                    }
                });
            }

            if (dMatches || anyChildMatch) {
                dWrap.style.display = "";
                if (dChildren) dChildren.style.display = "";
                if (dCaret) dCaret.textContent = "▾";
                highlight(dNameEl, dRaw, query);
            } else {
                dWrap.style.display = "none";
            }
        });
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
                        toast("Discipline created.");
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

    if (d.color) {
        wrap.style.borderLeftColor = d.color;
        wrap.style.borderLeftWidth = "4px";
    }

    const storageKey = `smsys_discipline_collapsed_${d.id}`;
    wrap.dataset.storageKey = storageKey;
    const startCollapsed = localStorage.getItem(storageKey) === "1";

    const caretEl = h("span.smsys-tree-caret", startCollapsed ? "▸" : "▾");
    if (startCollapsed) childrenEl.style.display = "none";

    function toggleCollapse(e) {
        e.stopPropagation();
        const collapsed = childrenEl.style.display === "none";
        childrenEl.style.display = collapsed ? "" : "none";
        caretEl.textContent = collapsed ? "▾" : "▸";
        localStorage.setItem(storageKey, collapsed ? "0" : "1");
    }

    const colorDot = h("span.smsys-color-dot");
    if (d.color) colorDot.style.background = d.color;

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = d.color || "#0d6efd";
    colorInput.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;opacity:0;";
    colorInput.addEventListener("change", async () => {
        const color = colorInput.value;
        try {
            await invoke("disciplines.set_color", { id: d.id, color });
            d.color = color;
            colorDot.style.background = color;
            wrap.style.borderLeftColor = color;
            wrap.style.borderLeftWidth = "4px";
        } catch (err) {
            toast(err.message, { error: true });
        }
    });

    const swatchBtn = h("button.smsys-tree-action.smsys-color-btn",
        { title: "Set color", onClick: (e) => { e.stopPropagation(); colorInput.click(); } },
        colorDot
    );
    swatchBtn.appendChild(colorInput);

    const dragHandle = h("span.smsys-drag-handle", { title: "Drag to reorder" }, "⠿");

    const discDueEl  = h("span.smsys-stat.is-due",  "·");
    const discNewEl  = h("span.smsys-stat.is-new",  "·");
    const discLrnEl  = h("span.smsys-stat.is-lrn",  "·");
    const discStatsEl = h(".smsys-subject-stats.is-loading", null, discDueEl, discNewEl, discLrnEl);

    const headerRow = h(".smsys-tree-row.is-discipline", { onClick: toggleCollapse },
        dragHandle,
        caretEl,
        h("span.smsys-tree-name", d.name),
        h("span.smsys-badge", `${d.note_count} notes`),
        discStatsEl,
        h(".smsys-tree-actions", null,
            h("button.smsys-tree-action",
                {
                    title: "Move up",
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
                "↑"
            ),
            h("button.smsys-tree-action",
                {
                    title: "Move down",
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
                "↓"
            ),
            swatchBtn,
            h("button.smsys-tree-action.smsys-tree-action--study",
                { title: "Study every note under this discipline",
                  onClick: (e) => { e.stopPropagation(); onStudyDiscipline(d); } },
                "study"
            ),
            h("button.smsys-tree-action",
                { title: "Show every note under this discipline in Browser",
                  onClick: (e) => { e.stopPropagation(); onShowDisciplineNotes(d); } },
                "show notes"
            ),
            h("button.smsys-tree-action",
                { title: "Add subject", onClick: (e) => { e.stopPropagation(); onAddSubject(d, childrenEl, refreshAll); } },
                "+ subject"
            ),
            h("button.smsys-tree-action",
                { title: "Rename", onClick: (e) => { e.stopPropagation(); onRenameDiscipline(d, headerRow, refreshAll); } },
                "rename"
            ),
            h("button.smsys-tree-action.smsys-btn-danger",
                { title: "Delete", onClick: (e) => { e.stopPropagation(); onDeleteDiscipline(d, headerRow, refreshAll); } },
                "delete"
            ),
        )
    );

    wrap.appendChild(headerRow);
    wrap.appendChild(childrenEl);
    wireDisciplineDrag(wrap, dragHandle, d);
    await loadSubjects(d.id, childrenEl, refreshAll);
    return { wrap, statsEl: discStatsEl, dueEl: discDueEl, newEl: discNewEl, lrnEl: discLrnEl };
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
            const { statsEl, dueEl, newEl, lrnEl } = entry;
            statsEl.classList.remove("is-loading");
            statsEl.classList.toggle("is-all-zero", stat.due === 0 && stat.new === 0 && stat.lrn === 0);
            dueEl.textContent = `${stat.due} due`;
            newEl.textContent = `${stat.new} new`;
            lrnEl.textContent = `${stat.lrn} lrn`;
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

    const caretEl = h("span.smsys-tree-caret", startCollapsed ? "▸" : "▾");
    if (startCollapsed) topicsEl.style.display = "none";
    let topicsLoaded = !startCollapsed;

    async function toggleCollapse(e) {
        e.stopPropagation();
        const collapsed = topicsEl.style.display === "none";
        topicsEl.style.display = collapsed ? "" : "none";
        caretEl.textContent = collapsed ? "▾" : "▸";
        localStorage.setItem(storageKey, collapsed ? "0" : "1");
        if (collapsed && !topicsLoaded) {
            topicsLoaded = true;
            await loadTopics(s.id, topicsEl, refreshAll);
        }
    }

    const dueEl  = h("span.smsys-stat.is-due",  "·");
    const newEl  = h("span.smsys-stat.is-new",  "·");
    const lrnEl  = h("span.smsys-stat.is-lrn",  "·");
    const statsEl = h(".smsys-subject-stats.is-loading", null, dueEl, newEl, lrnEl);
    statEls.set(s.id, { statsEl, dueEl, newEl, lrnEl });

    const dragHandle = h("span.smsys-drag-handle", { title: "Drag to reorder" }, "⠿");
    const row = h(".smsys-tree-row.is-subject", { onClick: toggleCollapse },
        dragHandle,
        caretEl,
        h("span.smsys-tree-name", s.name),
        h("span.smsys-badge", `${s.note_count} notes`),
        s.topic_count > 0 && h("span.smsys-badge", `${s.topic_count} topic${s.topic_count === 1 ? "" : "s"}`),
        statsEl,
        h(".smsys-tree-actions", null,
            h("button.smsys-tree-action",
                {
                    title: "Move up",
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
                "↑"
            ),
            h("button.smsys-tree-action",
                {
                    title: "Move down",
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
                "↓"
            ),
            h("button.smsys-tree-action.smsys-tree-action--study",
                { title: "Start a study session for this subject (incl. its topics)",
                  onClick: (e) => { e.stopPropagation(); onStudySubject(s); } },
                "study"
            ),
            h("button.smsys-tree-action",
                { title: "Show notes in Browser",
                  onClick: (e) => { e.stopPropagation(); onShowSubjectNotes(s); } },
                "show notes"
            ),
            h("button.smsys-tree-action",
                { title: "Add topic", onClick: (e) => { e.stopPropagation(); onAddTopic(s, topicsEl, refreshAll); } },
                "+ topic"
            ),
            h("button.smsys-tree-action",
                { title: "Move all notes to another placement",
                  onClick: (e) => { e.stopPropagation(); onMoveAllNotes("subject", s, refreshAll); } },
                "move all"
            ),
            h("button.smsys-tree-action",
                { title: "Rename",
                  onClick: (e) => { e.stopPropagation(); onRenameSubject(s, row, refreshAll); } },
                "rename"
            ),
            h("button.smsys-tree-action.smsys-btn-danger",
                { title: "Delete",
                  onClick: (e) => { e.stopPropagation(); onDeleteSubject(s, row, refreshAll); } },
                "delete"
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
        const dueEl = h("span.smsys-stat.is-due", "·");
        const newEl = h("span.smsys-stat.is-new", "·");
        const lrnEl = h("span.smsys-stat.is-lrn", "·");
        const statsEl = h(".smsys-subject-stats.is-loading", null, dueEl, newEl, lrnEl);
        statEls.set(t.id, { statsEl, dueEl, newEl, lrnEl });

        const dragHandle = h("span.smsys-drag-handle", { title: "Drag to reorder" }, "⠿");
        const row = h(".smsys-tree-row.is-topic", null,
            dragHandle,
            h("span.smsys-tree-name", t.name),
            h("span.smsys-badge", `${t.note_count} notes`),
            statsEl,
            h(".smsys-tree-actions", null,
                h("button.smsys-tree-action",
                    {
                        title: "Move up",
                        onClick: async (e) => {
                            e.stopPropagation();
                            const prev = row.previousElementSibling;
                            if (prev?.classList.contains("is-topic")) {
                                container.insertBefore(row, prev);
                                await reorderTopics(container, subjectId);
                            }
                        }
                    },
                    "↑"
                ),
                h("button.smsys-tree-action",
                    {
                        title: "Move down",
                        onClick: async (e) => {
                            e.stopPropagation();
                            const next = row.nextElementSibling;
                            if (next?.classList.contains("is-topic")) {
                                container.insertBefore(next, row);
                                await reorderTopics(container, subjectId);
                            }
                        }
                    },
                    "↓"
                ),
                h("button.smsys-tree-action.smsys-tree-action--study",
                    { title: "Start a study session for this topic",
                      onClick: () => onStudyTopic(t) },
                    "study"
                ),
                h("button.smsys-tree-action",
                    { title: "Show notes in Browser",
                      onClick: () => onShowTopicNotes(t) },
                    "show notes"
                ),
                h("button.smsys-tree-action",
                    { title: "Move all notes to another placement",
                      onClick: () => onMoveAllNotes("topic", t, refreshAll) },
                    "move all"
                ),
                h("button.smsys-tree-action",
                    { title: "Rename",
                      onClick: () => onRenameTopic(t, row, refreshAll) },
                    "rename"
                ),
                h("button.smsys-tree-action.smsys-btn-danger",
                    { title: "Delete",
                      onClick: () => onDeleteTopic(t, row, refreshAll) },
                    "delete"
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
            const { statsEl, dueEl, newEl, lrnEl } = entry;
            statsEl.classList.remove("is-loading");
            statsEl.classList.toggle("is-all-zero", stat.due === 0 && stat.new === 0 && stat.lrn === 0);
            dueEl.textContent = `${stat.due} due`;
            newEl.textContent = `${stat.new} new`;
            lrnEl.textContent = `${stat.lrn} lrn`;
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
                    toast("Subject created.");
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
                    toast("Topic created.");
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
                    toast("Renamed.");
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
                    toast("Deleted.");
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
                    toast("Renamed.");
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
                    toast("Deleted.");
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
                    toast("Renamed.");
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
                    toast("Deleted.");
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
                toast(`Moved ${moved} note${moved === 1 ? "" : "s"}.`);
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
            onClick: () => { widget.remove(); onConfirm(); }
        }, "Delete"),
        h("button.smsys-btn", {
            onClick: () => { widget.remove(); if (onCancel) onCancel(); }
        }, "Cancel"),
    );

    insert(widget);
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
