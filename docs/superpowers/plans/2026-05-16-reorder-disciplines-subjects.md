# Reorder Disciplines & Subjects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drag-and-drop reordering (with ↑/↓ arrow fallback) for disciplines and subjects, persisted via a `position` INTEGER column in the database.

**Architecture:** Add a `position` column to `disciplines` and `subjects` via a non-destructive `ALTER TABLE` migration run on every DB open (idempotent check via `PRAGMA table_info`). `list_disciplines` and `list_subjects` sort by `position, name`. Two new RPC methods (`disciplines.reorder`, `subjects.reorder`) accept an ordered list of IDs and re-number positions 0, 1, 2…. The frontend uses HTML5 Drag & Drop API on the existing DOM elements plus ↑/↓ action buttons in the hover-visible action strip.

**Tech Stack:** Python 3 + SQLite3, vanilla JS ES modules (no new dependencies)

---

## File Map

| File | Change |
|------|--------|
| `db.py` | Add `_migrate()`, update `list_disciplines/list_subjects`, update `add_discipline/add_subject`, add `reorder_disciplines/reorder_subjects` |
| `api.py` | Update `_row_to_discipline/_row_to_subject` to include `position`; add `disciplines.reorder` and `subjects.reorder` handlers |
| `web/routes/disciplines.js` | Add drag state module variable, drag event wiring, ↑/↓ arrow buttons, `reorderDisciplines/reorderSubjects` helpers |
| `web/app.css` | Add `.smsys-drag-handle`, `.is-dragging`, `.is-drag-over-before`, `.is-drag-over-after` styles |

---

### Task 1: DB migration — add `position` column

**Files:**
- Modify: `db.py:23-46` (`_init_schema`) and `db.py:17` (`__init__`)

- [ ] **Step 1: Add `_migrate()` to `SubjectsDB` and call it from `__init__`**

Replace the `SubjectsDB.__init__` and add the migration method. The full updated block for `db.py` lines 17-46:

```python
def __init__(self, path: str) -> None:
    self.con = sqlite3.connect(path)
    self.con.execute("PRAGMA foreign_keys = ON")
    self.con.row_factory = sqlite3.Row
    self._init_schema()
    self._migrate()

def _migrate(self) -> None:
    """Add position columns if they don't exist yet (idempotent)."""
    disc_cols = {r[1] for r in self.con.execute("PRAGMA table_info(disciplines)")}
    if "position" not in disc_cols:
        self.con.execute(
            "ALTER TABLE disciplines ADD COLUMN position INTEGER NOT NULL DEFAULT 0"
        )
        rows = self.con.execute(
            "SELECT id FROM disciplines ORDER BY name"
        ).fetchall()
        for i, row in enumerate(rows):
            self.con.execute(
                "UPDATE disciplines SET position = ? WHERE id = ?", (i, row[0])
            )

    subj_cols = {r[1] for r in self.con.execute("PRAGMA table_info(subjects)")}
    if "position" not in subj_cols:
        self.con.execute(
            "ALTER TABLE subjects ADD COLUMN position INTEGER NOT NULL DEFAULT 0"
        )
        disc_ids = [
            r[0] for r in self.con.execute("SELECT id FROM disciplines")
        ]
        for did in disc_ids:
            rows = self.con.execute(
                "SELECT id FROM subjects WHERE discipline_id = ? ORDER BY name",
                (did,),
            ).fetchall()
            for i, row in enumerate(rows):
                self.con.execute(
                    "UPDATE subjects SET position = ? WHERE id = ?", (i, row[0])
                )

    self.con.commit()
```

- [ ] **Step 2: Verify migration is idempotent — run twice without error**

There are no automated tests in this project. Manual check: the `PRAGMA table_info` guard means running `_migrate()` a second time (column already exists) is a no-op. Confirm by reading the code — `if "position" not in disc_cols` skips the block on the second call.

- [ ] **Step 3: Commit**

```bash
cd /mnt/c/Users/felip/AppData/Roaming/Anki2/addons21/study-management-system
git add db.py
git commit -m "feat(FDA-689): add position column migration for disciplines and subjects

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 2: Update list queries and insert methods in `db.py`

**Files:**
- Modify: `db.py:48-51` (`list_disciplines`), `db.py:73-86` (`list_subjects`), `db.py:53-58` (`add_discipline`), `db.py:88-94` (`add_subject`)

- [ ] **Step 1: Update `list_disciplines` to sort by position**

```python
def list_disciplines(self) -> list[sqlite3.Row]:
    return list(
        self.con.execute(
            "SELECT id, name, position FROM disciplines ORDER BY position, name"
        )
    )
