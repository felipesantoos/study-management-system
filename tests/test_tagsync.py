"""Unit tests for tagsync pure functions.

Run with:
    pytest tests/test_tagsync.py
from the addon root directory.  No Anki installation required.
"""
from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

# ---------------------------------------------------------------------------
# Stub Anki modules BEFORE any tagsync import
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

# aqt.utils stub — provides a mock tooltip callable.
if "aqt.utils" not in sys.modules:
    sys.modules["aqt.utils"] = types.ModuleType("aqt.utils")
_aqt_utils = sys.modules["aqt.utils"]
_aqt_utils.tooltip = MagicMock(name="tooltip")


class _SyncCollectionOp:
    """Test stub: runs op and success callback synchronously."""

    def __init__(self, parent, op):
        self._op_fn = op
        self._success_fn = None

    def success(self, fn):
        self._success_fn = fn
        return self

    def run_in_background(self):
        result = self._op_fn(_mock_mw.col)
        if self._success_fn is not None:
            self._success_fn(result)


sys.modules["aqt.operations"].CollectionOp = _SyncCollectionOp

# ---------------------------------------------------------------------------
# Load tagsync inside a synthetic package so relative imports resolve
# ---------------------------------------------------------------------------

_PKG = "_smsys_test_pkg"

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

# Convenience aliases
_safe = tagsync._safe
_is_smsys_tag = tagsync._is_smsys_tag
tag_for = tagsync.tag_for
_tag_for_assignment = tagsync._tag_for_assignment


# ---------------------------------------------------------------------------
# Mock DB
# ---------------------------------------------------------------------------


class _MockDB:
    """Minimal SubjectsDB stand-in for tag_for() tests."""

    _disciplines = {
        1: {"id": 1, "name": "Mathematics", "color": None, "position": 0},
        2: {"id": 2, "name": "Computer Science", "color": None, "position": 1},
    }
    _subjects = {
        10: {
            "subject_id": 10,
            "subject_name": "Calculus",
            "discipline_id": 1,
            "discipline_name": "Mathematics",
        },
        11: {
            "subject_id": 11,
            "subject_name": "Linear Algebra",
            "discipline_id": 1,
            "discipline_name": "Mathematics",
        },
    }
    _topics = {
        100: {
            "topic_id": 100,
            "topic_name": "Limits",
            "subject_id": 10,
            "subject_name": "Calculus",
            "discipline_id": 1,
            "discipline_name": "Mathematics",
        },
        101: {
            "topic_id": 101,
            "topic_name": "Data Structures",
            "subject_id": 10,
            "subject_name": "Algorithms",
            "discipline_id": 2,
            "discipline_name": "Computer Science",
        },
    }

    def get_discipline(self, id):
        return self._disciplines.get(id)

    def get_subject(self, id):
        return self._subjects.get(id)

    def get_topic(self, id):
        return self._topics.get(id)


_db = _MockDB()


# ---------------------------------------------------------------------------
# _safe()
# ---------------------------------------------------------------------------


def test_safe_plain_name():
    assert _safe("Mathematics") == "Mathematics"


def test_safe_strips_leading_trailing():
    assert _safe("  Mathematics  ") == "Mathematics"


def test_safe_single_space():
    assert _safe("Linear Algebra") == "Linear_Algebra"


def test_safe_collapses_multiple_spaces():
    assert _safe("a  b") == "a_b"


def test_safe_tab():
    assert _safe("a\tb") == "a_b"


def test_safe_double_colon():
    assert _safe("Math::Calculus") == "Math__Calculus"


def test_safe_empty_string_fallback():
    assert _safe("") == "_"


def test_safe_whitespace_only_fallback():
    assert _safe("   ") == "_"


def test_safe_no_colons_untouched():
    # single colon is not replaced
    assert _safe("a:b") == "a:b"


