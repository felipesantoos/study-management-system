"""Anki-tag sync for Study Management System (phases 2-5 build on this skeleton).

When sync_anki_tags is enabled, each note's placement is mirrored as an Anki
tag under the smsys:: namespace.  Tag format:

  Discipline only  →  smsys::<Discipline>
  Subject direct   →  smsys::<Discipline>::<Subject>
  Topic direct     →  smsys::<Discipline>::<Subject>::<Topic>

This module owns every Anki-tag mutation.  db.py and api.py have no knowledge
of tag operations.

Phase 1 (this file): config plumbing only — enabled() + hot-reload.
Phases 2-5 add the actual tag-write helpers.
"""
from __future__ import annotations

from aqt import mw

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
    _sync_enabled = bool(cfg.get("sync_anki_tags", False))
    # Phase 5 will trigger backfill_all() here when transitioning False→True.


# ---------------------------------------------------------------------------
# Module init: seed the cache and register the config-change hook.
# ---------------------------------------------------------------------------

_sync_enabled = _read_config()
mw.addonManager.setConfigUpdatedAction(__name__, on_config_changed)
