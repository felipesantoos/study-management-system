from __future__ import annotations

import os
import sqlite3
from typing import Sequence

from aqt import mw


# Files in collection.media/ whose names start with `_` are exempt from
# Tools → Check Media's unused-files sweep, and the whole folder rides
# along on AnkiWeb media sync.
DB_FILENAME = "_study_management_system.db"


class SubjectsDB:
    def __init__(self, path: str) -> None:
        self.con = sqlite3.connect(path)
        self.con.execute("PRAGMA foreign_keys = ON")
        self.con.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        self.con.executescript(
            """
            CREATE TABLE IF NOT EXISTS disciplines (
                id   INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS subjects (
                id            INTEGER PRIMARY KEY,
                discipline_id INTEGER NOT NULL
                    REFERENCES disciplines(id) ON DELETE CASCADE,
                name          TEXT NOT NULL,
                UNIQUE(discipline_id, name)
            );
            CREATE TABLE IF NOT EXISTS note_subjects (
                note_id    INTEGER PRIMARY KEY,
                subject_id INTEGER NOT NULL
                    REFERENCES subjects(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_note_subjects_subject_id
                ON note_subjects(subject_id);
            """
        )
        self.con.commit()

    def list_disciplines(self) -> list[sqlite3.Row]:
        return list(
            self.con.execute("SELECT id, name FROM disciplines ORDER BY name")
        )

    def add_discipline(self, name: str) -> int:
        cur = self.con.execute(
            "INSERT INTO disciplines (name) VALUES (?)", (name,)
        )
        self.con.commit()
        return cur.lastrowid

    def rename_discipline(self, discipline_id: int, name: str) -> None:
        self.con.execute(
            "UPDATE disciplines SET name = ? WHERE id = ?",
            (name, discipline_id),
        )
        self.con.commit()

    def delete_discipline(self, discipline_id: int) -> None:
        self.con.execute(
            "DELETE FROM disciplines WHERE id = ?", (discipline_id,)
        )
        self.con.commit()

    def list_subjects(self, discipline_id: int) -> list[sqlite3.Row]:
        return list(
            self.con.execute(
                """
                SELECT s.id, s.name, COUNT(ns.note_id) AS note_count
                  FROM subjects s
                  LEFT JOIN note_subjects ns ON ns.subject_id = s.id
                 WHERE s.discipline_id = ?
                 GROUP BY s.id, s.name
                 ORDER BY s.name
                """,
                (discipline_id,),
            )
        )

    def add_subject(self, discipline_id: int, name: str) -> int:
        cur = self.con.execute(
            "INSERT INTO subjects (discipline_id, name) VALUES (?, ?)",
            (discipline_id, name),
        )
        self.con.commit()
        return cur.lastrowid

    def rename_subject(self, subject_id: int, name: str) -> None:
        self.con.execute(
            "UPDATE subjects SET name = ? WHERE id = ?", (name, subject_id)
        )
        self.con.commit()

    def delete_subject(self, subject_id: int) -> None:
        self.con.execute("DELETE FROM subjects WHERE id = ?", (subject_id,))
        self.con.commit()

    def assign_note(self, note_id: int, subject_id: int | None) -> None:
        if subject_id is None:
            self.con.execute(
                "DELETE FROM note_subjects WHERE note_id = ?", (note_id,)
            )
        else:
            self.con.execute(
                "INSERT INTO note_subjects (note_id, subject_id) VALUES (?, ?)"
                "  ON CONFLICT(note_id)"
                "  DO UPDATE SET subject_id = excluded.subject_id",
                (note_id, subject_id),
            )
        self.con.commit()

    def bulk_assign(
        self, note_ids: Sequence[int], subject_id: int | None
    ) -> None:
        if subject_id is None:
            self.con.executemany(
                "DELETE FROM note_subjects WHERE note_id = ?",
                [(n,) for n in note_ids],
            )
        else:
            self.con.executemany(
                "INSERT INTO note_subjects (note_id, subject_id) VALUES (?, ?)"
                "  ON CONFLICT(note_id)"
                "  DO UPDATE SET subject_id = excluded.subject_id",
                [(n, subject_id) for n in note_ids],
            )
        self.con.commit()

    def get_note_subject(self, note_id: int) -> sqlite3.Row | None:
        return self.con.execute(
            """
            SELECT s.id AS subject_id, s.name AS subject_name,
                   d.id AS discipline_id, d.name AS discipline_name
              FROM note_subjects ns
              JOIN subjects s    ON s.id = ns.subject_id
              JOIN disciplines d ON d.id = s.discipline_id
             WHERE ns.note_id = ?
            """,
            (note_id,),
        ).fetchone()

    def get_subject(self, subject_id: int) -> sqlite3.Row | None:
        return self.con.execute(
            """
            SELECT s.id AS subject_id, s.name AS subject_name,
                   d.id AS discipline_id, d.name AS discipline_name
              FROM subjects s
              JOIN disciplines d ON d.id = s.discipline_id
             WHERE s.id = ?
            """,
            (subject_id,),
        ).fetchone()

    def note_ids_for_subject(self, subject_id: int) -> list[int]:
        return [
            row[0]
            for row in self.con.execute(
                "SELECT note_id FROM note_subjects WHERE subject_id = ?",
                (subject_id,),
            )
        ]

    def delete_note_assignments(self, note_ids: Sequence[int]) -> None:
        if not note_ids:
            return
        self.con.executemany(
            "DELETE FROM note_subjects WHERE note_id = ?",
            [(int(n),) for n in note_ids],
        )
        self.con.commit()


_DB: SubjectsDB | None = None


def _current_db_path() -> str | None:
    if mw is None or mw.col is None:
        return None
    return os.path.join(mw.col.media.dir(), DB_FILENAME)


def db() -> SubjectsDB:
    global _DB
    if _DB is not None:
        return _DB
    path = _current_db_path()
    if path is None:
        raise RuntimeError(
            "study-management-system: cannot open the DB because no "
            "Anki profile is loaded yet."
        )
    _DB = SubjectsDB(path)
    return _DB


def close_db() -> None:
    global _DB
    if _DB is None:
        return
    try:
        _DB.con.close()
    except Exception:
        pass
    _DB = None
