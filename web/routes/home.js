import { h, clear } from "../lib/dom.js";
import { invoke, toast } from "../lib/bridge.js";
import { emptyState, EMPTY_ICONS } from "../lib/empty-state.js";

// ---- Greeting --------------------------------------------------------------

function timeOfDayLabel(hour) {
    if (hour < 5)  return "Good night";
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
});

function buildGreetingBlock(now) {
    return h(".smsys-greeting", null,
        h(".smsys-greeting-line", null,
            h("h1.smsys-greeting-text", `${timeOfDayLabel(now.getHours())}`),
            h(".smsys-greeting-date", DATE_FMT.format(now)),
        ),
        h(".smsys-greeting-sub", { dataset: { role: "due-summary" } }, " "),
    );
}

// ---- Stat tiles ------------------------------------------------------------

// Accent token per stat-tile variant. Falls back to the brand accent.
const STAT_ACCENT = {
    disciplines: "var(--smsys-disc-blue)",
    subjects:    "var(--smsys-disc-violet)",
    topics:      "var(--smsys-disc-teal)",
    assigned:    "var(--smsys-stat-due)",
};

function statTile(variant, value, label, { sublabel } = {}) {
    const valueEl = h(".smsys-stat-tile-value", { dataset: { target: String(value) } }, String(value));
    return h(".smsys-stat-tile", {
        dataset: { variant },
        style: { "--smsys-stat-accent": STAT_ACCENT[variant] || "var(--smsys-accent)" },
    },
        h(".smsys-stat-tile-accent"),
        valueEl,
        h(".smsys-stat-tile-label", label),
        sublabel ? h(".smsys-stat-tile-sub", sublabel) : null,
    );
}

// Count-up animation: tile values rise from 0 → final over ~400ms via rAF.
// Numeric suffix (e.g. "%") is preserved by reading data-target as the
// final value and re-rendering the formatted string each frame.
function animateCountUp(tile, { duration = 400 } = {}) {
    const valueEl = tile.querySelector(".smsys-stat-tile-value");
    if (!valueEl) return;
    const raw = valueEl.dataset.target ?? valueEl.textContent;
    // Allow "94%" or plain "12"; preserve any trailing non-digit suffix.
    const match = /^(-?\d+(?:\.\d+)?)(.*)$/.exec(String(raw).trim());
    if (!match) return;
    const target = Number(match[1]);
    const suffix = match[2] || "";
    if (!Number.isFinite(target) || target === 0) {
        valueEl.textContent = `0${suffix}`;
        return;
    }
    const start = performance.now();
    valueEl.textContent = `0${suffix}`;
    function tick(now) {
        const t = Math.min(1, (now - start) / duration);
        // ease-out cubic
        const eased = 1 - Math.pow(1 - t, 3);
        const current = Math.round(target * eased);
        valueEl.textContent = `${current}${suffix}`;
        if (t < 1) requestAnimationFrame(tick);
        else valueEl.textContent = `${target}${suffix}`;
    }
    requestAnimationFrame(tick);
}

// ---- Status summary strip --------------------------------------------------

// Match status-picker.js slug order so the strip reads in workflow order.
const STATUS_DISPLAY = [
    { slug: "backlog",     label: "Backlog" },
    { slug: "todo",        label: "To Do" },
    { slug: "in-progress", label: "In Progress" },
    { slug: "blocked",     label: "Blocked" },
    { slug: "done",        label: "Done" },
    { slug: "archived",    label: "Archived" },
];

function buildStatusStrip(counts) {
    const items = STATUS_DISPLAY
        .map(s => ({ ...s, count: counts?.[s.slug] ?? 0 }))
        .filter(s => s.count > 0);
    if (items.length === 0) return null;

    return h(".smsys-status-strip", null,
        items.map((s, i) =>
            h("span.smsys-status-strip-item", null,
                h("span.smsys-status-dot-sm", { "data-status": s.slug, "aria-hidden": "true" }),
                h("span.smsys-status-strip-count", String(s.count)),
                h("span.smsys-status-strip-label", s.label),
                i < items.length - 1
                    ? h("span.smsys-status-strip-sep", { "aria-hidden": "true" }, "·")
                    : null,
            )
        ),
    );
}

