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
    """A reusable subject-picker. Caller reads `.chosen_subject_id` and
    `.cleared` after `exec()` returns `Accepted`."""

    def __init__(
        self,
        parent: Any,
        *,
        title: str,
        status_html: str,
        initial_subject_id: int | None = None,
        allow_clear: bool = True,
    ) -> None:
        super().__init__(parent)
        self.setWindowTitle(title)
        self.resize(420, 220)

        self.chosen_subject_id: int | None = None
        self.cleared: bool = False

        self._status_label = QLabel(status_html)
        self._status_label.setTextFormat(Qt.TextFormat.RichText)

        self._disc_combo = QComboBox()
        self._subj_combo = QComboBox()
        self._disc_combo.addItem("<select discipline>", None)
        for d in db().list_disciplines():
            self._disc_combo.addItem(d["name"], d["id"])
        qconnect(self._disc_combo.currentIndexChanged, self._refresh_subjects)

        if initial_subject_id is not None:
            row = db().get_subject(initial_subject_id)
            if row is not None:
                d_idx = self._disc_combo.findData(row["discipline_id"])
                if d_idx >= 0:
                    self._disc_combo.setCurrentIndex(d_idx)
                    s_idx = self._subj_combo.findData(row["subject_id"])
                    if s_idx >= 0:
                        self._subj_combo.setCurrentIndex(s_idx)

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
        layout.addWidget(QLabel("Subject:"))
        layout.addWidget(self._subj_combo)
        layout.addLayout(btns)
        self.setLayout(layout)

    def _refresh_subjects(self) -> None:
        self._subj_combo.clear()
        d_id = self._disc_combo.currentData()
        if d_id is None:
            return
        for s in db().list_subjects(d_id):
            self._subj_combo.addItem(s["name"], s["id"])

    def _on_save(self) -> None:
        s_id = self._subj_combo.currentData()
        if s_id is None:
            showWarning("Select a subject (or click Unassign).")
            return
        self.chosen_subject_id = s_id
        self.cleared = False
        self.accept()

    def _on_clear(self) -> None:
        self.chosen_subject_id = None
        self.cleared = True
        self.accept()
