import { h, clear } from "../lib/dom.js";
import { invoke, toast } from "../lib/bridge.js";

function statTile(value, label) {
    return h(".smsys-stat-tile", null,
        h(".smsys-stat-tile-value", String(value)),
        h(".smsys-stat-tile-label", label),
    );
}

function statsPill(due, lrn, newCount) {
    return h(".smsys-subject-stats", null,
        due      > 0 && h("span.smsys-stat.is-due", `${due} due`),
        newCount > 0 && h("span.smsys-stat.is-new", `${newCount} new`),
        lrn      > 0 && h("span.smsys-stat.is-lrn", `${lrn} lrn`),
    );
}

function dueRow(subject, isTop) {
    const color = subject.discipline_color || "var(--smsys-muted)";

    const studyBtn = isTop
        ? h("button.smsys-btn.smsys-btn-primary", {
              style: { flexShrink: "0" },
              onclick: async () => {
                  studyBtn.disabled = true;
                  studyBtn.textContent = "Starting…";
                  try {
                      await invoke("anki.study_subject", { subject_id: subject.id });
                  } catch (e) {
                      toast(e.message || "Could not start study session.", { error: true });
                      studyBtn.disabled = false;
                      studyBtn.textContent = "Start studying";
                  }
              },
          }, "Start studying")
        : null;

    return h(".smsys-due-row" + (isTop ? ".is-top" : ""), null,
        h(".smsys-due-accent", { style: { background: color } }),
        h(".smsys-due-names", null,
            h(".smsys-due-subject", subject.subject_name),
            h(".smsys-due-discipline", subject.discipline_name),
        ),
        statsPill(subject.due, subject.lrn, subject.new),
        studyBtn,
    );
}

export async function render(container) {
    const page = h(".smsys-page");
    container.appendChild(page);

    const refreshBtn = h("button.smsys-btn", { style: { marginLeft: "auto" } }, "↺ Refresh");

    page.appendChild(
        h(".smsys-page-header", null,
            h("h1.smsys-page-title", "Dashboard"),
            refreshBtn,
        )
    );

    // Stat grid — skeleton until data arrives
    page.appendChild(h("p.smsys-section-heading", "Collection overview"));
    const statGrid = h(".smsys-stat-grid", null,
        h(".smsys-stat-tile.is-skeleton"),
        h(".smsys-stat-tile.is-skeleton"),
        h(".smsys-stat-tile.is-skeleton"),
        h(".smsys-stat-tile.is-skeleton"),
        h(".smsys-stat-tile.is-skeleton"),
    );
    page.appendChild(statGrid);

    // Due list — skeleton until data arrives
    page.appendChild(h("p.smsys-section-heading", "Due today"));
    const dueList = h(".smsys-due-list", null,
        h(".smsys-due-row.is-skeleton"),
        h(".smsys-due-row.is-skeleton"),
        h(".smsys-due-row.is-skeleton"),
    );
    page.appendChild(dueList);

    async function loadData() {
        refreshBtn.disabled = true;
        refreshBtn.textContent = "↺ Refreshing…";

        const [overview, dueSubjects] = await Promise.all([
            invoke("stats.overview").catch(() => null),
            invoke("stats.due_by_subject", { limit: 5 }).catch(() => []),
        ]);

        // Populate stat grid
        clear(statGrid);
        if (overview) {
            statGrid.appendChild(statTile(overview.disciplines, "Disciplines"));
            statGrid.appendChild(statTile(overview.subjects, "Subjects"));
            statGrid.appendChild(statTile(overview.topics ?? 0, "Topics"));
            statGrid.appendChild(statTile(overview.assigned_notes, "Assigned notes"));
            statGrid.appendChild(statTile(overview.unassigned_notes, "Unassigned notes"));
        } else {
            statGrid.appendChild(h(".smsys-empty", "Could not load stats."));
        }

        // Populate due list
        clear(dueList);
        if (!dueSubjects || dueSubjects.length === 0) {
            dueList.appendChild(
                h(".smsys-empty", "No cards due right now — all caught up!")
            );
        } else {
            for (let i = 0; i < dueSubjects.length; i++) {
                dueList.appendChild(dueRow(dueSubjects[i], i === 0));
            }
        }

        refreshBtn.disabled = false;
        refreshBtn.textContent = "↺ Refresh";
    }

    refreshBtn.onclick = loadData;
    loadData();
}