// ---- Due list --------------------------------------------------------------

function statIcons(due, lrn, newCount) {
    return h(".smsys-due-stats", null,
        due      > 0 && h("span.smsys-due-stat.is-due", null,
            h("span.smsys-due-stat-num", String(due)),
            h("span.smsys-due-stat-icon", { "aria-label": "due" }, "↩"),
        ),
        newCount > 0 && h("span.smsys-due-stat.is-new", null,
            h("span.smsys-due-stat-num", String(newCount)),
            h("span.smsys-due-stat-icon", { "aria-label": "new" }, "✦"),
        ),
        lrn      > 0 && h("span.smsys-due-stat.is-lrn", null,
            h("span.smsys-due-stat-num", String(lrn)),
            h("span.smsys-due-stat-icon", { "aria-label": "learning" }, "◐"),
        ),
    );
}

function studyTarget(target) {
    if (target.kind === "discipline") {
        return invoke("anki.study_discipline", { discipline_id: target.id });
    }
    return invoke("anki.study_subject", { subject_id: target.id });
}

function dueRow(target, isTop) {
    const color = target.discipline_color || "var(--smsys-muted)";

    const studyBtn = h("button.smsys-btn.smsys-btn-primary.smsys-btn-sm", {
        type: "button",
        onclick: async () => {
            studyBtn.disabled = true;
            const original = studyBtn.textContent;
            studyBtn.textContent = "Starting…";
            try {
                await studyTarget(target);
            } catch (e) {
                toast(e.message || "Could not start study session.", { error: true });
                studyBtn.disabled = false;
                studyBtn.textContent = original;
            }
        },
    }, "▶ Study");

    // Discipline-direct rows have no subject name, so the discipline name
    // takes the primary line and the secondary line is omitted.
    const names = target.kind === "discipline"
        ? h(".smsys-due-names", null,
            h(".smsys-due-subject", target.discipline_name),
        )
        : h(".smsys-due-names", null,
            h(".smsys-due-subject", target.subject_name),
            h(".smsys-due-discipline", target.discipline_name),
        );

    return h(".smsys-due-row" + (isTop ? ".is-top" : ""), null,
        h("span.smsys-due-disc-dot", {
            style: { background: color },
            "aria-hidden": "true",
        }),
        names,
        statIcons(target.due, target.lrn, target.new),
        studyBtn,
    );
}

// ---- Hero CTA --------------------------------------------------------------

function buildHero(now) {
    const startBtn = h("button.smsys-btn.smsys-btn-primary.smsys-hero-cta", {
        type: "button",
        disabled: true,
    }, "▶ Start studying");

    return {
        node: h(".smsys-hero", null,
            buildGreetingBlock(now),
            startBtn,
        ),
        startBtn,
    };
}

// ---- Render ----------------------------------------------------------------

