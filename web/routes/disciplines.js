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

    async function onNewDiscipline() {
        const name = window.prompt("New discipline name:");
        if (!name || !name.trim()) return;
        try {
            await invoke("disciplines.create", { name });
            toast("Discipline created.");
            await refresh();
        } catch (e) {
            toast(e.message, { error: true });
        }
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
                { title: "Rename", onClick: (e) => { e.stopPropagation(); onRenameDiscipline(d, refreshAll); } },
                "rename"
            ),
            h("button.smsys-tree-action.smsys-btn-danger",
                { title: "Delete", onClick: (e) => { e.stopPropagation(); onDeleteDiscipline(d, refreshAll); } },
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
        container.appendChild(
            h(".smsys-tree-row.is-subject", null,
                h("span.smsys-tree-name", s.name),
                h(".smsys-tree-actions", null,
                    h("button.smsys-tree-action",
                        { title: "Show notes in Browser",
                          onClick: () => onShowNotes(s) },
                        "show notes"
                    ),
                    h("button.smsys-tree-action",
                        { title: "Rename",
                          onClick: () => onRenameSubject(s, refreshAll) },
                        "rename"
                    ),
                    h("button.smsys-tree-action.smsys-btn-danger",
                        { title: "Delete",
                          onClick: () => onDeleteSubject(s, refreshAll) },
                        "delete"
                    ),
                )
            )
        );
    }
}

async function onAddSubject(d, childrenEl, refreshAll) {
    const name = window.prompt(`New subject under "${d.name}":`);
    if (!name || !name.trim()) return;
    try {
        await invoke("subjects.create", { discipline_id: d.id, name });
        toast("Subject created.");
        await loadSubjects(d.id, childrenEl, refreshAll);
    } catch (e) {
        toast(e.message, { error: true });
    }
}

async function onRenameDiscipline(d, refreshAll) {
    const name = window.prompt("Rename discipline:", d.name);
    if (!name || !name.trim() || name === d.name) return;
    try {
        await invoke("disciplines.rename", { id: d.id, name });
        toast("Renamed.");
        await refreshAll();
    } catch (e) {
        toast(e.message, { error: true });
    }
}

async function onDeleteDiscipline(d, refreshAll) {
    if (!window.confirm(
        `Delete the discipline "${d.name}"?\n\n` +
        "All its subjects and note assignments will be removed."
    )) return;
    try {
        await invoke("disciplines.delete", { id: d.id });
        toast("Deleted.");
        await refreshAll();
    } catch (e) {
        toast(e.message, { error: true });
    }
}

async function onRenameSubject(s, refreshAll) {
    const name = window.prompt("Rename subject:", s.name);
    if (!name || !name.trim() || name === s.name) return;
    try {
        await invoke("subjects.rename", { id: s.id, name });
        toast("Renamed.");
        await refreshAll();
    } catch (e) {
        toast(e.message, { error: true });
    }
}

async function onDeleteSubject(s, refreshAll) {
    if (!window.confirm(
        `Delete the subject "${s.name}"?\n\nNote assignments to it will be cleared.`
    )) return;
    try {
        await invoke("subjects.delete", { id: s.id });
        toast("Deleted.");
        await refreshAll();
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
