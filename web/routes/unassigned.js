import { h, clear } from "../lib/dom.js";
import { invoke, toast } from "../lib/bridge.js";
import { emptyState, EMPTY_ICONS } from "../lib/empty-state.js";

export async function render(container) {
    const page = h(".smsys-page");
    container.appendChild(page);

    page.appendChild(h(".smsys-page-header", null, h("h1.smsys-page-title", "Unassigned Notes")));

    const body = h("div");
    body.appendChild(h("p", "Loading…"));
    page.appendChild(body);

    let noteIds = [];
    try {
        noteIds = await invoke("notes.unassigned_ids");
    } catch (e) {
        clear(body);
        body.appendChild(
            h("p.smsys-empty", `Could not load unassigned notes: ${e.message}`)
        );
        return;
    }

    clear(body);

    if (noteIds.length === 0) {
        body.appendChild(emptyState({
            icon: EMPTY_ICONS.check,
            title: "All notes are assigned",
            sub: "Every note is placed under a discipline, subject, or topic. Nothing left to triage.",
        }));
        return;
    }

    const n = noteIds.length;
    body.appendChild(emptyState({
        icon: EMPTY_ICONS.inbox,
        title: `${n} unassigned note${n === 1 ? "" : "s"}`,
        sub: `${n === 1 ? "1 note is" : `${n} notes are`} not assigned to any discipline, subject, or topic yet. Open them in Browser to triage.`,
        cta: {
            label: "Open in Browser",
            onClick: async () => {
                try {
                    await invoke("anki.open_browser_for_notes", { note_ids: noteIds });
                } catch (e) {
                    toast(e.message, { type: "error" });
                }
            },
        },
    }));
}