export async function render(container) {
    const page = h(".smsys-page");
    container.appendChild(page);

    const now = new Date();
    const { node: heroNode, startBtn } = buildHero(now);
    page.appendChild(heroNode);

    // Track the top-priority target (subject or discipline) the hero CTA launches.
    let topTarget = null;
    startBtn.onclick = async () => {
        if (!topTarget) return;
        startBtn.disabled = true;
        const original = startBtn.textContent;
        startBtn.textContent = "Starting…";
        try {
            await studyTarget(topTarget);
        } catch (e) {
            toast(e.message || "Could not start study session.", { error: true });
            startBtn.disabled = false;
            startBtn.textContent = original;
        }
    };

    // Collection overview
    page.appendChild(h("h2.smsys-section-heading", "Collection overview"));
    const statGrid = h(".smsys-stat-grid", null,
        h(".smsys-stat-tile.is-skeleton"),
        h(".smsys-stat-tile.is-skeleton"),
        h(".smsys-stat-tile.is-skeleton"),
        h(".smsys-stat-tile.is-skeleton"),
    );
    page.appendChild(statGrid);

    // Status summary strip (rendered only when there's at least one non-zero
    // status). The wrapper is always present so refresh can repopulate it.
    const statusSection = h(".smsys-status-section");
    page.appendChild(statusSection);

    // Due-today section
    const refreshBtn = h("button.smsys-btn.smsys-btn-ghost.smsys-btn-sm", {
        type: "button",
        "aria-label": "Refresh",
    }, "↺ Refresh");

    page.appendChild(
        h(".smsys-section-header", null,
            h("h2.smsys-section-heading", "Due today"),
            refreshBtn,
        )
    );
    const dueList = h(".smsys-due-list", null,
        h(".smsys-due-row.is-skeleton"),
        h(".smsys-due-row.is-skeleton"),
        h(".smsys-due-row.is-skeleton"),
    );
    page.appendChild(dueList);

    let isFirstLoad = true;

    async function loadData() {
        refreshBtn.disabled = true;
        const originalRefresh = refreshBtn.textContent;
        refreshBtn.textContent = "↺ Refreshing…";

        const [overview, dueTargets, statusCounts] = await Promise.all([
            invoke("stats.overview").catch(() => null),
            invoke("stats.due_by_subject", { limit: 5 }).catch(() => []),
            invoke("stats.status_summary").catch(() => null),
        ]);

        // ---- greeting due summary
        const dueSummaryEl = heroNode.querySelector('[data-role="due-summary"]');
        if (overview) {
            const total = (overview.cards_due ?? 0) + (overview.cards_lrn ?? 0);
            if (total > 0) {
                const label = total === 1 ? "card" : "cards";
                dueSummaryEl.textContent = `You have ${total} ${label} due today`;
            } else {
                dueSummaryEl.textContent = "All caught up — nothing due today.";
            }
        } else {
            dueSummaryEl.textContent = "Could not load review counts.";
        }

        // ---- stat grid
        clear(statGrid);
        if (overview) {
            const totalNotes = overview.assigned_notes + overview.unassigned_notes;
            const assignedPct = totalNotes > 0
                ? Math.round((overview.assigned_notes / totalNotes) * 100)
                : 0;

            const tiles = [
                statTile("disciplines", overview.disciplines, "Disciplines"),
                statTile("subjects",    overview.subjects,    "Subjects"),
                statTile("topics",      overview.topics ?? 0, "Topics"),
                statTile("assigned",    `${assignedPct}%`,    "Assigned",
                    { sublabel: `${overview.assigned_notes} of ${totalNotes} notes` }),
            ];
            for (const tile of tiles) statGrid.appendChild(tile);
            if (isFirstLoad) {
                for (const tile of tiles) animateCountUp(tile);
            }
        } else {
            statGrid.appendChild(h(".smsys-empty", "Could not load stats."));
        }

        // ---- status summary strip
        clear(statusSection);
        const strip = buildStatusStrip(statusCounts);
        if (strip) {
            statusSection.appendChild(h("h2.smsys-section-heading", "Study status"));
            statusSection.appendChild(strip);
        }

        // ---- due list
        clear(dueList);
        topTarget = null;
        if (!dueTargets || dueTargets.length === 0) {
            dueList.appendChild(emptyState({
                icon: EMPTY_ICONS.check,
                title: "You're all caught up!",
                sub: "No cards due right now. Come back later or open a discipline to study ahead.",
            }));
            startBtn.disabled = true;
        } else {
            topTarget = dueTargets[0];
            startBtn.disabled = false;
            for (let i = 0; i < dueTargets.length; i++) {
                dueList.appendChild(dueRow(dueTargets[i], i === 0));
            }
        }

        refreshBtn.disabled = false;
        refreshBtn.textContent = originalRefresh;
        isFirstLoad = false;
    }

    refreshBtn.onclick = loadData;
    loadData();
}
