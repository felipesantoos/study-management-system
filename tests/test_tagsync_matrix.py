"""FDA-700 QA matrix tests for the tag-sync feature.

Covers all 9 rows of the test matrix:
  1. Toggle off (default): no smsys:: changes on any operation.
  2. Toggle on, fresh note, placements: assign/unassign/reassign at each depth.
  3. Bulk-assign 50 notes: single undo entry.
  4. Rename D/S/T: descendant notes get refreshed tags.
  5. Delete cascading: descendant notes lose smsys:: tags.
  6. Non-smsys tag preserved through all operations.
  7. Pre-existing smsys::Other::Thing: replaced on assignment change; preserved if no change.
  8. off->on backfill 100 notes: idempotent (second run = zero update_note calls).
  9. on->off: subsequent assign operations make no tag changes.
"""
from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

# ---------------------------------------------------------------------------
# Stub Anki modules (same pattern as test_tagsync.py)
# ---------------------------------------------------------------------------

_ADDON_DIR = Path(__file__).parent.parent

_mock_mw = MagicMock()
_mock_mw.addonManager.getConfig.return_value = {"sync_anki_tags": False}

if "aqt" not in sys.modules:
    _aqt = types.ModuleType("aqt")
    _aqt.mw = _mock_mw
    sys.modules["aqt"] = _aqt

if "aqt.operations" not in sys.modules:
    sys.modules["aqt.operations"] = types.ModuleType("aqt.operations")

if "aqt.utils" not in sys.modules:
    sys.modules["aqt.utils"] = types.ModuleType("aqt.utils")
_aqt_utils = sys.modules["aqt.utils"]
_aqt_utils.tooltip = MagicMock(name="tooltip")


class _SyncCollectionOp:
    """Runs op and success callback synchronously — used for >50-note paths."""

    _last_instance = None

    def __init__(self, parent, op):
        self._op_fn = op
        self._success_fn = None
        _SyncCollectionOp._last_instance = self

    def success(self, fn):
        self._success_fn = fn
        return self

    def run_in_background(self):
        result = self._op_fn(_mock_mw.col)
        if self._success_fn is not None:
            self._success_fn(result)


sys.modules["aqt.operations"].CollectionOp = _SyncCollectionOp

# ---------------------------------------------------------------------------
# Load tagsync in synthetic package (avoids conflict with original test load)
# ---------------------------------------------------------------------------

_PKG = "_smsys_matrix_pkg"

_pkg_mod = types.ModuleType(_PKG)
_pkg_mod.__path__ = [str(_ADDON_DIR)]
_pkg_mod.__package__ = _PKG
sys.modules[_PKG] = _pkg_mod

_db_stub = types.ModuleType(f"{_PKG}.db")
_db_stub.SubjectsDB = type("SubjectsDB", (), {})
_db_stub.db = MagicMock()
sys.modules[f"{_PKG}.db"] = _db_stub

_spec = importlib.util.spec_from_file_location(
    f"{_PKG}.tagsync",
    _ADDON_DIR / "tagsync.py",
)
_ts = importlib.util.module_from_spec(_spec)
_ts.__package__ = _PKG
sys.modules[f"{_PKG}.tagsync"] = _ts
_spec.loader.exec_module(_ts)

tagsync = _ts

# ---------------------------------------------------------------------------
# Shared DB fixture data
# ---------------------------------------------------------------------------

_DISC = {1: {"id": 1, "name": "Mathematics", "color": None, "position": 0}}
_SUBJ = {
    10: {
        "subject_id": 10,
        "subject_name": "Calculus",
        "discipline_id": 1,
        "discipline_name": "Mathematics",
    }
}
_TOPIC = {
    100: {
        "topic_id": 100,
        "topic_name": "Limits",
        "subject_id": 10,
        "subject_name": "Calculus",
        "discipline_id": 1,
        "discipline_name": "Mathematics",
    }
}


def _setup_db():
    """Wire up the mock DB with standard discipline/subject/topic lookups."""
    db = _db_stub.db.return_value
    db.get_discipline.side_effect = lambda id: _DISC.get(id)
    db.get_subject.side_effect = lambda id: _SUBJ.get(id)
    db.get_topic.side_effect = lambda id: _TOPIC.get(id)
    return db