def test_safe_double_colon_with_surrounding_spaces():
    # spaces are turned into underscores; :: into __; they end up adjacent
    result = _safe("Math :: Calc")
    assert "::" not in result
    assert "Math" in result
    assert "Calc" in result


# ---------------------------------------------------------------------------
# _is_smsys_tag()
# ---------------------------------------------------------------------------


def test_is_smsys_tag_discipline_level():
    assert _is_smsys_tag("smsys::Mathematics")


def test_is_smsys_tag_subject_level():
    assert _is_smsys_tag("smsys::Mathematics::Calculus")


def test_is_smsys_tag_topic_level():
    assert _is_smsys_tag("smsys::Mathematics::Calculus::Limits")


def test_is_smsys_tag_bare_prefix_false():
    assert not _is_smsys_tag("smsys")
    assert not _is_smsys_tag("smsys:")


def test_is_smsys_tag_other_namespace_false():
    assert not _is_smsys_tag("other::tag")
    assert not _is_smsys_tag("SMS::tag")


def test_is_smsys_tag_empty_false():
    assert not _is_smsys_tag("")


# ---------------------------------------------------------------------------
# tag_for()
# ---------------------------------------------------------------------------


def test_tag_for_discipline():
    assert tag_for("discipline", 1, _db=_db) == "smsys::Mathematics"


def test_tag_for_discipline_missing():
    assert tag_for("discipline", 99, _db=_db) is None


def test_tag_for_subject():
    assert tag_for("subject", 10, _db=_db) == "smsys::Mathematics::Calculus"


def test_tag_for_subject_name_with_space():
    assert tag_for("subject", 11, _db=_db) == "smsys::Mathematics::Linear_Algebra"


def test_tag_for_subject_missing():
    assert tag_for("subject", 99, _db=_db) is None


def test_tag_for_topic():
    assert tag_for("topic", 100, _db=_db) == "smsys::Mathematics::Calculus::Limits"


def test_tag_for_topic_different_discipline():
    assert (
        tag_for("topic", 101, _db=_db)
        == "smsys::Computer_Science::Algorithms::Data_Structures"
    )


def test_tag_for_topic_missing():
    assert tag_for("topic", 99, _db=_db) is None


def test_tag_for_unknown_kind_returns_none():
    assert tag_for("unknown", 1, _db=_db) is None


# ---------------------------------------------------------------------------
# _tag_for_assignment()
# ---------------------------------------------------------------------------


def test_tag_for_assignment_discipline():
    row = {
        "direct_discipline_id": 1,
        "direct_subject_id": None,
        "direct_topic_id": None,
        "discipline_name": "Mathematics",
        "subject_name": None,
        "topic_name": None,
    }
    assert _tag_for_assignment(row) == "smsys::Mathematics"


def test_tag_for_assignment_subject():
    row = {
        "direct_discipline_id": None,
        "direct_subject_id": 10,
        "direct_topic_id": None,
        "discipline_name": "Mathematics",
        "subject_name": "Calculus",
        "topic_name": None,
    }
    assert _tag_for_assignment(row) == "smsys::Mathematics::Calculus"


def test_tag_for_assignment_topic():
    row = {
        "direct_discipline_id": None,
        "direct_subject_id": None,
        "direct_topic_id": 100,
        "discipline_name": "Mathematics",
        "subject_name": "Calculus",
        "topic_name": "Limits",
    }
    assert _tag_for_assignment(row) == "smsys::Mathematics::Calculus::Limits"


def test_tag_for_assignment_sanitizes_spaces():
    row = {
        "direct_discipline_id": None,
        "direct_subject_id": 10,
        "direct_topic_id": None,
        "discipline_name": "Natural Sciences",
        "subject_name": "Physics & Chem",
        "topic_name": None,
    }
    assert _tag_for_assignment(row) == "smsys::Natural_Sciences::Physics_&_Chem"


