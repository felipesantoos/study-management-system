"""Bridge API handlers exposed to the SPA via `bridge.register`.

Method naming uses dotted namespaces:
  disciplines.*  — disciplines CRUD
  subjects.*     — subjects CRUD + assignments lookup
  topics.*       — topics CRUD + assignments lookup
  notes.*        — note ↔ (discipline | subject | topic) linkage
  stats.*        — dashboard aggregates
  anki.*         — opens/uses native Anki windows (Browser, AddCards, …)
"""
from __future__ import annotations

import sqlite3
from collections import defaultdict
from typing import Any

import aqt
from aqt import mw

from .bridge import register
from .db import ASSIGNMENT_KINDS, STUDY_STATUSES, db
from . import tagsync


# ----- helpers -------------------------------------------------------


def _row_to_discipline(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "name": row["name"],
        "color": row["color"],
        "position": int(row["position"]),
        "note_count": int(row["note_count"]),
        "subject_count": int(row["subject_count"]),
        "study_status": row["study_status"],
    }


def _row_to_subject(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "name": row["name"],
        "note_count": int(row["note_count"]),
        "topic_count": int(row["topic_count"]),
        "position": int(row["position"]),
        "study_status": row["study_status"],
    }


def _row_to_topic(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "name": row["name"],
        "note_count": int(row["note_count"]),
        "position": int(row["position"]),
        "study_status": row["study_status"],
    }


def _require_name(name: str, label: str) -> str:
    name = (name or "").strip()
    if not name:
        raise ValueError(f"{label} name cannot be empty.")
    return name


def _normalize_target(
    target_kind: str | None, target_id: int | None
) -> tuple[str | None, int | None]:
    if target_kind is None or target_id is None:
        return None, None
    if target_kind not in ASSIGNMENT_KINDS:
        raise ValueError(f"Unknown target kind: {target_kind!r}")
    return target_kind, int(target_id)


def _bucket_card_counts(
    note_ids: list[int],
) -> tuple[int, int, int]:
    """Return (due, new, lrn) counts across the given notes."""
    if not note_ids:
        return 0, 0, 0
    assert mw is not None
    col = mw.col
    today = col.sched.today
    placeholders = ",".join("?" * len(note_ids))
    rows = col.db.all(
        f"SELECT queue, due FROM cards WHERE nid IN ({placeholders})",
        *note_ids,
    )
    due = sum(1 for q, d in rows if q == 2 and d <= today)
    new = sum(1 for q, d in rows if q == 0)
    lrn = sum(1 for q, d in rows if q == 1 or (q == 3 and d <= today))
    return due, new, lrn


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
    tagsync.refresh_discipline_notes(int(id))


@register("disciplines.set_color")
def disciplines_set_color(id: int, color: str | None) -> None:
    import re
    if color and not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise ValueError("Invalid color format.")
    db().set_discipline_color(int(id), color or None)


@register("disciplines.delete")
def disciplines_delete(id: int) -> None:
    note_ids = db().note_ids_for_discipline(int(id), include_descendants=True)
    db().delete_discipline(int(id))
    tagsync.strip_smsys_tags(note_ids)


@register("disciplines.reorder")
def disciplines_reorder(ids: list) -> None:
    db().reorder_disciplines([int(i) for i in ids])


@register("disciplines.note_ids")
def disciplines_note_ids(id: int) -> list[int]:
    return [int(n) for n in db().note_ids_for_discipline(int(id))]


@register("disciplines.stats")
def disciplines_stats(ids: list) -> list[dict[str, Any]]:
    """Return aggregated due / new / learning counts for a list of discipline IDs.

    Counts include notes on subjects and topics within each discipline.
    """
    if not ids:
        return []
    result = []
    for did in ids:
        note_ids = [int(n) for n in db().note_ids_for_discipline(int(did))]
        due, new, lrn = _bucket_card_counts(note_ids)
        result.append({"id": int(did), "due": due, "new": new, "lrn": lrn})
    return result


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
    tagsync.refresh_subject_notes(int(id))


@register("subjects.delete")
def subjects_delete(id: int) -> None:
    note_ids = db().note_ids_for_subject(int(id), include_descendants=True)
    db().delete_subject(int(id))
    tagsync.strip_smsys_tags(note_ids)


@register("subjects.reorder")
def subjects_reorder(discipline_id: int, ids: list) -> None:
    db().reorder_subjects(int(discipline_id), [int(i) for i in ids])


@register("subjects.note_ids")
def subjects_note_ids(id: int) -> list[int]:
    return [int(n) for n in db().note_ids_for_subject(int(id))]