class _MockNote:
    def __init__(self, tags=()):
        self.tags = list(tags)


def _setup_col(*notes_by_id: tuple[int, _MockNote]):
    """Configure _mock_mw.col with given {note_id: MockNote} pairs."""
    note_map = dict(notes_by_id)
    _mock_mw.col.get_note.side_effect = lambda nid: note_map.get(nid, _MockNote())
    _mock_mw.col.add_custom_undo_entry.reset_mock()
    _mock_mw.col.add_custom_undo_entry.return_value = 42
    _mock_mw.col.merge_undo_entries.reset_mock()
    _mock_mw.col.merge_undo_entries.return_value = None
    _mock_mw.col.update_note.reset_mock()


# ---------------------------------------------------------------------------
# Row 1: Toggle off (default) — no smsys:: changes on any operation
# ---------------------------------------------------------------------------


def test_row1_toggle_off_apply_assignment_is_noop():
    """apply_assignment() with sync disabled must not touch any note."""
    tagsync._sync_enabled = False
    note = _MockNote(["existing"])
    _setup_col((1, note))
    _setup_db()

    tagsync.apply_assignment([1], "discipline", 1)

    _mock_mw.col.update_note.assert_not_called()
    assert note.tags == ["existing"]


def test_row1_toggle_off_strip_smsys_tags_is_noop():
    """strip_smsys_tags() with sync disabled must not touch any note."""
    tagsync._sync_enabled = False
    note = _MockNote(["smsys::Mathematics"])
    _setup_col((2, note))

    tagsync.strip_smsys_tags([2])

    _mock_mw.col.update_note.assert_not_called()
    assert "smsys::Mathematics" in note.tags


def test_row1_toggle_off_refresh_discipline_is_noop():
    """refresh_discipline_notes() with sync disabled must not touch any note."""
    tagsync._sync_enabled = False
    db = _setup_db()
    db.note_ids_for_discipline.return_value = [3, 4]
    note3 = _MockNote(["smsys::Mathematics"])
    note4 = _MockNote()
    _setup_col((3, note3), (4, note4))

    tagsync.refresh_discipline_notes(1)

    _mock_mw.col.update_note.assert_not_called()


def test_row1_toggle_off_refresh_subject_is_noop():
    """refresh_subject_notes() with sync disabled must not touch any note."""
    tagsync._sync_enabled = False
    db = _setup_db()
    db.note_ids_for_subject.return_value = [5]
    note5 = _MockNote(["smsys::Mathematics::Calculus"])
    _setup_col((5, note5))

    tagsync.refresh_subject_notes(10)

    _mock_mw.col.update_note.assert_not_called()


def test_row1_toggle_off_refresh_topic_is_noop():
    """refresh_topic_notes() with sync disabled must not touch any note."""
    tagsync._sync_enabled = False
    db = _setup_db()
    db.note_ids_for_topic.return_value = [6]
    note6 = _MockNote(["smsys::Mathematics::Calculus::Limits"])
    _setup_col((6, note6))

    tagsync.refresh_topic_notes(100)

    _mock_mw.col.update_note.assert_not_called()


# ---------------------------------------------------------------------------
# Row 2: Toggle on, fresh note, three placements
# ---------------------------------------------------------------------------


def test_row2_assign_discipline_tag():
    """assign → discipline → smsys::Mathematics."""
    tagsync._sync_enabled = True
    _setup_db()
    note = _MockNote()
    _setup_col((10, note))

    tagsync.apply_assignment([10], "discipline", 1)

    assert note.tags == ["smsys::Mathematics"]
    _mock_mw.col.update_note.assert_called_once()


def test_row2_assign_subject_tag():
    """assign → subject → smsys::Mathematics::Calculus."""
    tagsync._sync_enabled = True
    _setup_db()
    note = _MockNote()
    _setup_col((11, note))

    tagsync.apply_assignment([11], "subject", 10)

    assert note.tags == ["smsys::Mathematics::Calculus"]
    _mock_mw.col.update_note.assert_called_once()