def test_tag_for_assignment_sanitizes_double_colon():
    row = {
        "direct_discipline_id": None,
        "direct_subject_id": None,
        "direct_topic_id": 100,
        "discipline_name": "Science::Math",
        "subject_name": "Calculus",
        "topic_name": "Limits",
    }
    assert _tag_for_assignment(row) == "smsys::Science__Math::Calculus::Limits"


def test_tag_for_assignment_topic_priority_over_subject():
    # direct_topic_id wins even when direct_subject_id is set (shouldn't happen
    # in practice, but the function must prioritise topic).
    row = {
        "direct_discipline_id": None,
        "direct_subject_id": 10,
        "direct_topic_id": 100,
        "discipline_name": "Mathematics",
        "subject_name": "Calculus",
        "topic_name": "Limits",
    }
    assert _tag_for_assignment(row) == "smsys::Mathematics::Calculus::Limits"


# ---------------------------------------------------------------------------
# Helpers for backfill tests
# ---------------------------------------------------------------------------


def _make_row(note_id, discipline, subject=None, topic=None):
    """Build a fake get_all_note_assignments row dict."""
    return {
        "note_id": note_id,
        "direct_discipline_id": None if (subject or topic) else 1,
        "direct_subject_id": 1 if (subject and not topic) else None,
        "direct_topic_id": 1 if topic else None,
        "discipline_name": discipline,
        "subject_name": subject,
        "topic_name": topic,
    }


class _MockNote:
    def __init__(self, tags=()):
        self.tags = list(tags)


def _setup_col(note_map: dict) -> None:
    """Configure _mock_mw.col for a backfill test."""
    _mock_mw.col.get_note.side_effect = lambda nid: note_map.get(nid, _MockNote())
    _mock_mw.col.add_custom_undo_entry.return_value = 42
    _mock_mw.col.merge_undo_entries.return_value = None
    _mock_mw.col.update_note.reset_mock()


# ---------------------------------------------------------------------------
# backfill_all()
# ---------------------------------------------------------------------------


def test_backfill_all_no_assignments():
    """Zero assignments → tooltip 'Tags already in sync.', no update_note calls."""
    _db_stub.db.return_value.get_all_note_assignments.return_value = []
    _aqt_utils.tooltip.reset_mock()
    _mock_mw.col.update_note.reset_mock()

    tagsync.backfill_all()

    _aqt_utils.tooltip.assert_called_once_with("Tags already in sync.")
    _mock_mw.col.update_note.assert_not_called()


def test_backfill_all_assigns_discipline_tag():
    """Discipline-level assignment → smsys::Discipline added, update_note called."""
    note = _MockNote()
    _db_stub.db.return_value.get_all_note_assignments.return_value = [
        _make_row(1001, "Mathematics"),
    ]
    _setup_col({1001: note})
    _aqt_utils.tooltip.reset_mock()

    tagsync.backfill_all()

    _mock_mw.col.update_note.assert_called_once()
    assert note.tags == ["smsys::Mathematics"]
    _aqt_utils.tooltip.assert_called_once_with("Synced 1 subject tag(s).")


def test_backfill_all_assigns_subject_tag():
    """Subject-level assignment → smsys::D::S added."""
    note = _MockNote()
    _db_stub.db.return_value.get_all_note_assignments.return_value = [
        _make_row(1002, "Mathematics", subject="Calculus"),
    ]
    _setup_col({1002: note})

    tagsync.backfill_all()

    assert note.tags == ["smsys::Mathematics::Calculus"]


def test_backfill_all_assigns_topic_tag():
    """Topic-level assignment → smsys::D::S::T added."""
    note = _MockNote()
    _db_stub.db.return_value.get_all_note_assignments.return_value = [
        _make_row(1003, "Mathematics", subject="Calculus", topic="Limits"),
    ]
    _setup_col({1003: note})

    tagsync.backfill_all()

    assert note.tags == ["smsys::Mathematics::Calculus::Limits"]