@register("subjects.stats")
def subjects_stats(ids: list) -> list[dict[str, Any]]:
    """Return aggregated due / new / learning counts for the given subjects.

    Each subject's stats include notes assigned directly to the subject plus
    notes assigned to any of its topics.
    """
    if not ids:
        return []
    result = []
    for sid in ids:
        note_ids = [int(n) for n in db().note_ids_for_subject(int(sid))]
        due, new, lrn = _bucket_card_counts(note_ids)
        result.append({"id": int(sid), "due": due, "new": new, "lrn": lrn})
    return result


# ----- topics --------------------------------------------------------


@register("topics.list")
def topics_list(subject_id: int) -> list[dict[str, Any]]:
    return [_row_to_topic(r) for r in db().list_topics(int(subject_id))]


@register("topics.create")
def topics_create(subject_id: int, name: str) -> dict[str, Any]:
    name = _require_name(name, "Topic")
    try:
        new_id = db().add_topic(int(subject_id), name)
    except sqlite3.IntegrityError:
        raise ValueError(
            f"A topic named '{name}' already exists in this subject."
        )
    return {"id": int(new_id), "name": name}


@register("topics.rename")
def topics_rename(id: int, name: str) -> None:
    name = _require_name(name, "Topic")
    try:
        db().rename_topic(int(id), name)
    except sqlite3.IntegrityError:
        raise ValueError(
            f"A topic named '{name}' already exists in this subject."
        )
    tagsync.refresh_topic_notes(int(id))


@register("topics.delete")
def topics_delete(id: int) -> None:
    note_ids = db().note_ids_for_topic(int(id))
    db().delete_topic(int(id))
    tagsync.strip_smsys_tags(note_ids)


@register("topics.reorder")
def topics_reorder(subject_id: int, ids: list) -> None:
    db().reorder_topics(int(subject_id), [int(i) for i in ids])


@register("topics.note_ids")
def topics_note_ids(id: int) -> list[int]:
    return [int(n) for n in db().note_ids_for_topic(int(id))]


@register("topics.stats")
def topics_stats(ids: list) -> list[dict[str, Any]]:
    if not ids:
        return []
    result = []
    for tid in ids:
        note_ids = [int(n) for n in db().note_ids_for_topic(int(tid))]
        due, new, lrn = _bucket_card_counts(note_ids)
        result.append({"id": int(tid), "due": due, "new": new, "lrn": lrn})
    return result


# ----- notes ↔ {discipline, subject, topic} -------------------------


@register("notes.assign")
def notes_assign(
    note_id: int,
    target_kind: str | None = None,
    target_id: int | None = None,
) -> None:
    kind, tid = _normalize_target(target_kind, target_id)
    db().assign_note(int(note_id), kind, tid)
    tagsync.apply_assignment([int(note_id)], kind, tid)


@register("notes.bulk_assign")
def notes_bulk_assign(
    note_ids: list[int],
    target_kind: str | None = None,
    target_id: int | None = None,
) -> int:
    ids = [int(n) for n in note_ids]
    kind, tid = _normalize_target(target_kind, target_id)
    db().bulk_assign(ids, kind, tid)
    tagsync.apply_assignment(ids, kind, tid)
    return len(ids)


@register("notes.unassigned_ids")
def notes_unassigned_ids() -> list[int]:
    assert mw is not None and mw.col is not None
    all_ids: set[int] = set(mw.col.find_notes(""))
    assigned = db().assigned_note_ids()
    return sorted(all_ids - assigned)


@register("notes.unassigned_count")
def notes_unassigned_count() -> int:
    assert mw is not None and mw.col is not None
    all_ids: set[int] = set(mw.col.find_notes(""))
    assigned = db().assigned_note_ids()
    return len(all_ids - assigned)


@register("notes.get_assignment")
def notes_get_assignment(note_id: int) -> dict[str, Any] | None:
    row = db().get_note_assignment(int(note_id))
    if row is None:
        return None
    if row["direct_topic_id"] is not None:
        kind = "topic"
        target_id = int(row["direct_topic_id"])
    elif row["direct_subject_id"] is not None:
        kind = "subject"
        target_id = int(row["direct_subject_id"])
    else:
        kind = "discipline"
        target_id = int(row["direct_discipline_id"])
    return {
        "kind": kind,
        "target_id": target_id,
        "discipline_id": int(row["discipline_id"]) if row["discipline_id"] is not None else None,
        "discipline_name": row["discipline_name"],
        "subject_id": int(row["subject_id"]) if row["subject_id"] is not None else None,
        "subject_name": row["subject_name"],
        "topic_id": int(row["topic_id"]) if row["topic_id"] is not None else None,
        "topic_name": row["topic_name"],
    }