def test_row2_assign_topic_tag():
    """assign → topic → smsys::Mathematics::Calculus::Limits."""
    tagsync._sync_enabled = True
    _setup_db()
    note = _MockNote()
    _setup_col((12, note))

    tagsync.apply_assignment([12], "topic", 100)

    assert note.tags == ["smsys::Mathematics::Calculus::Limits"]
    _mock_mw.col.update_note.assert_called_once()


def test_row2_unassign_removes_tag():
    """unassign (kind=None, id=None) removes any smsys:: tag."""
    tagsync._sync_enabled = True
    _setup_db()
    note = _MockNote(["smsys::Mathematics"])
    _setup_col((13, note))

    tagsync.apply_assignment([13], None, None)

    assert not any(t.startswith("smsys::") for t in note.tags)
    _mock_mw.col.update_note.assert_called_once()


def test_row2_unassign_already_clean_no_update():
    """unassign on a note with no smsys:: tag → no update_note call."""
    tagsync._sync_enabled = True
    _setup_db()
    note = _MockNote(["other-tag"])
    _setup_col((14, note))

    tagsync.apply_assignment([14], None, None)

    _mock_mw.col.update_note.assert_not_called()


def test_row2_reassign_different_depth_replaces_tag():
    """note had discipline tag; reassign at topic depth → old tag replaced."""
    tagsync._sync_enabled = True
    _setup_db()
    note = _MockNote(["smsys::Mathematics"])
    _setup_col((15, note))

    tagsync.apply_assignment([15], "topic", 100)

    assert "smsys::Mathematics::Calculus::Limits" in note.tags
    assert "smsys::Mathematics" not in note.tags
    _mock_mw.col.update_note.assert_called_once()


def test_row2_reassign_subject_to_discipline_replaces_tag():
    """note had subject tag; reassign at discipline depth → old tag replaced."""
    tagsync._sync_enabled = True
    _setup_db()
    note = _MockNote(["smsys::Mathematics::Calculus"])
    _setup_col((16, note))

    tagsync.apply_assignment([16], "discipline", 1)

    assert "smsys::Mathematics" in note.tags
    assert "smsys::Mathematics::Calculus" not in note.tags
    _mock_mw.col.update_note.assert_called_once()


# ---------------------------------------------------------------------------
# Row 3: Bulk-assign 50 notes — single undo entry
# ---------------------------------------------------------------------------


def test_row3_bulk_assign_50_notes_single_undo_entry():
    """50 notes → uses inline _op path (not CollectionOp) → one undo entry."""
    tagsync._sync_enabled = True
    _setup_db()

    nids = list(range(100, 150))  # exactly 50 notes
    notes = {nid: _MockNote() for nid in nids}
    _setup_col(*notes.items())

    tagsync.apply_assignment(nids, "discipline", 1)

    # Single undo entry created and merged
    _mock_mw.col.add_custom_undo_entry.assert_called_once_with("Update smsys:: tags")
    _mock_mw.col.merge_undo_entries.assert_called_once_with(42)

    # All 50 notes carry the correct tag
    for note in notes.values():
        assert "smsys::Mathematics" in note.tags

    assert _mock_mw.col.update_note.call_count == 50


def test_row3_bulk_assign_51_notes_uses_collection_op():
    """51 notes → CollectionOp path; still exactly one undo entry per chunk."""
    tagsync._sync_enabled = True
    _setup_db()

    nids = list(range(200, 251))  # 51 notes → triggers CollectionOp
    notes = {nid: _MockNote() for nid in nids}
    _setup_col(*notes.items())

    tagsync.apply_assignment(nids, "discipline", 1)

    # CollectionOp runs _op which creates one undo entry
    _mock_mw.col.add_custom_undo_entry.assert_called_once_with("Update smsys:: tags")
    assert _mock_mw.col.update_note.call_count == 51


# ---------------------------------------------------------------------------
# Row 4: Rename D/S/T — descendant notes get refreshed tags
# ---------------------------------------------------------------------------


def _assignment_row(nid, discipline, subject=None, topic=None):
    return {
        "note_id": nid,
        "discipline_id": 1,
        "discipline_name": discipline,
        "subject_id": 10 if subject else None,
        "subject_name": subject,
        "topic_id": 100 if topic else None,
        "topic_name": topic,
        "direct_discipline_id": None if (subject or topic) else 1,
        "direct_subject_id": 10 if (subject and not topic) else None,
        "direct_topic_id": 100 if topic else None,
    }