```

- [ ] **Step 2: Update `list_subjects` to sort by position**

```python
def list_subjects(self, discipline_id: int) -> list[sqlite3.Row]:
    return list(
        self.con.execute(
            """
            SELECT s.id, s.name, s.position, COUNT(ns.note_id) AS note_count
              FROM subjects s
              LEFT JOIN note_subjects ns ON ns.subject_id = s.id
             WHERE s.discipline_id = ?
             GROUP BY s.id, s.name, s.position
             ORDER BY s.position, s.name
            """,
            (discipline_id,),
        )
    )
```

- [ ] **Step 3: Update `add_discipline` to assign next position**

```python
def add_discipline(self, name: str) -> int:
    max_pos = self.con.execute(
        "SELECT COALESCE(MAX(position), -1) FROM disciplines"
    ).fetchone()[0]
    cur = self.con.execute(
        "INSERT INTO disciplines (name, position) VALUES (?, ?)",
        (name, max_pos + 1),
    )
    self.con.commit()
    return cur.lastrowid
```

- [ ] **Step 4: Update `add_subject` to assign next position within discipline**

```python
def add_subject(self, discipline_id: int, name: str) -> int:
    max_pos = self.con.execute(
        "SELECT COALESCE(MAX(position), -1) FROM subjects WHERE discipline_id = ?",
        (discipline_id,),
    ).fetchone()[0]
    cur = self.con.execute(
        "INSERT INTO subjects (discipline_id, name, position) VALUES (?, ?, ?)",
        (discipline_id, name, max_pos + 1),
    )
    self.con.commit()
    return cur.lastrowid
```

- [ ] **Step 5: Commit**

```bash
git add db.py
git commit -m "feat(FDA-689): sort disciplines and subjects by position; assign position on insert

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 3: Add `reorder_disciplines` and `reorder_subjects` to `db.py`

**Files:**
- Modify: `db.py` (add two new methods after `delete_discipline` and `delete_subject`)

- [ ] **Step 1: Add `reorder_disciplines` after `delete_discipline` (line 71)**

```python
def reorder_disciplines(self, ordered_ids: list[int]) -> None:
    """Re-number positions 0, 1, 2… according to caller-supplied order."""
    for i, discipline_id in enumerate(ordered_ids):
        self.con.execute(
            "UPDATE disciplines SET position = ? WHERE id = ?",
            (i, discipline_id),
        )
    self.con.commit()
```

- [ ] **Step 2: Add `reorder_subjects` after `delete_subject` (line 104)**

```python
def reorder_subjects(self, discipline_id: int, ordered_ids: list[int]) -> None:
    """Re-number positions 0, 1, 2… for subjects within a discipline."""
    for i, subject_id in enumerate(ordered_ids):
        self.con.execute(
            "UPDATE subjects SET position = ? WHERE id = ?",
            (i, subject_id),
        )
    self.con.commit()
```

- [ ] **Step 3: Commit**

```bash
git add db.py
git commit -m "feat(FDA-689): add reorder_disciplines and reorder_subjects to db layer

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 4: Update `api.py` — row helpers + reorder handlers

**Files:**
- Modify: `api.py:24-29` (row helpers), `api.py` (add two new handlers after `disciplines_delete` and `subjects_delete`)

- [ ] **Step 1: Update `_row_to_discipline` to include `position`**

```python
def _row_to_discipline(row: sqlite3.Row) -> dict[str, Any]:
    return {"id": int(row["id"]), "name": row["name"], "position": int(row["position"])}
```

- [ ] **Step 2: Update `_row_to_subject` to include `position`**

```python
def _row_to_subject(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "name": row["name"],
        "note_count": int(row["note_count"]),
        "position": int(row["position"]),
    }
```

- [ ] **Step 3: Add `disciplines.reorder` handler after `disciplines_delete`**

```python
@register("disciplines.reorder")
def disciplines_reorder(ids: list) -> None:
    db().reorder_disciplines([int(i) for i in ids])
