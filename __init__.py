"""Study Management System — Anki addon entry point.

Architecture:
    db.py        SQLite layer (lives in collection.media/_study_management_system.db).
    bridge.py    JS <-> Python RPC over Anki's pycmd (smsys: prefix).
    api.py       Bridge handler registrations (imported for the side effects).
    dialogs.py   Qt dialogs still used by the editor button / Browser context menu.
    web/         Static SPA assets, served via setWebExports at
                 /_addons/study-management-system/web/*

The Study Manager top-bar link renders the SPA into mw.web. Native Qt
windows (editor's assign button, Browser context menu, Add Cards staging)
keep working as before.
"""
from __future__ import annotations

import sqlite3
import weakref
from typing import Any, Sequence

import aqt
from anki import hooks as anki_hooks
from anki.collection import Collection
from anki.notes import Note, NoteId
from aqt import gui_hooks, mw
from aqt.addcards import AddCards
from aqt.editor import Editor
from aqt.qt import QAction, QDialog, QMenu, qconnect
from aqt.utils import showInfo, tooltip

from . import api as _api  # noqa: F401 — imported for handler registration
from . import bridge
from .db import close_db, db
from .dialogs import AssignDialog


ADDON_PACKAGE = mw.addonManager.addonFromModule(__name__)  # e.g. "study-management-system"
WEB_BASE = f"/_addons/{ADDON_PACKAGE}/web"


# ============================================================
# SPA: render into mw.web
# ============================================================


def open_study_manager() -> None:
    """Replace mw.web's content with the SPA."""
    assert mw is not None
    body = (
        '<div id="smsys-root"></div>'
        f'<script type="module" src="{WEB_BASE}/app.js"></script>'
    )
    mw.web.stdHtml(body, css=[f"{WEB_BASE}/app.css"], js=[])


# ============================================================
# Editor button: assign current note (or stage in Add window)
# ============================================================


def _format_assignment_label(row: sqlite3.Row) -> str:
    parts = [row["discipline_name"]]
    if row["subject_name"]:
        parts.append(row["subject_name"])
    if row["topic_name"]:
        parts.append(row["topic_name"])
    return " › ".join(parts)


def _direct_kind(row: sqlite3.Row) -> str:
    if row["direct_topic_id"] is not None:
        return "topic"
    if row["direct_subject_id"] is not None:
        return "subject"
    return "discipline"


def _direct_target_id(row: sqlite3.Row) -> int:
    if row["direct_topic_id"] is not None:
        return int(row["direct_topic_id"])
    if row["direct_subject_id"] is not None:
        return int(row["direct_subject_id"])
    return int(row["direct_discipline_id"])


def _open_assign_for_editor(editor: Editor) -> None:
    if editor.note is None:
        return

    if editor.note.id != 0:
        current = db().get_note_assignment(editor.note.id)
        status = (
            f"Currently: <b>{_format_assignment_label(current)}</b>"
            if current
            else "Currently: <i>unassigned</i>"
        )
        dlg = AssignDialog(
            editor.parentWindow,
            title="Assign Note",
            status_html=status,
            initial_kind=_direct_kind(current) if current else None,
            initial_id=_direct_target_id(current) if current else None,
        )
        if dlg.exec() == QDialog.DialogCode.Accepted:
            db().assign_note(editor.note.id, dlg.chosen_kind, dlg.chosen_id)
            tooltip("Assignment updated.")
        return

    # Add window — stage on the editor; the pending value is applied after
    # the note is saved by `_on_note_added`.
    pending = getattr(editor, "_pending_assignment", None)
    if pending is not None:
        kind, target_id = pending
        label = _label_for_target(kind, target_id)
        status = (
            f"Will assign to: <b>{label}</b>"
            if label
            else "Will assign to: <i>(removed)</i>"
        )
    else:
        status = "Will assign to: <i>nothing — staged after you click Add</i>"

    dlg = AssignDialog(
        editor.parentWindow,
        title="Stage Assignment for Next Note",
        status_html=status,
        initial_kind=pending[0] if pending else None,
        initial_id=pending[1] if pending else None,
    )
    if dlg.exec() == QDialog.DialogCode.Accepted:
        editor._pending_assignment = (  # type: ignore[attr-defined]
            None if dlg.cleared else (dlg.chosen_kind, dlg.chosen_id)
        )
        tooltip("Staged. Click Add to save the note with this assignment.")


def _label_for_target(kind: str, target_id: int) -> str | None:
    if kind == "topic":
        row = db().get_topic(int(target_id))
        if row is None:
            return None
        return f"{row['discipline_name']} › {row['subject_name']} › {row['topic_name']}"
    if kind == "subject":
        row = db().get_subject(int(target_id))
        if row is None:
            return None
        return f"{row['discipline_name']} › {row['subject_name']}"
    if kind == "discipline":
        row = db().get_discipline(int(target_id))
        if row is None:
            return None
        return row["name"]
    return None