def test_row4_rename_discipline_refreshes_notes():
    """After discipline rename, all notes under it get updated tags."""
    tagsync._sync_enabled = True
    db = _setup_db()
    db.note_ids_for_discipline.return_value = [300, 301]
    db.get_note_assignment.side_effect = lambda nid: {
        300: _assignment_row(300, "NewMath"),
        301: _assignment_row(301, "NewMath", subject="Calculus"),
    }.get(nid)

    note300 = _MockNote(["smsys::Mathematics"])
    note301 = _MockNote(["smsys::Mathematics::Calculus"])
    _setup_col((300, note300), (301, note301))

    tagsync.refresh_discipline_notes(1)

    assert "smsys::NewMath" in note300.tags
    assert "smsys::Mathematics" not in note300.tags
    assert "smsys::NewMath::Calculus" in note301.tags
    assert _mock_mw.col.update_note.call_count == 2


def test_row4_rename_subject_refreshes_notes():
    """After subject rename, all notes under it get updated tags."""
    tagsync._sync_enabled = True
    db = _setup_db()
    db.note_ids_for_subject.return_value = [310, 311]
    db.get_note_assignment.side_effect = lambda nid: {
        310: _assignment_row(310, "Mathematics", subject="NewCalc"),
        311: _assignment_row(311, "Mathematics", subject="NewCalc", topic="Limits"),
    }.get(nid)

    note310 = _MockNote(["smsys::Mathematics::Calculus"])
    note311 = _MockNote(["smsys::Mathematics::Calculus::Limits"])
    _setup_col((310, note310), (311, note311))

    tagsync.refresh_subject_notes(10)

    assert "smsys::Mathematics::NewCalc" in note310.tags
    assert "smsys::Mathematics::NewCalc::Limits" in note311.tags
    assert _mock_mw.col.update_note.call_count == 2


def test_row4_rename_topic_refreshes_notes():
    """After topic rename, notes under it get updated tag."""
    tagsync._sync_enabled = True
    db = _setup_db()
    db.note_ids_for_topic.return_value = [320]
    db.get_note_assignment.side_effect = lambda nid: {
        320: _assignment_row(320, "Mathematics", subject="Calculus", topic="NewLimits"),
    }.get(nid)

    note320 = _MockNote(["smsys::Mathematics::Calculus::Limits"])
    _setup_col((320, note320))

    tagsync.refresh_topic_notes(100)

    assert "smsys::Mathematics::Calculus::NewLimits" in note320.tags
    assert "smsys::Mathematics::Calculus::Limits" not in note320.tags
    _mock_mw.col.update_note.assert_called_once()


# ---------------------------------------------------------------------------
# Row 5: Delete cascading — descendant notes lose smsys:: tags
# ---------------------------------------------------------------------------


def test_row5_delete_discipline_removes_all_smsys_tags():
    """strip_smsys_tags() removes smsys:: from all descendant notes."""
    tagsync._sync_enabled = True
    note_a = _MockNote(["smsys::Mathematics"])
    note_b = _MockNote(["smsys::Mathematics::Calculus"])
    note_c = _MockNote(["smsys::Mathematics::Calculus::Limits"])
    _setup_col((400, note_a), (401, note_b), (402, note_c))

    tagsync.strip_smsys_tags([400, 401, 402])

    for note in [note_a, note_b, note_c]:
        assert not any(t.startswith("smsys::") for t in note.tags)
    assert _mock_mw.col.update_note.call_count == 3


def test_row5_delete_does_not_touch_unrelated_notes():
    """strip_smsys_tags() only touches notes in the given list."""
    tagsync._sync_enabled = True
    # note 500 is NOT in the delete list
    note_keep = _MockNote(["smsys::Mathematics"])
    note_del = _MockNote(["smsys::Mathematics::Calculus"])
    _setup_col((500, note_keep), (501, note_del))

    tagsync.strip_smsys_tags([501])

    assert "smsys::Mathematics" in note_keep.tags  # untouched
    assert not any(t.startswith("smsys::") for t in note_del.tags)