```

- [ ] **Step 4: Add `subjects.reorder` handler after `subjects_delete`**

```python
@register("subjects.reorder")
def subjects_reorder(discipline_id: int, ids: list) -> None:
    db().reorder_subjects(int(discipline_id), [int(i) for i in ids])
```

- [ ] **Step 5: Commit**

```bash
git add api.py
git commit -m "feat(FDA-689): expose disciplines.reorder and subjects.reorder via RPC

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 5: CSS — drag handle, drag states

**Files:**
- Modify: `web/app.css` (append at end)

- [ ] **Step 1: Append drag-and-drop styles to `web/app.css`**

```css
/* ----- drag-and-drop reordering ----- */
.smsys-drag-handle {
    cursor: grab;
    color: var(--smsys-muted);
    padding: 0 6px 0 0;
    opacity: 0;
    transition: opacity 0.1s;
    font-size: 16px;
    line-height: 1;
    user-select: none;
    flex-shrink: 0;
}
.smsys-tree-row:hover .smsys-drag-handle { opacity: 0.6; }
.smsys-drag-handle:hover { opacity: 1 !important; }

.smsys-tree-discipline.is-dragging,
.smsys-tree-row.is-dragging { opacity: 0.4; }

.smsys-tree-discipline.is-drag-over-before { box-shadow: 0 -2px 0 var(--smsys-accent); }
.smsys-tree-discipline.is-drag-over-after  { box-shadow: 0  2px 0 var(--smsys-accent); }

.smsys-tree-row.is-subject.is-drag-over-before { box-shadow: 0 -2px 0 var(--smsys-accent); }
.smsys-tree-row.is-subject.is-drag-over-after  { box-shadow: 0  2px 0 var(--smsys-accent); }
```

- [ ] **Step 2: Commit**