# ----- nodes (cross-kind) -------------------------------------------


_NODE_KINDS = ("discipline", "subject", "topic")


@register("nodes.set_status")
def nodes_set_status(id: int, type: str, status: str) -> dict[str, Any]:
    """Persist the study status for a discipline / subject / topic node."""
    if type not in _NODE_KINDS:
        raise ValueError(f"Unknown node type: {type!r}")
    if status not in STUDY_STATUSES:
        raise ValueError(f"Unknown study status: {status!r}")
    row = db().set_node_status(type, int(id), status)
    if row is None:
        raise ValueError(f"{type.capitalize()} not found: id={id}")
    return {
        "id": int(row["id"]),
        "type": type,
        "study_status": row["study_status"],
    }


# ----- stats --------------------------------------------------------


@register("stats.overview")
def stats_overview() -> dict[str, Any]:
    """Return aggregate counts across the whole collection."""
    assert mw is not None and mw.col is not None
    discipline_count = db().con.execute("SELECT COUNT(*) FROM disciplines").fetchone()[0]
    subject_count = db().con.execute("SELECT COUNT(*) FROM subjects").fetchone()[0]
    topic_count = db().con.execute("SELECT COUNT(*) FROM topics").fetchone()[0]
    assigned_count = db().con.execute(
        "SELECT COUNT(*) FROM note_assignments"
    ).fetchone()[0]
    total_notes = len(mw.col.find_notes(""))

    # Cards due today across the whole collection (review + learning + new).
    # Matches the per-subject classification used by stats.due_by_subject.
    today = mw.col.sched.today
    due_cards = mw.col.db.scalar(
        "SELECT COUNT(*) FROM cards "
        "WHERE queue = 2 AND due <= ?",
        today,
    ) or 0
    lrn_cards = mw.col.db.scalar(
        "SELECT COUNT(*) FROM cards "
        "WHERE queue = 1 OR (queue = 3 AND due <= ?)",
        today,
    ) or 0
    new_cards = mw.col.db.scalar(
        "SELECT COUNT(*) FROM cards WHERE queue = 0"
    ) or 0

    return {
        "disciplines": int(discipline_count),
        "subjects": int(subject_count),
        "topics": int(topic_count),
        "assigned_notes": int(assigned_count),
        "unassigned_notes": max(0, int(total_notes) - int(assigned_count)),
        "cards_due": int(due_cards),
        "cards_lrn": int(lrn_cards),
        "cards_new": int(new_cards),
    }


@register("stats.status_summary")
def stats_status_summary() -> dict[str, int]:
    """Return subject counts grouped by study_status.

    Returned dict always contains every known status key — zero counts
    are represented explicitly so the client can decide what to render.
    """
    counts: dict[str, int] = {status: 0 for status in STUDY_STATUSES}
    rows = db().con.execute(
        "SELECT study_status, COUNT(*) AS n FROM subjects GROUP BY study_status"
    ).fetchall()
    for row in rows:
        status = row["study_status"]
        if status in counts:
            counts[status] = int(row["n"])
    return counts