# ---------------------------------------------------------------------------
# Row 6: Non-smsys tag preserved through all operations
# ---------------------------------------------------------------------------


def test_row6_non_smsys_tag_preserved_through_assign():
    """Non-smsys tags survive apply_assignment."""
    tagsync._sync_enabled = True
    _setup_db()
    note = _MockNote(["my-custom-tag", "another::tag"])
    _setup_col((600, note))

    tagsync.apply_assignment([600], "discipline", 1)

    assert "my-custom-tag" in note.tags
    assert "another::tag" in note.tags
    assert "smsys::Mathematics" in note.tags


def test_row6_non_smsys_tag_preserved_through_unassign():
    """Non-smsys tags survive unassign."""
    tagsync._sync_enabled = True
    _setup_db()
    note = _MockNote(["my-custom-tag", "smsys::Mathematics"])
    _setup_col((601, note))

    tagsync.apply_assignment([601], None, None)

    assert "my-custom-tag" in note.tags
    assert not any(t.startswith("smsys::") for t in note.tags)


def test_row6_non_smsys_tag_preserved_through_strip():
    """Non-smsys tags survive strip_smsys_tags."""
    tagsync._sync_enabled = True
    note = _MockNote(["my-custom-tag", "smsys::Mathematics"])
    _setup_col((602, note))

    tagsync.strip_smsys_tags([602])

    assert "my-custom-tag" in note.tags
    assert not any(t.startswith("smsys::") for t in note.tags)


def test_row6_non_smsys_tag_preserved_through_refresh():
    """Non-smsys tags survive refresh_discipline_notes."""
    tagsync._sync_enabled = True
    db = _setup_db()
    db.note_ids_for_discipline.return_value = [603]
    db.get_note_assignment.side_effect = lambda nid: (
        _assignment_row(603, "Mathematics") if nid == 603 else None
    )

    note = _MockNote(["my-custom-tag", "smsys::Mathematics"])
    _setup_col((603, note))

    tagsync.refresh_discipline_notes(1)

    assert "my-custom-tag" in note.tags


# ---------------------------------------------------------------------------
# Row 7: Pre-existing smsys::Other::Thing
# ---------------------------------------------------------------------------


def test_row7_rogue_smsys_tag_replaced_on_assignment():
    """smsys::Other::Thing replaced when note is assigned."""
    tagsync._sync_enabled = True
    _setup_db()
    note = _MockNote(["smsys::Other::Thing"])
    _setup_col((700, note))

    tagsync.apply_assignment([700], "discipline", 1)

    assert "smsys::Mathematics" in note.tags
    assert "smsys::Other::Thing" not in note.tags
    _mock_mw.col.update_note.assert_called_once()


def test_row7_rogue_smsys_tag_preserved_if_no_assignment_change():
    """smsys::Other::Thing on a note not touched by any operation stays."""
    tagsync._sync_enabled = True
    _setup_db()
    note = _MockNote(["smsys::Other::Thing"])
    _setup_col((701, note))

    # No tagsync operation is triggered for note 701
    # (simulate: some other note is assigned, 701 is not in the list)
    tagsync.apply_assignment([999], "discipline", 1)

    assert "smsys::Other::Thing" in note.tags


def test_row7_rogue_smsys_tag_replaced_on_refresh():
    """smsys::Other::Thing is replaced when refresh touches the note."""
    tagsync._sync_enabled = True
    db = _setup_db()
    db.note_ids_for_discipline.return_value = [702]
    db.get_note_assignment.side_effect = lambda nid: (
        _assignment_row(702, "Mathematics") if nid == 702 else None
    )

    note = _MockNote(["smsys::Other::Thing"])
    _setup_col((702, note))

    tagsync.refresh_discipline_notes(1)

    assert "smsys::Mathematics" in note.tags
    assert "smsys::Other::Thing" not in note.tags


# ---------------------------------------------------------------------------
# Row 8: Toggle off→on backfill 100 notes — idempotent second run
# ---------------------------------------------------------------------------


