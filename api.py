"""Bridge API handlers exposed to the SPA via `bridge.register`.

Method naming uses dotted namespaces:
  disciplines.*  — disciplines CRUD
  subjects.*     — subjects CRUD + assignments lookup
  notes.*        — note ↔ subject linkage
  anki.*         — opens/uses native Anki windows (Browser, AddCards, …)
"""
from __future__ import annotations

import sqlite3
from typing import Any

import aqt
from aqt import mw

from .bridge import register
from .db import db


# ----- helpers -------------------------------------------------------


def _row_to_discipline(row: sqlite3.Row) -> dict[str, Any]:
    return {"id": int(row["id"]), "name": row["name"]}


def _row_to_subject(row: sqlite3.Row) -> dict[str, Any]:
    return {"id": int(row["id"]), "name": row["name"]}


def _require_name(name: str, label: str) -> str:
    name = (name or "").strip()
    if not name:
        raise ValueError(f"{label} name cannot be empty.")
    return name


# ----- disciplines --------------------------------------------------


@register("disciplines.list")
def disciplines_list() -> list[dict[str, Any]]:
    return [_row_to_discipline(r) for r in db().list_disciplines()]


@register("disciplines.create")
def disciplines_create(name: str) -> dict[str, Any]:
    name = _require_name(name, "Discipline")
    try:
        new_id = db().add_discipline(name)
    except sqlite3.IntegrityError:
        raise ValueError(f"A discipline named '{name}' already exists.")
    return {"id": int(new_id), "name": name}


@register("disciplines.rename")
def disciplines_rename(id: int, name: str) -> None:
    name = _require_name(name, "Discipline")
    try:
        db().rename_discipline(int(id), name)
    except sqlite3.IntegrityError:
        raise ValueError(f"A discipline named '{name}' already exists.")


@register("disciplines.delete")
def disciplines_delete(id: int) -> None:
    db().delete_discipline(int(id))


# ----- subjects ------------------------------------------------------


@register("subjects.list")
def subjects_list(discipline_id: int) -> list[dict[str, Any]]:
    return [_row_to_subject(r) for r in db().list_subjects(int(discipline_id))]


@register("subjects.create")
def subjects_create(discipline_id: int, name: str) -> dict[str, Any]:
    name = _require_name(name, "Subject")
    try:
        new_id = db().add_subject(int(discipline_id), name)
    except sqlite3.IntegrityError:
        raise ValueError(
            f"A subject named '{name}' already exists in this discipline."
        )
    return {"id": int(new_id), "name": name}


@register("subjects.rename")
def subjects_rename(id: int, name: str) -> None:
    name = _require_name(name, "Subject")
    try:
        db().rename_subject(int(id), name)
    except sqlite3.IntegrityError:
        raise ValueError(
            f"A subject named '{name}' already exists in this discipline."
        )


@register("subjects.delete")
def subjects_delete(id: int) -> None:
    db().delete_subject(int(id))


@register("subjects.note_ids")
def subjects_note_ids(id: int) -> list[int]:
    return [int(n) for n in db().note_ids_for_subject(int(id))]


# ----- notes ↔ subjects ---------------------------------------------


@register("notes.assign")
def notes_assign(note_id: int, subject_id: int | None) -> None:
    db().assign_note(
        int(note_id), int(subject_id) if subject_id is not None else None
    )


@register("notes.get_subject")
def notes_get_subject(note_id: int) -> dict[str, Any] | None:
    row = db().get_note_subject(int(note_id))
    if row is None:
        return None
    return {
        "subject_id": int(row["subject_id"]),
        "subject_name": row["subject_name"],
        "discipline_id": int(row["discipline_id"]),
        "discipline_name": row["discipline_name"],
    }


# ----- Anki window navigation ---------------------------------------


def _bring_to_front(window: Any) -> None:
    try:
        window.show()
        window.raise_()
        window.activateWindow()
    except Exception:
        pass


@register("anki.open_browser_for_notes")
def anki_open_browser_for_notes(note_ids: list[int]) -> int:
    """Open the Browser preloaded with `nid:` for the given notes. Returns
    the count of notes searched for."""
    if not note_ids:
        return 0
    ids_str = ",".join(str(int(n)) for n in note_ids)
    browser = aqt.dialogs.open("Browser", mw)
    browser.search_for(f"nid:{ids_str}")
    _bring_to_front(browser)
    return len(note_ids)


@register("anki.open_browser_search")
def anki_open_browser_search(query: str) -> None:
    browser = aqt.dialogs.open("Browser", mw)
    browser.search_for(query)
    _bring_to_front(browser)


@register("anki.open_add_cards")
def anki_open_add_cards() -> None:
    win = aqt.dialogs.open("AddCards", mw)
    _bring_to_front(win)


@register("anki.deck_browser")
def anki_deck_browser() -> None:
    """Return Anki's main window to the deck browser."""
    assert mw is not None
    mw.moveToState("deckBrowser")
