import { h, clear } from "../lib/dom.js";
import { invoke, safeInvoke, toast } from "../lib/bridge.js";

export async function render(container) {
    const page = h(".smsys-page");
    container.appendChild(page);

    page.appendChild(
        h(".smsys-page-header", null,
            h("h1.smsys-page-title", "Disciplines & Subjects"),
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
        placeholder: "Filter disciplines and subjects…",
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

        for (const d of disciplines) {
            treeEl.appendChild(await renderDiscipline(d, refresh));
        }

        const q = filterInput.value.trim();
        if (q) applyFilter(q);
    }

    await refresh();

    function applyFilter(raw) {
        const query = raw.trim().toLowerCase();
        treeEl.querySelectorAll(".smsys-tree-discipline").forEach(wrap => {
            const dNameEl = wrap.querySelector(":scope > .smsys-tree-row .smsys-tree-name");
            const childrenEl = wrap.querySelector(".smsys-tree-children");
            const caretEl = wrap.querySelector(".smsys-tree-caret");
            const storageKey = wrap.dataset.storageKey;

            if (!query) {
                wrap.style.display = "";
                const wasCollapsed = storageKey && localStorage.getItem(storageKey) === "1";
                if (childrenEl) childrenEl.style.display = wasCollapsed ? "none" : "";
                if (caretEl) caretEl.textContent = wasCollapsed ? "▸" : "▾";
                if (childrenEl) {
                    childrenEl.querySelectorAll(".smsys-tree-row.is-subject")
                        .forEach(row => { row.style.display = ""; });
                    childrenEl.querySelectorAll(".smsys-tree-name").forEach(restoreHighlight);
                }
                restoreHighlight(dNameEl);
                return;
            }

            const dRaw = dNameEl ? (dNameEl.dataset.raw || dNameEl.textContent) : "";
            const dMatches = dRaw.toLowerCase().includes(query);
            let anySubjectMatch = false;

            if (childrenEl) {
                childrenEl.querySelectorAll(".smsys-tree-row.is-subject").forEach(row => {
                    const sNameEl = row.querySelector(".smsys-tree-name");
                    const sRaw = sNameEl ? (sNameEl.dataset.raw || sNameEl.textContent) : "";
                    const sMatches = sRaw.toLowerCase().includes(query);
                    if (dMatches) {
                        row.style.display = "";
                        highlight(sNameEl, sRaw, query);
                    } else if (sMatches) {
                        anySubjectMatch = true;
                        row.style.display = "";
                        highlight(sNameEl, sRaw, query);
                    } else {
                        row.style.display = "none";
                        restoreHighlight(sNameEl);
                    }
                });
            }

            if (dMatches || anySubjectMatch) {
                wrap.style.display = "";
                if (childrenEl) childrenEl.style.display = "";
                if (caretEl) caretEl.textContent = "▾";
                highlight(dNameEl, dRaw, query);
            } else {
                wrap.style.display = "none";
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

    const headerRow = h(".smsys-tree-row.is-discipline", { onClick: toggleCollapse },
        caretEl,
        h("span.smsys-tree-name", d.name),
        h(".smsys-tree-actions", null,
            swatchBtn,
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
    await loadSubjects(d.id, childrenEl, refreshAll);
    return wrap;
}

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
        const dueEl  = h("span.smsys-stat.is-due",  "·");
        const newEl  = h("span.smsys-stat.is-new",  "·");
        const lrnEl  = h("span.smsys-stat.is-lrn",  "·");
        const statsEl = h(".smsys-subject-stats.is-loading", null, dueEl, newEl, lrnEl);
        statEls.set(s.id, { statsEl, dueEl, newEl, lrnEl });

        const row = h(".smsys-tree-row.is-subject", null,
            h("span.smsys-tree-name", s.name),
            h("span.smsys-badge", `${s.note_count} notes`),
            statsEl,
            h(".smsys-tree-actions", null,
                h("button.smsys-tree-action.smsys-tree-action--study",
                    { title: "Start a study session for this subject",
                      onClick: () => onStudySubject(s) },
                    "study now"
                ),
                h("button.smsys-tree-action",
                    { title: "Show notes in Browser",
                      onClick: () => onShowNotes(s) },
                    "show notes"
                ),
                h("button.smsys-tree-action",
                    { title: "Move all notes to another subject",
                      onClick: () => onMoveAllNotes(s, refreshAll) },
                    "move all"
                ),
                h("button.smsys-tree-action",
                    { title: "Rename",
                      onClick: () => onRenameSubject(s, row, refreshAll) },
                    "rename"
                ),
                h("button.smsys-tree-action.smsys-btn-danger",
                    { title: "Delete",
                      onClick: () => onDeleteSubject(s, row, refreshAll) },
                    "delete"
                ),
            )
        );
        container.appendChild(row);
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
            message: `Delete "${d.name}" and all its subjects?`,
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
            message: `Delete subject "${s.name}"? Note assignments will be cleared.`,
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

async function onStudySubject(s) {
    try {
        await invoke("anki.study_subject", { subject_id: s.id });
    } catch (e) {
        toast(e.message, { error: true });
    }
}

async function onShowNotes(s) {
    try {
        const noteIds = await invoke("subjects.note_ids", { id: s.id });
        if (!noteIds.length) {
            toast("No notes assigned to this subject yet.");
            return;
        }
        await invoke("anki.open_browser_for_notes", { note_ids: noteIds });
    } catch (e) {
        toast(e.message, { error: true });
    }
}

async function onMoveAllNotes(source, refreshAll) {
    let noteIds;
    try {
        noteIds = await invoke("subjects.note_ids", { id: source.id });
    } catch (e) {
        toast(e.message, { error: true });
        return;
    }
    if (!noteIds.length) {
        toast("No notes to move from this subject.");
        return;
    }

    let disciplines;
    try {
        disciplines = await invoke("disciplines.list");
    } catch (e) {
        toast(e.message, { error: true });
        return;
    }

    showSubjectPickerModal({
        title: "Move all notes",
        statusText: `Moving ${noteIds.length} note${noteIds.length === 1 ? "" : "s"} from "${source.name}".`,
        disciplines,
        excludeSubjectId: source.id,
        async onConfirm(targetSubjectId) {
            try {
                const moved = await invoke("notes.bulk_assign", {
                    note_ids: noteIds,
                    subject_id: targetSubjectId,
                });
                toast(`Moved ${moved} note${moved === 1 ? "" : "s"}.`);
                await refreshAll();
            } catch (e) {
                toast(e.message, { error: true });
            }
        },
    });
}

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

function showSubjectPickerModal({
    title,
    statusText,
    disciplines,
    excludeSubjectId = null,
    onConfirm,
    onCancel,
}) {
    let subjectsCache = new Map(); // discipline_id -> [subjects]
    let chosenSubjectId = null;

    const discSelect = h("select.smsys-modal-select",
        h("option", { value: "" }, "— Select a discipline —"),
        ...disciplines.map(d =>
            h("option", { value: String(d.id) }, d.name)
        )
    );

    const subjSelect = h("select.smsys-modal-select", { disabled: true },
        h("option", { value: "" }, "— Select a subject —"),
    );

    const saveBtn = h("button.smsys-btn.smsys-btn-primary",
        { disabled: true, onClick: commit },
        "Move"
    );

    const overlay = h(".smsys-modal-overlay", { onClick: onOverlayClick },
        h(".smsys-modal", { onClick: e => e.stopPropagation() },
            h("h2.smsys-modal-title", title),
            statusText ? h("p.smsys-modal-status", statusText) : null,
            h(".smsys-modal-label", "Discipline"),
            discSelect,
            h(".smsys-modal-label", "Subject"),
            subjSelect,
            h(".smsys-modal-actions", null,
                h("button.smsys-btn", { onClick: dismiss }, "Cancel"),
                saveBtn,
            ),
        )
    );

    discSelect.addEventListener("change", onDisciplineChange);
    subjSelect.addEventListener("change", onSubjectChange);
    document.addEventListener("keydown", onKeydown);

    document.body.appendChild(overlay);
    discSelect.focus();

    async function onDisciplineChange() {
        chosenSubjectId = null;
        saveBtn.disabled = true;
        subjSelect.disabled = true;
        clear(subjSelect);
        subjSelect.appendChild(
            h("option", { value: "" }, "Loading…")
        );
        const dId = discSelect.value;
        if (!dId) {
            clear(subjSelect);
            subjSelect.appendChild(
                h("option", { value: "" }, "— Select a subject —")
            );
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
                subjSelect.appendChild(
                    h("option", { value: "" }, "— Select a subject —")
                );
                return;
            }
            subjectsCache.set(dId, subjects);
        }
        clear(subjSelect);
        subjSelect.appendChild(
            h("option", { value: "" }, "— Select a subject —")
        );
        const eligible = subjects.filter(s => s.id !== excludeSubjectId);
        if (!eligible.length) {
            subjSelect.appendChild(
                h("option", { value: "", disabled: true },
                  "(no other subjects in this discipline)")
            );
        } else {
            for (const s of eligible) {
                subjSelect.appendChild(
                    h("option", { value: String(s.id) }, s.name)
                );
            }
        }
        subjSelect.disabled = false;
    }

    function onSubjectChange() {
        const v = subjSelect.value;
        chosenSubjectId = v ? Number(v) : null;
        saveBtn.disabled = chosenSubjectId == null;
    }

    function commit() {
        if (chosenSubjectId == null) return;
        teardown();
        onConfirm(chosenSubjectId);
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