@register("stats.due_by_subject")
def stats_due_by_subject(limit: int = 5) -> list[dict[str, Any]]:
    """Return up to `limit` study targets sorted by due-today count descending.

    Each target row carries a `kind`:
    * `"subject"` aggregates notes assigned directly to the subject plus notes
      on any of its topics.
    * `"discipline"` aggregates notes attached directly to the discipline
      (subject/topic notes belong to their own subject rows). This surfaces
      discipline-level cards that would otherwise be invisible on Home — the
      disciplines tree already counts them, so Home must too.
    """
    assert mw is not None
    col = mw.col
    today = col.sched.today

    note_to_subject: dict[int, int] = {}
    for note_id, subject_id in db().con.execute(
        "SELECT note_id, subject_id FROM note_assignments WHERE subject_id IS NOT NULL"
    ):
        note_to_subject[int(note_id)] = int(subject_id)
    for note_id, subject_id in db().con.execute(
        """
        SELECT na.note_id, t.subject_id
          FROM note_assignments na
          JOIN topics t ON t.id = na.topic_id
        """
    ):
        note_to_subject[int(note_id)] = int(subject_id)

    note_to_discipline: dict[int, int] = {}
    for note_id, discipline_id in db().con.execute(
        "SELECT note_id, discipline_id FROM note_assignments WHERE discipline_id IS NOT NULL"
    ):
        note_to_discipline[int(note_id)] = int(discipline_id)

    all_note_ids = list(note_to_subject.keys()) + list(note_to_discipline.keys())
    if not all_note_ids:
        return []

    placeholders = ",".join("?" * len(all_note_ids))
    card_rows = col.db.all(
        f"SELECT nid, queue, due FROM cards WHERE nid IN ({placeholders})",
        *all_note_ids,
    )

    subject_stats: dict[int, dict[str, int]] = defaultdict(
        lambda: {"due": 0, "new": 0, "lrn": 0}
    )
    discipline_stats: dict[int, dict[str, int]] = defaultdict(
        lambda: {"due": 0, "new": 0, "lrn": 0}
    )
    for nid, queue, due in card_rows:
        nid_int = int(nid)
        sid = note_to_subject.get(nid_int)
        if sid is not None:
            bucket = subject_stats[sid]
        else:
            did = note_to_discipline.get(nid_int)
            if did is None:
                continue
            bucket = discipline_stats[did]
        if queue == 0:
            bucket["new"] += 1
        elif queue == 2 and due <= today:
            bucket["due"] += 1
        elif queue == 1 or (queue == 3 and due <= today):
            bucket["lrn"] += 1

    subject_map = {
        int(r["id"]): r
        for r in db().con.execute(
            """
            SELECT s.id, s.name AS subject_name,
                   d.name AS discipline_name, d.color AS discipline_color
              FROM subjects s
              JOIN disciplines d ON d.id = s.discipline_id
            """
        ).fetchall()
    }
    discipline_map = {
        int(r["id"]): r
        for r in db().con.execute(
            "SELECT id, name AS discipline_name, color AS discipline_color FROM disciplines"
        ).fetchall()
    }

    results: list[dict[str, Any]] = []
    for sid, counts in subject_stats.items():
        if counts["due"] + counts["new"] + counts["lrn"] == 0:
            continue
        row = subject_map.get(sid)
        if row is None:
            continue
        results.append({
            "id": sid,
            "kind": "subject",
            "subject_name": row["subject_name"],
            "discipline_name": row["discipline_name"],
            "discipline_color": row["discipline_color"],
            "due": counts["due"],
            "new": counts["new"],
            "lrn": counts["lrn"],
        })
    for did, counts in discipline_stats.items():
        if counts["due"] + counts["new"] + counts["lrn"] == 0:
            continue
        row = discipline_map.get(did)
        if row is None:
            continue
        results.append({
            "id": did,
            "kind": "discipline",
            "subject_name": None,
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


def _launch_dynamic_deck(deck_name: str, note_ids: list[int]) -> None:
    if not note_ids:
        raise ValueError("No notes to study.")
    search = "nid:" + ",".join(str(int(n)) for n in note_ids)
    assert mw is not None
    did = mw.col.decks.newDyn(deck_name)
    deck_dict = mw.col.decks.get(did)
    deck_dict["terms"][0] = [search, 9999, 0]  # search, limit=all, order=random
    deck_dict["resched"] = True
    mw.col.decks.save(deck_dict)
    mw.col.sched.rebuildDyn(did)
    mw.col.decks.select(did)
    mw.moveToState("review")


@register("anki.study_subject")
def anki_study_subject(subject_id: int) -> None:
    """Create or rebuild a filtered deck for the subject and launch the reviewer."""
    subject_id = int(subject_id)
    row = db().get_subject(subject_id)
    if row is None:
        raise ValueError("Subject not found.")
    note_ids = db().note_ids_for_subject(subject_id)
    if not note_ids:
        raise ValueError("No notes assigned to this subject (or its topics).")
    deck_name = f"Study: {row['discipline_name']} › {row['subject_name']}"
    _launch_dynamic_deck(deck_name, note_ids)


@register("anki.study_topic")
def anki_study_topic(topic_id: int) -> None:
    topic_id = int(topic_id)
    row = db().get_topic(topic_id)
    if row is None:
        raise ValueError("Topic not found.")
    note_ids = db().note_ids_for_topic(topic_id)
    if not note_ids:
        raise ValueError("No notes assigned to this topic.")
    deck_name = (
        f"Study: {row['discipline_name']} › {row['subject_name']}"
        f" › {row['topic_name']}"
    )
    _launch_dynamic_deck(deck_name, note_ids)


@register("anki.study_discipline")
def anki_study_discipline(discipline_id: int) -> None:
    discipline_id = int(discipline_id)
    row = db().get_discipline(discipline_id)
    if row is None:
        raise ValueError("Discipline not found.")
    note_ids = db().note_ids_for_discipline(discipline_id)
    if not note_ids:
        raise ValueError("No notes assigned anywhere under this discipline.")
    deck_name = f"Study: {row['name']}"
    _launch_dynamic_deck(deck_name, note_ids)
