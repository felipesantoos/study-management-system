import { h } from "../lib/dom.js";
import { invoke, toast } from "../lib/bridge.js";

export async function render(container) {
    const page = h(".smsys-page");
    container.appendChild(page);

    page.appendChild(h(".smsys-page-header", null, h("h1.smsys-page-title", "Unassigned Notes")));

    const statusEl = h("p", "Loading…");
    page.appendChild(statusEl);

    let noteIds = [];
    try {
        noteIds = await invoke("notes.unassigned_ids");
    } catch (e) {
        statusEl.textContent = `Could not load unassigned notes: ${e.message}`;
        return;
    }

    if (noteIds.length === 0) {
        statusEl.textContent = "All notes are assigned.";
        return;
    }

    const n = noteIds.length;
    statusEl.textContent = `${n} note${n === 1 ? "" : "s"} not assigned to any discipline, subject, or topic.`;

    page.appendChild(
        h("button.smsys-btn.smsys-btn-primary",
            {
                onClick: async () => {
                    try {
                        await invoke("anki.open_browser_for_notes", { note_ids: noteIds });
                    } catch (e) {
                        toast(e.message, { error: true });
                    }
                },
            },
            "Open in Browser"
        )
    );
}
