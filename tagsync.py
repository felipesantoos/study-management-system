"""Anki-tag sync for Study Management System (phases 2-5 build on this skeleton).

When sync_anki_tags is enabled, each note's placement is mirrored as an Anki
tag under the smsys:: namespace.  Tag format:

  Discipline only  →  smsys::<Discipline>
  Subject direct   →  smsys::<Discipline>::<Subject>
  Topic direct     →  smsys::<Discipline>::<Subject>::<Topic>

This module owns every Anki-tag mutation.  db.py and api.py have no knowledge
of tag operations.
"""
from __future__ import annotations

import re
from typing import Callable, Sequence

from aqt import mw

from .db import SubjectsDB, db as _db_global


# ---------------------------------------------------------------------------
# In-memory config cache
# ---------------------------------------------------------------------------

_sync_enabled: bool = False


def _read_config() -> bool:
    cfg = mw.addonManager.getConfig(__name__)
    if cfg is None:
        return False
    return bool(cfg.get("sync_anki_tags", False))


def enabled() -> bool:
    """Return True if Anki-tag sync is currently enabled."""
    return _sync_enabled


# ---------------------------------------------------------------------------
# Hot-reload callback — invoked by Anki when the user saves the config.
# ---------------------------------------------------------------------------


def on_config_changed(cfg: dict) -> None:
    global _sync_enabled
    was_enabled = _sync_enabled
    _sync_enabled = bool(cfg.get("sync_anki_tags", False))
    if _sync_enabled and not was_enabled:
        backfill_all()


# ---------------------------------------------------------------------------
# Module init: seed the cache and register the config-change hook.
# ---------------------------------------------------------------------------

_sync_enabled = _read_config()
mw.addonManager.setConfigUpdatedAction(__name__, on_config_changed)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def _safe(name: str) -> str:
    """Sanitize a hierarchy component for use in an Anki tag.

    Whitespace runs → '_', '::' → '__', strip edges, fallback to '_'.
    """
    name = name.strip()
    name = re.sub(r"::", "__", name)
    name = re.sub(r"\s+", "_", name)
    return name or "_"


def _is_smsys_tag(tag: str) -> bool:
    return tag.startswith("smsys::")


# ---------------------------------------------------------------------------
# Tag computation
# ---------------------------------------------------------------------------


def tag_for(
    kind: str, target_id: int, *, _db: SubjectsDB | None = None
) -> str | None:
    """Return the full smsys:: tag for (kind, target_id), or None if gone."""
    database = _db if _db is not None else _db_global()
    if kind == "discipline":
        row = database.get_discipline(target_id)
        if row is None:
            return None
        return f"smsys::{_safe(row['name'])}"
    if kind == "subject":
        row = database.get_subject(target_id)
        if row is None:
            return None
        return f"smsys::{_safe(row['discipline_name'])}::{_safe(row['subject_name'])}"
    if kind == "topic":
        row = database.get_topic(target_id)
        if row is None:
            return None
        return (
            f"smsys::{_safe(row['discipline_name'])}"
            f"::{_safe(row['subject_name'])}"
            f"::{_safe(row['topic_name'])}"
        )
    return None


# ---------------------------------------------------------------------------
# Private write-path helpers — single chokepoint for all tag mutations
# ---------------------------------------------------------------------------


def _set_note_tag(col, note_id: int, new_tag: str | None) -> bool:
    """Strip all smsys:: tags from one note and optionally append new_tag.

    Single entry-point for every tag write; one note.tags assignment per call.
    Returns True if the note was actually modified.
    """
    note = col.get_note(note_id)
    new_list = [t for t in note.tags if not _is_smsys_tag(t)]
    if new_tag:
        new_list.append(new_tag)
    if new_list != note.tags:
        note.tags = new_list
        col.update_note(note)
        return True
    return False


# Anki caps its undo deque at 30 entries (UNDO_LIMIT in rslib/src/undo/mod.rs).
# Each col.update_note() pushes a new entry; past the limit the oldest entry —
# including our custom undo step — gets evicted, and the trailing
# merge_undo_entries() then raises "target undo op not found". Folding the
# intermediate steps back into the custom entry every N writes keeps it at the
# front of the deque so a single user-visible undo entry covers the whole batch.
_UNDO_MERGE_EVERY = 20


def _execute_batch(
    note_ids: list[int], tag_fn: Callable[[int], str | None]
) -> None:
    """Apply tag_fn(nid) for each note; wrap >50 notes in CollectionOp."""
    if not note_ids:
        return

    def _op(col):
        undo_id = col.add_custom_undo_entry("Update smsys:: tags")
        writes_since_merge = 0
        for nid in note_ids:
            if _set_note_tag(col, nid, tag_fn(nid)):
                writes_since_merge += 1
                if writes_since_merge >= _UNDO_MERGE_EVERY:
                    col.merge_undo_entries(undo_id)
                    writes_since_merge = 0
        return col.merge_undo_entries(undo_id)

    if len(note_ids) > 50:
        from aqt.operations import CollectionOp

        CollectionOp(parent=mw, op=_op).run_in_background()
    else:
        _op(mw.col)


