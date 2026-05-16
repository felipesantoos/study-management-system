import { h, clear } from "../lib/dom.js";
import { invoke, safeInvoke, toast } from "../lib/bridge.js";

export async function render(container) {
    const page = h(".smsys-page");
    container.appendChild(page);

    page.appendChild(
        h(".smsys-page-header", null,
            h("h1.smsys-page-title", "Disciplines & Subjects"),
            h("div.smsys-page-actions", null,
                h("button.smsys-btn.smsys-btn-primary",
                    { onClick: onNewDiscipline },
                    "+ New Discipline"
                )
            )
        )
    );

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
    }

    await refresh();

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

    const storageKey = `smsys_discipline_collapsed_${d.id}`;
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

    const headerRow = h(".smsys-tree-row.is-discipline", { onClick: toggleCollapse },
        caretEl,
        h("span.smsys-tree-name", d.name),
        h(".smsys-tree-actions", null,
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
    for (const s of subjects) {
        const row = h(".smsys-tree-row.is-subject", null,
            h("span.smsys-tree-name", s.name),
            h(".smsys-tree-actions", null,
                h("button.smsys-tree-action",
                    { title: "Show notes in Browser",
                      onClick: () => onShowNotes(s) },
                    "show notes"
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
