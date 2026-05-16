import { h } from "../lib/dom.js";

export async function render(container) {
    container.appendChild(
        h(".smsys-page", null,
            h("h1.smsys-page-title", "Study Management System"),
            h("p", null,
                "Use the sidebar to navigate. The disciplines view is the first ",
                "component; more will be added over time."
            ),
        )
    );
}