```bash
git add web/app.css
git commit -m "feat(FDA-689): add drag handle and drag-over indicator styles

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

### Task 6: Frontend — drag-and-drop + arrow buttons in `disciplines.js`

**Files:**
- Modify: `web/routes/disciplines.js` (full rewrite of `renderDiscipline` and `loadSubjects`, plus new module-level helpers)

The full updated `web/routes/disciplines.js`:

- [ ] **Step 1: Add module-level drag state variable at top of file (after imports)**

```js
// module-level drag state — only one drag active at a time
let dragState = null; // { type: 'discipline'|'subject', id, disciplineId? }
```

- [ ] **Step 2: Add `reorderDisciplines` helper function (module-level)**

```js
async function reorderDisciplines(container) {
    const ids = [...container.querySelectorAll(".smsys-tree-discipline")]
        .map(el => parseInt(el.dataset.id, 10));
    try {
        await invoke("disciplines.reorder", { ids });
    } catch (e) {
        toast(e.message, { error: true });
    }
}
```

- [ ] **Step 3: Add `reorderSubjects` helper function (module-level)**

```js
async function reorderSubjects(container, disciplineId) {
    const ids = [...container.querySelectorAll(".smsys-tree-row.is-subject")]
        .map(el => parseInt(el.dataset.id, 10));
    try {
        await invoke("subjects.reorder", { discipline_id: disciplineId, ids });
    } catch (e) {
        toast(e.message, { error: true });
    }
}
```

- [ ] **Step 4: Add `wireDisciplineDrag` function (module-level)**

```js
function wireDisciplineDrag(wrap, d) {
    wrap.draggable = true;
    wrap.dataset.id = d.id;

    wrap.addEventListener("dragstart", e => {
        dragState = { type: "discipline", id: d.id };
        wrap.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        // Show only the header row as the drag ghost
        const header = wrap.querySelector(".smsys-tree-row.is-discipline");
        if (header) e.dataTransfer.setDragImage(header, 0, 0);
    });

    wrap.addEventListener("dragend", () => {
        wrap.classList.remove("is-dragging");
        document.querySelectorAll(".is-drag-over-before, .is-drag-over-after")
            .forEach(el => el.classList.remove("is-drag-over-before", "is-drag-over-after"));
        dragState = null;
    });

    wrap.addEventListener("dragover", e => {
        if (!dragState || dragState.type !== "discipline" || dragState.id === d.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = wrap.getBoundingClientRect();
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
        const srcEl = container.querySelector(`[data-id="${dragState.id}"]`);
        if (!srcEl) return;
        const isAfter = wrap.classList.contains("is-drag-over-after");
        wrap.classList.remove("is-drag-over-before", "is-drag-over-after");
        if (isAfter) {
            wrap.after(srcEl);
        } else {
            wrap.before(srcEl);
        }
        reorderDisciplines(container);
    });
}
```

- [ ] **Step 5: Add `wireSubjectDrag` function (module-level)**

```js
function wireSubjectDrag(row, s, disciplineId, container) {
    row.draggable = true;
    row.dataset.id = s.id;

    row.addEventListener("dragstart", e => {
        dragState = { type: "subject", id: s.id, disciplineId };
        row.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setDragImage(row, 0, 0);
    });

    row.addEventListener("dragend", () => {
        row.classList.remove("is-dragging");
        document.querySelectorAll(".is-drag-over-before, .is-drag-over-after")
            .forEach(el => el.classList.remove("is-drag-over-before", "is-drag-over-after"));
        dragState = null;
    });

    row.addEventListener("dragover", e => {
        if (!dragState || dragState.type !== "subject"
            || dragState.disciplineId !== disciplineId
            || dragState.id === s.id) return;
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
        if (!dragState || dragState.type !== "subject"
            || dragState.disciplineId !== disciplineId
            || dragState.id === s.id) return;
        e.preventDefault();
        const srcEl = container.querySelector(`[data-id="${dragState.id}"]`);
        if (!srcEl) return;
        const isAfter = row.classList.contains("is-drag-over-after");
        row.classList.remove("is-drag-over-before", "is-drag-over-after");
        if (isAfter) {
            row.after(srcEl);
        } else {
            row.before(srcEl);
        }
        reorderSubjects(container, disciplineId);
    });
}
```

- [ ] **Step 6: Update `renderDiscipline` to wire drag, add drag handle, and add ↑/↓ buttons**

Replace the existing `renderDiscipline` function (lines 73-114):

```js
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

    const dragHandle = h("span.smsys-drag-handle", { title: "Drag to reorder" }, "⠿");

    const headerRow = h(".smsys-tree-row.is-discipline", { onClick: toggleCollapse },
        dragHandle,
        caretEl,
        h("span.smsys-tree-name", d.name),
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
    wireDisciplineDrag(wrap, d);
    await loadSubjects(d.id, childrenEl, refreshAll);
    return wrap;
}
```

- [ ] **Step 7: Update `loadSubjects` to wire subject drag and add ↑/↓ buttons**

Replace the existing `loadSubjects` function (lines 116-153):

```js
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
        const dragHandle = h("span.smsys-drag-handle", { title: "Drag to reorder" }, "⠿");
        const row = h(".smsys-tree-row.is-subject", null,
            dragHandle,
            h("span.smsys-tree-name", s.name),
            h("span.smsys-badge", `${s.note_count} notes`),
            h(".smsys-tree-actions", null,
                h("button.smsys-tree-action",
                    {
                        title: "Move up",
                        onClick: async (e) => {
                            e.stopPropagation();
                            const prev = row.previousElementSibling;
                            if (prev?.classList.contains("is-subject")) {
                                container.insertBefore(row, prev);
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
                            const next = row.nextElementSibling;
                            if (next?.classList.contains("is-subject")) {
                                container.insertBefore(next, row);
                                await reorderSubjects(container, disciplineId);
                            }
                        }
                    },
                    "↓"
                ),
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
        wireSubjectDrag(row, s, disciplineId, container);
        container.appendChild(row);
    }
}
```

- [ ] **Step 8: Commit**

```bash
git add web/routes/disciplines.js
git commit -m "feat(FDA-689): drag-and-drop + arrow button reordering for disciplines and subjects

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Self-Review Against Spec

**Spec requirements:**
1. ✅ Drag-and-drop handles on rows (HTML5 drag API) — Tasks 5 & 6
2. ✅ Fallback: up/down arrow buttons for accessibility — Task 6 (↑/↓ in every action strip)
3. ✅ Order persisted via `position` INTEGER column on `disciplines` and `subjects` — Tasks 1-3
4. ✅ `list_disciplines` and `list_subjects` sort by `position` — Task 2

**Placeholder scan:** No placeholders found. All code is complete.

**Type consistency:** `reorderDisciplines(container)` and `reorderSubjects(container, disciplineId)` are called consistently across arrow button handlers and drag-drop handlers. `dragState` is set in `dragstart` and cleared in `dragend`. `data-id` attributes are set in the `wire*Drag` functions and read in the `reorder*` helpers.
