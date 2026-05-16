from __future__ import annotations

from typing import Any

from aqt.qt import (
    QComboBox,
    QDialog,
    QHBoxLayout,
    QLabel,
    QPushButton,
    Qt,
    QVBoxLayout,
    qconnect,
)
from aqt.utils import showWarning

from .db import db


class AssignDialog(QDialog):
    """Reusable picker for Discipline / Subject / Topic.

    The caller reads `.chosen_kind` ('discipline' | 'subject' | 'topic'),
    `.chosen_id`, and `.cleared` after `exec()` returns `Accepted`.

    A note can be linked at any of the three levels. The user must pick
    at least a discipline; subject and topic are optional and refine the
    placement.
    """

    def __init__(
        self,
        parent: Any,
        *,
        title: str,
        status_html: str,
        initial_kind: str | None = None,
        initial_id: int | None = None,
        allow_clear: bool = True,
    ) -> None:
        super().__init__(parent)
        self.setWindowTitle(title)
        self.resize(440, 280)

        self.chosen_kind: str | None = None
        self.chosen_id: int | None = None
        self.cleared: bool = False

        self._status_label = QLabel(status_html)
        self._status_label.setTextFormat(Qt.TextFormat.RichText)

        self._disc_combo = QComboBox()
        self._subj_combo = QComboBox()
        self._topic_combo = QComboBox()

        self._disc_combo.addItem("<select discipline>", None)
        for d in db().list_disciplines():
            self._disc_combo.addItem(d["name"], d["id"])
        self._subj_combo.addItem("<none — assign at discipline>", None)
        self._topic_combo.addItem("<none — assign at subject>", None)

        qconnect(self._disc_combo.currentIndexChanged, self._refresh_subjects)
        qconnect(self._subj_combo.currentIndexChanged, self._refresh_topics)

        self._preselect(initial_kind, initial_id)

        save_btn = QPushButton("Save")
        cancel_btn = QPushButton("Cancel")
        qconnect(save_btn.clicked, self._on_save)
        qconnect(cancel_btn.clicked, self.reject)

        btns = QHBoxLayout()
        if allow_clear:
            clear_btn = QPushButton("Unassign")
            qconnect(clear_btn.clicked, self._on_clear)
            btns.addWidget(clear_btn)
        btns.addStretch()
        btns.addWidget(cancel_btn)
        btns.addWidget(save_btn)

        layout = QVBoxLayout()
        layout.addWidget(self._status_label)
        layout.addWidget(QLabel("Discipline:"))
        layout.addWidget(self._disc_combo)
        layout.addWidget(QLabel("Subject (optional):"))
        layout.addWidget(self._subj_combo)
        layout.addWidget(QLabel("Topic (optional):"))
        layout.addWidget(self._topic_combo)
        layout.addLayout(btns)
        self.setLayout(layout)

    def _preselect(self, kind: str | None, target_id: int | None) -> None:
        if kind is None or target_id is None:
            return
        discipline_id = subject_id = topic_id = None
        if kind == "discipline":
            discipline_id = target_id
        elif kind == "subject":
            row = db().get_subject(int(target_id))
            if row is not None:
                discipline_id = row["discipline_id"]
                subject_id = row["subject_id"]
        elif kind == "topic":
            row = db().get_topic(int(target_id))
            if row is not None:
                discipline_id = row["discipline_id"]
                subject_id = row["subject_id"]
                topic_id = row["topic_id"]

        if discipline_id is None:
            return
        d_idx = self._disc_combo.findData(discipline_id)
        if d_idx >= 0:
            self._disc_combo.setCurrentIndex(d_idx)
        if subject_id is None:
            return
        s_idx = self._subj_combo.findData(subject_id)
        if s_idx >= 0:
            self._subj_combo.setCurrentIndex(s_idx)
        if topic_id is None:
            return
        t_idx = self._topic_combo.findData(topic_id)
        if t_idx >= 0:
            self._topic_combo.setCurrentIndex(t_idx)

    def _refresh_subjects(self) -> None:
        self._subj_combo.clear()
        self._subj_combo.addItem("<none — assign at discipline>", None)
        d_id = self._disc_combo.currentData()
        if d_id is None:
            self._topic_combo.clear()
            self._topic_combo.addItem("<none — assign at subject>", None)
            return
        for s in db().list_subjects(d_id):
            self._subj_combo.addItem(s["name"], s["id"])

    def _refresh_topics(self) -> None:
        self._topic_combo.clear()
        self._topic_combo.addItem("<none — assign at subject>", None)
        s_id = self._subj_combo.currentData()
        if s_id is None:
            return
        for t in db().list_topics(s_id):
            self._topic_combo.addItem(t["name"], t["id"])

    def _on_save(self) -> None:
        d_id = self._disc_combo.currentData()
        s_id = self._subj_combo.currentData()
        t_id = self._topic_combo.currentData()
        if d_id is None:
            showWarning("Select a discipline (or click Unassign).")
            return
        if t_id is not None:
            self.chosen_kind = "topic"
            self.chosen_id = int(t_id)
        elif s_id is not None:
            self.chosen_kind = "subject"
            self.chosen_id = int(s_id)
        else:
            self.chosen_kind = "discipline"
            self.chosen_id = int(d_id)
        self.cleared = False
        self.accept()

    def _on_clear(self) -> None:
        self.chosen_kind = None
        self.chosen_id = None
        self.cleared = True
        self.accept()