def _make_backfill_rows(count):
    """Return `count` assignment rows: 1/3 discipline, 1/3 subject, 1/3 topic."""
    rows = []
    for i in range(count):
        nid = 800 + i
        rem = i % 3
        if rem == 0:
            rows.append(
                {
                    "note_id": nid,
                    "direct_discipline_id": 1,
                    "direct_subject_id": None,
                    "direct_topic_id": None,
                    "discipline_name": "Mathematics",
                    "subject_name": None,
                    "topic_name": None,
                }
            )
        elif rem == 1:
            rows.append(
                {
                    "note_id": nid,
                    "direct_discipline_id": None,
                    "direct_subject_id": 10,
                    "direct_topic_id": None,
                    "discipline_name": "Mathematics",
                    "subject_name": "Calculus",
                    "topic_name": None,
                }
            )
        else:
            rows.append(
                {
                    "note_id": nid,
                    "direct_discipline_id": None,
                    "direct_subject_id": None,
                    "direct_topic_id": 100,
                    "discipline_name": "Mathematics",
                    "subject_name": "Calculus",
                    "topic_name": "Limits",
                }
            )
    return rows


def _expected_tag(row):
    if row["direct_topic_id"] is not None:
        return "smsys::Mathematics::Calculus::Limits"
    if row["direct_subject_id"] is not None:
        return "smsys::Mathematics::Calculus"
    return "smsys::Mathematics"


def test_row8_backfill_100_notes_produces_100_tags():
    """off→on backfill with 100 assigned notes → 100 correct tags applied."""
    tagsync._sync_enabled = True
    db = _setup_db()
    rows = _make_backfill_rows(100)
    db.get_all_note_assignments.return_value = rows

    notes = {row["note_id"]: _MockNote() for row in rows}
    _setup_col(*notes.items())
    _aqt_utils.tooltip.reset_mock()

    tagsync.backfill_all()

    assert _mock_mw.col.update_note.call_count == 100
    for row in rows:
        note = notes[row["note_id"]]
        assert _expected_tag(row) in note.tags

    _aqt_utils.tooltip.assert_called_once_with("Synced 100 subject tag(s).")


def test_row8_backfill_second_run_is_noop():
    """Second backfill_all() on already-tagged notes → zero update_note calls."""
    tagsync._sync_enabled = True
    db = _setup_db()
    rows = _make_backfill_rows(100)
    db.get_all_note_assignments.return_value = rows

    # Notes already carry the correct tags
    notes = {
        row["note_id"]: _MockNote([_expected_tag(row)])
        for row in rows
    }
    _setup_col(*notes.items())
    _aqt_utils.tooltip.reset_mock()

    tagsync.backfill_all()

    _mock_mw.col.update_note.assert_not_called()
    _aqt_utils.tooltip.assert_called_once_with("Tags already in sync.")


# ---------------------------------------------------------------------------
# Row 9: Toggle on→off — subsequent assigns make no tag changes
# ---------------------------------------------------------------------------


def test_row9_toggle_on_to_off_subsequent_assign_noop():
    """After disabling sync, apply_assignment must not touch notes."""
    tagsync._sync_enabled = False  # simulates on→off completed
    _setup_db()
    note = _MockNote(["smsys::Mathematics"])
    _setup_col((900, note))

    tagsync.apply_assignment([900], "subject", 10)

    _mock_mw.col.update_note.assert_not_called()
    # Tag remains unchanged (existing tags persist)
    assert "smsys::Mathematics" in note.tags


def test_row9_toggle_on_to_off_existing_tags_remain():
    """After disabling sync, existing smsys:: tags on notes are untouched."""
    tagsync._sync_enabled = False
    _setup_db()
    note = _MockNote(["smsys::Mathematics", "my-tag"])
    _setup_col((901, note))

    # No operation should touch note 901; its tags survive
    assert "smsys::Mathematics" in note.tags
    assert "my-tag" in note.tags
    _mock_mw.col.update_note.assert_not_called()


def test_row9_toggle_off_strip_also_noop():
    """After disabling sync, strip_smsys_tags is also a noop."""
    tagsync._sync_enabled = False
    note = _MockNote(["smsys::Mathematics"])
    _setup_col((902, note))

    tagsync.strip_smsys_tags([902])

    _mock_mw.col.update_note.assert_not_called()
    assert "smsys::Mathematics" in note.tags
