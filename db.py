from __future__ import annotations

import os
import sqlite3
from typing import Sequence

from aqt import mw


# Files in collection.media/ whose names start with `_` are exempt from
# Tools → Check Media's unused-files sweep, and the whole folder rides
# along on AnkiWeb media sync.
DB_FILENAME = "_study_management_system.db"


ASSIGNMENT_KINDS = ("discipline", "subject", "topic")

STUDY_STATUSES = (
    "backlog",
    "todo",
    "in-progress",
    "blocked",
    "done",
    "archived",
)


def _validate_kind(kind: str) -> str:
    if kind not in ASSIGNMENT_KINDS:
        raise ValueError(f"Unknown assignment kind: {kind!r}")
    return kind


def _validate_status(status: str) -> str:
    if status not in STUDY_STATUSES:
        raise ValueError(f"Unknown study status: {status!r}")
    return status


_NODE_KIND_TO_TABLE = {
    "discipline": "disciplines",
    "subject": "subjects",
    "topic": "topics",
}


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
                id           INTEGER PRIMARY KEY,
                name         TEXT NOT NULL UNIQUE,
                study_status TEXT NOT NULL DEFAULT 'backlog'
            );
            CREATE TABLE IF NOT EXISTS subjects (
                id            INTEGER PRIMARY KEY,
                discipline_id INTEGER NOT NULL
                    REFERENCES disciplines(id) ON DELETE CASCADE,
                name          TEXT NOT NULL,
                study_status  TEXT NOT NULL DEFAULT 'backlog',
                UNIQUE(discipline_id, name)
            );
            CREATE TABLE IF NOT EXISTS topics (
                id           INTEGER PRIMARY KEY,
                subject_id   INTEGER NOT NULL
                    REFERENCES subjects(id) ON DELETE CASCADE,
                name         TEXT NOT NULL,
                position     INTEGER NOT NULL DEFAULT 0,
                study_status TEXT NOT NULL DEFAULT 'backlog',
                UNIQUE(subject_id, name)
            );
            CREATE INDEX IF NOT EXISTS idx_topics_subject_id
                ON topics(subject_id);
            CREATE TABLE IF NOT EXISTS note_assignments (
                note_id       INTEGER PRIMARY KEY,
                discipline_id INTEGER REFERENCES disciplines(id) ON DELETE CASCADE,
                subject_id    INTEGER REFERENCES subjects(id)    ON DELETE CASCADE,
                topic_id      INTEGER REFERENCES topics(id)      ON DELETE CASCADE,
                CHECK (
                    (CASE WHEN discipline_id IS NULL THEN 0 ELSE 1 END)
                  + (CASE WHEN subject_id    IS NULL THEN 0 ELSE 1 END)
                  + (CASE WHEN topic_id      IS NULL THEN 0 ELSE 1 END) = 1
                )
            );
            CREATE INDEX IF NOT EXISTS idx_note_assignments_discipline_id
                ON note_assignments(discipline_id);
            CREATE INDEX IF NOT EXISTS idx_note_assignments_subject_id
                ON note_assignments(subject_id);
            CREATE INDEX IF NOT EXISTS idx_note_assignments_topic_id
                ON note_assignments(topic_id);
            """
        )
        self.con.commit()

        disc_cols = {row[1] for row in self.con.execute("PRAGMA table_info(disciplines)")}
        if "color" not in disc_cols:
            self.con.execute("ALTER TABLE disciplines ADD COLUMN color TEXT")
        if "position" not in disc_cols:
            self.con.execute(
                "ALTER TABLE disciplines ADD COLUMN position INTEGER NOT NULL DEFAULT 0"
            )
            rows = self.con.execute(
                "SELECT id FROM disciplines ORDER BY name"
            ).fetchall()
            for i, row in enumerate(rows):
                self.con.execute(
                    "UPDATE disciplines SET position = ? WHERE id = ?", (i, row[0])
                )
        if "study_status" not in disc_cols:
            self.con.execute(
                "ALTER TABLE disciplines ADD COLUMN study_status TEXT "
                "NOT NULL DEFAULT 'backlog'"
            )
        subj_cols = {row[1] for row in self.con.execute("PRAGMA table_info(subjects)")}
        if "position" not in subj_cols:
            self.con.execute(
                "ALTER TABLE subjects ADD COLUMN position INTEGER NOT NULL DEFAULT 0"
            )
            disc_ids = [
                r[0] for r in self.con.execute("SELECT id FROM disciplines")
            ]
            for did in disc_ids:
                rows = self.con.execute(
                    "SELECT id FROM subjects WHERE discipline_id = ? ORDER BY name",
                    (did,),
                ).fetchall()
                for i, row in enumerate(rows):
                    self.con.execute(
                        "UPDATE subjects SET position = ? WHERE id = ?", (i, row[0])
                    )
        if "study_status" not in subj_cols:
            self.con.execute(
                "ALTER TABLE subjects ADD COLUMN study_status TEXT "
                "NOT NULL DEFAULT 'backlog'"
            )
        topic_cols = {row[1] for row in self.con.execute("PRAGMA table_info(topics)")}
        if "study_status" not in topic_cols:
            self.con.execute(
                "ALTER TABLE topics ADD COLUMN study_status TEXT "
                "NOT NULL DEFAULT 'backlog'"
            )
        self.con.commit()

        table_names = {
            row[0]
            for row in self.con.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        if "note_subjects" in table_names:
            self.con.execute(
                """
                INSERT OR IGNORE INTO note_assignments (note_id, subject_id)
                SELECT note_id, subject_id FROM note_subjects
                """
            )
            self.con.execute("DROP TABLE note_subjects")
            self.con.commit()

    # ----- disciplines -----------------------------------------------

    def list_disciplines(self) -> list[sqlite3.Row]:
        return list(
            self.con.execute(
                """
                SELECT d.id, d.name, d.color, d.position, d.study_status,
                       (SELECT COUNT(*) FROM note_assignments
                          WHERE discipline_id = d.id)
                     + (SELECT COUNT(*) FROM note_assignments na
                          JOIN subjects s ON s.id = na.subject_id
                         WHERE s.discipline_id = d.id)
                     + (SELECT COUNT(*) FROM note_assignments na
                          JOIN topics t ON t.id = na.topic_id
                          JOIN subjects s ON s.id = t.subject_id
                         WHERE s.discipline_id = d.id) AS note_count
                  FROM disciplines d
                 ORDER BY d.position, d.name
                """
            )
        )

    def set_discipline_color(self, discipline_id: int, color: str | None) -> None:
        self.con.execute(
            "UPDATE disciplines SET color = ? WHERE id = ?",
            (color, discipline_id),
        )
        self.con.commit()

    def add_discipline(self, name: str) -> int:
        max_pos = self.con.execute(
            "SELECT COALESCE(MAX(position), -1) FROM disciplines"
        ).fetchone()[0]
        cur = self.con.execute(
            "INSERT INTO disciplines (name, position) VALUES (?, ?)",
            (name, max_pos + 1),
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

    def reorder_disciplines(self, ordered_ids: list[int]) -> None:
        for i, discipline_id in enumerate(ordered_ids):
            self.con.execute(
                "UPDATE disciplines SET position = ? WHERE id = ?",
                (i, discipline_id),
            )
        self.con.commit()

    def get_discipline(self, discipline_id: int) -> sqlite3.Row | None:
        return self.con.execute(
            "SELECT id, name, color, position, study_status "
            "FROM disciplines WHERE id = ?",
            (discipline_id,),
        ).fetchone()

    # ----- subjects --------------------------------------------------

    def list_subjects(self, discipline_id: int) -> list[sqlite3.Row]:
        # `note_count` aggregates: notes directly on the subject + notes on
        # any topic under it. That matches the "Subject owns its topics"
        # rollup the UI wants to show.
        return list(
            self.con.execute(
                """
                SELECT s.id, s.name, s.position, s.study_status,
                       (SELECT COUNT(*) FROM note_assignments
                          WHERE subject_id = s.id)
                     + (SELECT COUNT(*) FROM note_assignments na
                          JOIN topics t ON t.id = na.topic_id
                          WHERE t.subject_id = s.id) AS note_count,
                       (SELECT COUNT(*) FROM topics
                          WHERE subject_id = s.id) AS topic_count
                  FROM subjects s
                 WHERE s.discipline_id = ?
                 ORDER BY s.position, s.name
                """,
                (discipline_id,),
            )
        )

    def add_subject(self, discipline_id: int, name: str) -> int:
        max_pos = self.con.execute(
            "SELECT COALESCE(MAX(position), -1) FROM subjects WHERE discipline_id = ?",
            (discipline_id,),
        ).fetchone()[0]
        cur = self.con.execute(
            "INSERT INTO subjects (discipline_id, name, position) VALUES (?, ?, ?)",
            (discipline_id, name, max_pos + 1),
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

    def reorder_subjects(self, discipline_id: int, ordered_ids: list[int]) -> None:
        for i, subject_id in enumerate(ordered_ids):
            self.con.execute(
                "UPDATE subjects SET position = ? WHERE id = ?",
                (i, subject_id),
            )
        self.con.commit()

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

    # ----- topics ----------------------------------------------------

    def list_topics(self, subject_id: int) -> list[sqlite3.Row]:
        return list(
            self.con.execute(
                """
                SELECT t.id, t.name, t.position, t.study_status,
                       COUNT(na.note_id) AS note_count
                  FROM topics t
                  LEFT JOIN note_assignments na ON na.topic_id = t.id
                 WHERE t.subject_id = ?
                 GROUP BY t.id, t.name, t.position, t.study_status
                 ORDER BY t.position, t.name
                """,
                (subject_id,),
            )
        )

    def add_topic(self, subject_id: int, name: str) -> int:
        max_pos = self.con.execute(
            "SELECT COALESCE(MAX(position), -1) FROM topics WHERE subject_id = ?",
            (subject_id,),
        ).fetchone()[0]
        cur = self.con.execute(
            "INSERT INTO topics (subject_id, name, position) VALUES (?, ?, ?)",
            (subject_id, name, max_pos + 1),
        )
        self.con.commit()
        return cur.lastrowid

    def rename_topic(self, topic_id: int, name: str) -> None:
        self.con.execute(
            "UPDATE topics SET name = ? WHERE id = ?", (name, topic_id)
        )
        self.con.commit()

    def delete_topic(self, topic_id: int) -> None:
        self.con.execute("DELETE FROM topics WHERE id = ?", (topic_id,))
        self.con.commit()

    def reorder_topics(self, subject_id: int, ordered_ids: list[int]) -> None:
        for i, topic_id in enumerate(ordered_ids):
            self.con.execute(
                "UPDATE topics SET position = ? WHERE id = ?",
                (i, topic_id),
            )
        self.con.commit()

    def get_topic(self, topic_id: int) -> sqlite3.Row | None:
        return self.con.execute(
            """
            SELECT t.id AS topic_id, t.name AS topic_name,
                   s.id AS subject_id, s.name AS subject_name,
                   d.id AS discipline_id, d.name AS discipline_name
              FROM topics t
              JOIN subjects s    ON s.id = t.subject_id
              JOIN disciplines d ON d.id = s.discipline_id
             WHERE t.id = ?
            """,
            (topic_id,),
        ).fetchone()

    # ----- node study status ----------------------------------------

    def set_node_status(
        self, node_kind: str, node_id: int, status: str
    ) -> sqlite3.Row | None:
        """Persist `study_status` for a discipline / subject / topic and
        return the updated row (id, study_status)."""
        if node_kind not in _NODE_KIND_TO_TABLE:
            raise ValueError(f"Unknown node kind: {node_kind!r}")
        _validate_status(status)
        table = _NODE_KIND_TO_TABLE[node_kind]
        self.con.execute(
            f"UPDATE {table} SET study_status = ? WHERE id = ?",
            (status, int(node_id)),
        )
        self.con.commit()
        return self.con.execute(
            f"SELECT id, study_status FROM {table} WHERE id = ?",
            (int(node_id),),
        ).fetchone()

    # ----- note assignments -----------------------------------------

    def assign_note(
        self,
        note_id: int,
        target_kind: str | None,
        target_id: int | None,
    ) -> None:
        if target_kind is None or target_id is None:
            self.con.execute(
                "DELETE FROM note_assignments WHERE note_id = ?", (note_id,)
            )
            self.con.commit()
            return
        _validate_kind(target_kind)
        cols = {"discipline_id": None, "subject_id": None, "topic_id": None}
        cols[f"{target_kind}_id"] = int(target_id)
        self.con.execute(
            """
            INSERT INTO note_assignments
                   (note_id, discipline_id, subject_id, topic_id)
            VALUES (?, ?, ?, ?)
              ON CONFLICT(note_id)
              DO UPDATE SET
                  discipline_id = excluded.discipline_id,
                  subject_id    = excluded.subject_id,
                  topic_id      = excluded.topic_id
            """,
            (
                note_id,
                cols["discipline_id"],
                cols["subject_id"],
                cols["topic_id"],
            ),
        )
        self.con.commit()

    def bulk_assign(
        self,
        note_ids: Sequence[int],
        target_kind: str | None,
        target_id: int | None,
    ) -> None:
        if not note_ids:
            return
        if target_kind is None or target_id is None:
            self.con.executemany(
                "DELETE FROM note_assignments WHERE note_id = ?",
                [(int(n),) for n in note_ids],
            )
            self.con.commit()
            return
        _validate_kind(target_kind)
        d_id = int(target_id) if target_kind == "discipline" else None
        s_id = int(target_id) if target_kind == "subject" else None
        t_id = int(target_id) if target_kind == "topic" else None
        self.con.executemany(
            """
            INSERT INTO note_assignments
                   (note_id, discipline_id, subject_id, topic_id)
            VALUES (?, ?, ?, ?)
              ON CONFLICT(note_id)
              DO UPDATE SET
                  discipline_id = excluded.discipline_id,
                  subject_id    = excluded.subject_id,
                  topic_id      = excluded.topic_id
            """,
            [(int(n), d_id, s_id, t_id) for n in note_ids],
        )
        self.con.commit()

    def get_all_note_assignments(self) -> list[sqlite3.Row]:
        """Return every assigned note with fully resolved name chains."""
        return list(
            self.con.execute(
                """
                SELECT na.note_id,
                       na.discipline_id AS direct_discipline_id,
                       na.subject_id    AS direct_subject_id,
                       na.topic_id      AS direct_topic_id,
                       COALESCE(d.id, sd.id, td.id) AS discipline_id,
                       COALESCE(d.name, sd.name, td.name) AS discipline_name,
                       COALESCE(s.id, ts.id) AS subject_id,
                       COALESCE(s.name, ts.name) AS subject_name,
                       t.id   AS topic_id,
                       t.name AS topic_name
                  FROM note_assignments na
                  LEFT JOIN disciplines d  ON d.id  = na.discipline_id
                  LEFT JOIN subjects    s  ON s.id  = na.subject_id
                  LEFT JOIN disciplines sd ON sd.id = s.discipline_id
                  LEFT JOIN topics      t  ON t.id  = na.topic_id
                  LEFT JOIN subjects    ts ON ts.id = t.subject_id
                  LEFT JOIN disciplines td ON td.id = ts.discipline_id
                """
            )
        )

    def get_note_assignment(self, note_id: int) -> sqlite3.Row | None:
        """Return the note's current placement plus the resolved chain of
        names. Exactly one of (topic_id, subject_id, discipline_id) is
        non-null in the row, but the chain (discipline_name, subject_name,
        topic_name) is filled in as far up as the placement reaches."""
        return self.con.execute(
            """
            SELECT na.note_id,
                   na.discipline_id AS direct_discipline_id,
                   na.subject_id    AS direct_subject_id,
                   na.topic_id      AS direct_topic_id,
                   COALESCE(d.id, sd.id, td.id) AS discipline_id,
                   COALESCE(d.name, sd.name, td.name) AS discipline_name,
                   COALESCE(s.id, ts.id) AS subject_id,
                   COALESCE(s.name, ts.name) AS subject_name,
                   t.id   AS topic_id,
                   t.name AS topic_name
              FROM note_assignments na
              LEFT JOIN disciplines d  ON d.id  = na.discipline_id
              LEFT JOIN subjects    s  ON s.id  = na.subject_id
              LEFT JOIN disciplines sd ON sd.id = s.discipline_id
              LEFT JOIN topics      t  ON t.id  = na.topic_id
              LEFT JOIN subjects    ts ON ts.id = t.subject_id
              LEFT JOIN disciplines td ON td.id = ts.discipline_id
             WHERE na.note_id = ?
            """,
            (note_id,),
        ).fetchone()

    # ----- note lookups ---------------------------------------------

    def note_ids_for_topic(self, topic_id: int) -> list[int]:
        return [
            row[0]
            for row in self.con.execute(
                "SELECT note_id FROM note_assignments WHERE topic_id = ?",
                (topic_id,),
            )
        ]

    def note_ids_for_subject(
        self, subject_id: int, *, include_descendants: bool = True
    ) -> list[int]:
        if not include_descendants:
            return [
                row[0]
                for row in self.con.execute(
                    "SELECT note_id FROM note_assignments WHERE subject_id = ?",
                    (subject_id,),
                )
            ]
        return [
            row[0]
            for row in self.con.execute(
                """
                SELECT note_id FROM note_assignments WHERE subject_id = ?
                UNION
                SELECT na.note_id
                  FROM note_assignments na
                  JOIN topics t ON t.id = na.topic_id
                 WHERE t.subject_id = ?
                """,
                (subject_id, subject_id),
            )
        ]

    def note_ids_for_discipline(
        self, discipline_id: int, *, include_descendants: bool = True
    ) -> list[int]:
        if not include_descendants:
            return [
                row[0]
                for row in self.con.execute(
                    "SELECT note_id FROM note_assignments WHERE discipline_id = ?",
                    (discipline_id,),
                )
            ]
        return [
            row[0]
            for row in self.con.execute(
                """
                SELECT note_id FROM note_assignments WHERE discipline_id = ?
                UNION
                SELECT na.note_id
                  FROM note_assignments na
                  JOIN subjects s ON s.id = na.subject_id
                 WHERE s.discipline_id = ?
                UNION
                SELECT na.note_id
                  FROM note_assignments na
                  JOIN topics t    ON t.id = na.topic_id
                  JOIN subjects s2 ON s2.id = t.subject_id
                 WHERE s2.discipline_id = ?
                """,
                (discipline_id, discipline_id, discipline_id),
            )
        ]

    def assigned_note_ids(self) -> set[int]:
        return {
            row[0]
            for row in self.con.execute("SELECT note_id FROM note_assignments")
        }

    def delete_note_assignments(self, note_ids: Sequence[int]) -> None:
        if not note_ids:
            return
        self.con.executemany(
            "DELETE FROM note_assignments WHERE note_id = ?",
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