def _add_assign_button(buttons: list[str], editor: Editor) -> None:
    btn = editor.addButton(
        icon=None,
        cmd="assign_subject",
        func=_open_assign_for_editor,
        tip="Assign this note to a discipline, subject, or topic",
        label="Assign",
    )
    buttons.append(btn)


# ============================================================
# Add Cards pending-assignment plumbing
# ============================================================

_tracked_addcards: "weakref.WeakSet[AddCards]" = weakref.WeakSet()


def _on_addcards_init(addcards: AddCards) -> None:
    _tracked_addcards.add(addcards)


def _on_note_added(note: Note) -> None:
    for addcards in list(_tracked_addcards):
        try:
            editor = addcards.editor
        except RuntimeError:
            continue
        if editor is None:
            continue
        pending = getattr(editor, "_pending_assignment", None)
        if pending is None:
            continue
        kind, target_id = pending
        try:
            db().assign_note(int(note.id), kind, target_id)
        except sqlite3.Error:
            pass
        return


# ============================================================
# Browser: right-click → "Assign Subject…"
# ============================================================


def _on_browser_context_menu(browser: Any, menu: QMenu) -> None:
    action = QAction("Assign to discipline / subject / topic…", browser)
    qconnect(action.triggered, lambda: _bulk_assign_from_browser(browser))
    menu.addAction(action)


def _bulk_assign_from_browser(browser: Any) -> None:
    nids = list(browser.selected_notes())
    if not nids:
        showInfo("Select one or more notes first.")
        return

    rows = [db().get_note_assignment(int(n)) for n in nids]
    assigned = [r for r in rows if r is not None]
    initial_kind: str | None = None
    initial_id: int | None = None
    if assigned:
        from collections import Counter

        counter: Counter[tuple[str, int]] = Counter()
        for r in assigned:
            counter[(_direct_kind(r), _direct_target_id(r))] += 1
        (initial_kind, initial_id), _ = counter.most_common(1)[0]

    if assigned and len(assigned) < len(nids):
        status = (
            f"<b>{len(nids)}</b> notes selected — "
            f"<b>{len(assigned)}</b> already have an assignment."
        )
    elif assigned:
        status = f"<b>{len(nids)}</b> notes selected — all currently assigned."
    else:
        status = f"<b>{len(nids)}</b> notes selected — none assigned yet."

    dlg = AssignDialog(
        browser,
        title=f"Assign {len(nids)} Note(s)",
        status_html=status,
        initial_kind=initial_kind,
        initial_id=initial_id,
    )
    if dlg.exec() != QDialog.DialogCode.Accepted:
        return

    db().bulk_assign([int(n) for n in nids], dlg.chosen_kind, dlg.chosen_id)
    if dlg.cleared:
        tooltip(f"Unassigned {len(nids)} note(s).")
    else:
        tooltip(f"Assigned {len(nids)} note(s).")


# ============================================================
# Cleanup on note deletion
# ============================================================


def _on_notes_will_be_deleted(
    _col: Collection, ids: Sequence[NoteId]
) -> None:
    db().delete_note_assignments(list(ids))


# ============================================================
# Tools menu & top-bar link
# ============================================================


def _add_menu_entry() -> None:
    assert mw is not None
    action = QAction("Study Management System", mw)
    qconnect(action.triggered, open_study_manager)
    mw.form.menuTools.addAction(action)


def _add_toolbar_link(links: list[str], toolbar: Any) -> None:
    link = toolbar.create_link(
        cmd="study_manager",
        label="Study Manager",
        func=open_study_manager,
        tip="Open Study Management System",
    )
    links.append(link)


# ============================================================
# Lifecycle
# ============================================================


def _on_profile_did_open() -> None:
    try:
        db()
    except Exception:
        pass


def _on_profile_will_close() -> None:
    close_db()


# ----- one-time setup -----

mw.addonManager.setWebExports(
    __name__, r"web/.*\.(html|js|css|svg|png|jpg|jpeg|gif|woff2)"
)
bridge.install()

gui_hooks.editor_did_init_buttons.append(_add_assign_button)
gui_hooks.browser_will_show_context_menu.append(_on_browser_context_menu)
gui_hooks.add_cards_did_init.append(_on_addcards_init)
gui_hooks.add_cards_did_add_note.append(_on_note_added)
gui_hooks.profile_did_open.append(_on_profile_did_open)
gui_hooks.profile_will_close.append(_on_profile_will_close)
gui_hooks.top_toolbar_did_init_links.append(_add_toolbar_link)
anki_hooks.notes_will_be_deleted.append(_on_notes_will_be_deleted)
_add_menu_entry()