def _tag_for_assignment(row) -> str | None:
    """Derive the smsys tag directly from a get_note_assignment row.

    Uses names already resolved in the row to avoid a second DB round-trip.
    """
    if row["direct_topic_id"] is not None:
        return (
            f"smsys::{_safe(row['discipline_name'])}"
            f"::{_safe(row['subject_name'])}"
            f"::{_safe(row['topic_name'])}"
        )
    if row["direct_subject_id"] is not None:
        return f"smsys::{_safe(row['discipline_name'])}::{_safe(row['subject_name'])}"
    return f"smsys::{_safe(row['discipline_name'])}"


# ---------------------------------------------------------------------------
# Public write paths — all guarded by enabled()
# ---------------------------------------------------------------------------


def apply_assignment(
    note_ids: Sequence[int],
    kind: str | None,
    target_id: int | None,
) -> None:
    """Strip any smsys::* tag from each note and (if given) append the new tag."""
    if not enabled():
        return
    if not note_ids:
        return
    new_tag: str | None = None
    if kind is not None and target_id is not None:
        new_tag = tag_for(kind, target_id)
    _execute_batch(list(note_ids), lambda _nid: new_tag)


def strip_smsys_tags(note_ids: Sequence[int]) -> None:
    """Remove any smsys::* tags from the given notes."""
    if not enabled():
        return
    _execute_batch(list(note_ids), lambda _nid: None)


def refresh_discipline_notes(discipline_id: int) -> None:
    """Re-apply the correct tag for all notes under a discipline (e.g. after rename)."""
    if not enabled():
        return
    _refresh_notes(_db_global().note_ids_for_discipline(discipline_id))


def refresh_subject_notes(subject_id: int) -> None:
    """Re-apply the correct tag for all notes under a subject (e.g. after rename)."""
    if not enabled():
        return
    _refresh_notes(_db_global().note_ids_for_subject(subject_id))


def refresh_topic_notes(topic_id: int) -> None:
    """Re-apply the correct tag for all notes in a topic (e.g. after rename)."""
    if not enabled():
        return
    _refresh_notes(_db_global().note_ids_for_topic(topic_id))


def _refresh_notes(note_ids: list[int]) -> None:
    """Re-derive and apply the correct smsys tag per note from its DB placement."""
    database = _db_global()

    def _tag_for_note(nid: int) -> str | None:
        row = database.get_note_assignment(nid)
        if row is None:
            return None
        return _tag_for_assignment(row)

    _execute_batch(note_ids, _tag_for_note)


def backfill_all() -> None:
    """Backfill smsys tags for all assigned notes (off→on transition).

    Chunks by 500 notes, each chunk in a CollectionOp for UI responsiveness.
    Idempotent: a second run produces zero update_note calls when already in sync.
    """
    from aqt.utils import tooltip

    database = _db_global()
    rows = database.get_all_note_assignments()

    if not rows:
        tooltip("Tags already in sync.")
        return

    tag_map: dict[int, str | None] = {
        int(row["note_id"]): _tag_for_assignment(row) for row in rows
    }
    note_ids = list(tag_map.keys())

    CHUNK_SIZE = 500
    chunks = [note_ids[i : i + CHUNK_SIZE] for i in range(0, len(note_ids), CHUNK_SIZE)]
    total_chunks = len(chunks)

    # Shared counters — safe because CollectionOps serialize on the col lock.
    total_updated = [0]
    completed = [0]

    from aqt.operations import CollectionOp

    def _make_chunk_op(chunk: list[int]):
        def _op(col):
            undo_id = col.add_custom_undo_entry("Backfill smsys:: tags")
            writes_since_merge = 0
            for nid in chunk:
                if _set_note_tag(col, nid, tag_map[nid]):
                    total_updated[0] += 1
                    writes_since_merge += 1
                    if writes_since_merge >= _UNDO_MERGE_EVERY:
                        col.merge_undo_entries(undo_id)
                        writes_since_merge = 0
            return col.merge_undo_entries(undo_id)

        def _on_success(_result) -> None:
            completed[0] += 1
            if completed[0] == total_chunks:
                n = total_updated[0]
                msg = f"Synced {n} subject tag(s)." if n else "Tags already in sync."
                tooltip(msg)

        return _op, _on_success

    for chunk in chunks:
        op_fn, success_fn = _make_chunk_op(chunk)
        CollectionOp(parent=mw, op=op_fn).success(success_fn).run_in_background()
