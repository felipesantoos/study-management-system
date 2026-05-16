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