def test_backfill_all_idempotent():
    """Notes already carrying the correct tag → zero update_note calls."""
    note = _MockNote(["smsys::Mathematics"])
    _db_stub.db.return_value.get_all_note_assignments.return_value = [
        _make_row(1001, "Mathematics"),
    ]
    _setup_col({1001: note})
    _aqt_utils.tooltip.reset_mock()

    tagsync.backfill_all()

    _mock_mw.col.update_note.assert_not_called()
    _aqt_utils.tooltip.assert_called_once_with("Tags already in sync.")


def test_backfill_all_replaces_wrong_smsys_tag():
    """Note with a stale smsys tag → tag replaced, update_note called once."""
    note = _MockNote(["smsys::OldDiscipline"])
    _db_stub.db.return_value.get_all_note_assignments.return_value = [
        _make_row(1001, "Mathematics"),
    ]
    _setup_col({1001: note})

    tagsync.backfill_all()

    _mock_mw.col.update_note.assert_called_once()
    assert note.tags == ["smsys::Mathematics"]


def test_backfill_all_preserves_non_smsys_tags():
    """Non-smsys tags on a note survive the backfill."""
    note = _MockNote(["some-other-tag"])
    _db_stub.db.return_value.get_all_note_assignments.return_value = [
        _make_row(1001, "Mathematics"),
    ]
    _setup_col({1001: note})

    tagsync.backfill_all()

    assert "some-other-tag" in note.tags
    assert "smsys::Mathematics" in note.tags


def test_backfill_all_multiple_notes():
    """Multiple assigned notes all get correct tags; tooltip reports count."""
    note_a = _MockNote()
    note_b = _MockNote(["smsys::Mathematics::Calculus"])  # already correct
    note_c = _MockNote()
    _db_stub.db.return_value.get_all_note_assignments.return_value = [
        _make_row(10, "Mathematics"),
        _make_row(11, "Mathematics", subject="Calculus"),
        _make_row(12, "Physics", subject="Mechanics", topic="Newton"),
    ]
    _setup_col({10: note_a, 11: note_b, 12: note_c})
    _aqt_utils.tooltip.reset_mock()

    tagsync.backfill_all()

    assert note_a.tags == ["smsys::Mathematics"]
    assert note_b.tags == ["smsys::Mathematics::Calculus"]  # unchanged
    assert note_c.tags == ["smsys::Physics::Mechanics::Newton"]
    # note_b was already correct → only 2 actual updates
    assert _mock_mw.col.update_note.call_count == 2
    _aqt_utils.tooltip.assert_called_once_with("Synced 2 subject tag(s).")


# ---------------------------------------------------------------------------
# on_config_changed() — backfill trigger
# ---------------------------------------------------------------------------


def test_on_config_changed_triggers_backfill_on_off_to_on():
    """off→on transition calls backfill_all()."""
    from unittest.mock import patch

    tagsync._sync_enabled = False
    with patch.object(tagsync, "backfill_all") as mock_backfill:
        tagsync.on_config_changed({"sync_anki_tags": True})
        mock_backfill.assert_called_once()
    assert tagsync._sync_enabled is True


def test_on_config_changed_no_backfill_when_already_enabled():
    """on→on: no backfill triggered."""
    from unittest.mock import patch

    tagsync._sync_enabled = True
    with patch.object(tagsync, "backfill_all") as mock_backfill:
        tagsync.on_config_changed({"sync_anki_tags": True})
        mock_backfill.assert_not_called()


def test_on_config_changed_no_backfill_on_disable():
    """on→off: no backfill triggered, sync disabled."""
    from unittest.mock import patch

    tagsync._sync_enabled = True
    with patch.object(tagsync, "backfill_all") as mock_backfill:
        tagsync.on_config_changed({"sync_anki_tags": False})
        mock_backfill.assert_not_called()
    assert tagsync._sync_enabled is False
