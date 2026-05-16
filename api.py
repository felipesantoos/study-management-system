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
    return {
        "id": int(row["id"]),
        "name": row["name"],
        "color": row["color"],
        "position": int(row["position"]),
    }


def _row_to_subject(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "name": row["name"],
        "note_count": int(row["note_count"]),
        "position": int(row["position"]),
    }


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


@register("disciplines.set_color")
def disciplines_set_color(id: int, color: str | None) -> None:
    import re
    if color and not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise ValueError("Invalid color format.")
    db().set_discipline_color(int(id), color or None)


@register("disciplines.delete")
def disciplines_delete(id: int) -> None:
    db().delete_discipline(int(id))


@register("disciplines.reorder")
def disciplines_reorder(ids: list) -> None:
    db().reorder_disciplines([int(i) for i in ids])


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


@register("subjects.reorder")
def subjects_reorder(discipline_id: int, ids: list) -> None:
    db().reorder_subjects(int(discipline_id), [int(i) for i in ids])


@register("subjects.note_ids")
def subjects_note_ids(id: int) -> list[int]:
    return [int(n) for n in db().note_ids_for_subject(int(id))]

@register("subjects.stats")
def subjects_stats(ids: list) -> list[dict[str, Any]]:
    """Return due / new / learning card counts for a list of subject IDs.

    Reads queue/due columns from Anki's cards table directly so we don't
    disturb the scheduler's internal state.  Queue semantics:
      0 = new, 1 = intraday learning, 2 = review, 3 = interday learning.
    """
    if not ids:
        return []
    assert mw is not None
    col = mw.col
    today = col.sched.today
    result = []
    for sid in ids:
        note_ids = [int(n) for n in db().note_ids_for_subject(int(sid))]
        if not note_ids:
            result.append({"id": int(sid), "due": 0, "new": 0, "lrn": 0})
            continue
        placeholders = ",".join("?" * len(note_ids))
        rows = col.db.all(
            f"SELECT queue, due FROM cards WHERE nid IN ({placeholders})",
            *note_ids,
        )
        due_count = sum(1 for q, d in rows if q == 2 and d <= today)
        new_count = sum(1 for q, d in rows if q == 0)
        lrn_count = sum(1 for q, d in rows if q == 1 or (q == 3 and d <= today))
        result.append({"id": int(sid), "due": due_count, "new": new_count, "lrn": lrn_count})
    return result


# ----- notes ↔ subjects ---------------------------------------------


@register("notes.assign")
def notes_assign(note_id: int, subject_id: int | None) -> None:
    db().assign_note(
        int(note_id), int(subject_id) if subject_id is not None else None
    )


@register("notes.bulk_assign")
def notes_bulk_assign(note_ids: list[int], subject_id: int | None) -> int:
    ids = [int(n) for n in note_ids]
    db().bulk_assign(
        ids, int(subject_id) if subject_id is not None else None
    )
    return len(ids)


@register("notes.unassigned_ids")
def notes_unassigned_ids() -> list[int]:
    assert mw is not None and mw.col is not None
    all_ids: set[int] = set(mw.col.find_notes(""))
    assigned = db().assigned_note_ids()
    return sorted(all_ids - assigned)


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


# ----- stats --------------------------------------------------------


@register("stats.overview")
def stats_overview() -> dict[str, Any]:
    """Return aggregate counts across the whole collection."""
    assert mw is not None and mw.col is not None
    discipline_count = db().con.execute("SELECT COUNT(*) FROM disciplines").fetchone()[0]
    subject_count = db().con.execute("SELECT COUNT(*) FROM subjects").fetchone()[0]
    assigned_count = db().con.execute("SELECT COUNT(*) FROM note_subjects").fetchone()[0]
    total_notes = len(mw.col.find_notes(""))
    return {
        "disciplines": int(discipline_count),
        "subjects": int(subject_count),
        "assigned_notes": int(assigned_count),
        "unassigned_notes": max(0, int(total_notes) - int(assigned_count)),
    }


@register("stats.due_by_subject")
def stats_due_by_subject(limit: int = 5) -> list[dict[str, Any]]:
    """Return up to `limit` subjects sorted by due-today count descending.

    Uses a single round-trip to each database regardless of subject count.
    """
    from collections import defaultdict

    assert mw is not None
    col = mw.col
    today = col.sched.today

    subject_rows = db().con.execute(
        """
        SELECT s.id, s.name AS subject_name,
               d.name AS discipline_name, d.color AS discipline_color
          FROM subjects s
          JOIN disciplines d ON d.id = s.discipline_id
        """
    ).fetchall()
    if not subject_rows:
        return []

    note_to_subject: dict[int, int] = {
        int(note_id): int(subject_id)
        for note_id, subject_id in db().con.execute(
            "SELECT note_id, subject_id FROM note_subjects"
        )
    }
    if not note_to_subject:
        return []

    all_note_ids = list(note_to_subject.keys())
    placeholders = ",".join("?" * len(all_note_ids))
    card_rows = col.db.all(
        f"SELECT nid, queue, due FROM cards WHERE nid IN ({placeholders})",
        *all_note_ids,
    )

    subject_stats: dict[int, dict[str, int]] = defaultdict(
        lambda: {"due": 0, "new": 0, "lrn": 0}
    )
    for nid, queue, due in card_rows:
        sid = note_to_subject.get(int(nid))
        if sid is None:
            continue
        if queue == 0:
            subject_stats[sid]["new"] += 1
        elif queue == 2 and due <= today:
            subject_stats[sid]["due"] += 1
        elif queue == 1 or (queue == 3 and due <= today):
            subject_stats[sid]["lrn"] += 1

    subject_map = {int(r["id"]): r for r in subject_rows}
    results = []
    for sid, counts in subject_stats.items():
        if counts["due"] + counts["new"] + counts["lrn"] == 0:
            continue
        row = subject_map.get(sid)
        if row is None:
            continue
        results.append({
            "id": sid,
            "subject_name": row["subject_name"],
            "discipline_name": row["discipline_name"],
            "discipline_color": row["discipline_color"],
            "due": counts["due"],
            "new": counts["new"],
            "lrn": counts["lrn"],
        })

    results.sort(key=lambda x: (-x["due"], -(x["new"] + x["lrn"])))
    return results[: int(limit)]


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


@register("anki.study_subject")
def anki_study_subject(subject_id: int) -> None:
    """Create or rebuild a filtered deck for the subject and launch the reviewer."""
    subject_id = int(subject_id)
    row = db().get_subject(subject_id)
    if row is None:
        raise ValueError("Subject not found.")
    note_ids = db().note_ids_for_subject(subject_id)
    if not note_ids:
        raise ValueError("No notes assigned to this subject.")

    deck_name = f"Study: {row['discipline_name']} \u203a {row['subject_name']}"
    search = "nid:" + ",".join(str(n) for n in note_ids)

    assert mw is not None
    did = mw.col.decks.newDyn(deck_name)
    deck_dict = mw.col.decks.get(did)
    deck_dict["terms"][0] = [search, 9999, 0]  # search, limit=all, order=random
    deck_dict["resched"] = True
    mw.col.decks.save(deck_dict)
    mw.col.sched.rebuildDyn(did)
    mw.col.decks.select(did)
    mw.moveToState("review")
