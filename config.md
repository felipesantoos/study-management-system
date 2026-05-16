# Study Management System — Addon Configuration

## sync_anki_tags (default: `false`)

Mirror each note's placement in the Study-Management-System hierarchy as an
Anki tag.  Off by default.  Enable it by setting `sync_anki_tags` to `true`
in the addon config editor (Tools → Add-ons → Study Management System →
Config).  The change takes effect immediately — no Anki restart needed.

### Tag format

Tags use Anki's native `::` hierarchy convention with the `smsys::` namespace
prefix.  The depth matches the note's direct placement:

| Placement | Tag written |
|---|---|
| Discipline only | `smsys::<Discipline>` |
| Subject (direct) | `smsys::<Discipline>::<Subject>` |
| Topic (direct) | `smsys::<Discipline>::<Subject>::<Topic>` |

Name sanitisation applied to each component:

- Whitespace runs → `_`
- `::` inside a name → `__` (prevents hijacking Anki's hierarchy separator)
- Leading / trailing whitespace stripped

Anki's tag tree auto-groups by `::`, so a topic-level tag also appears under
its parent discipline and subject in the tag browser — no extra ancestor tags
are needed.

### Toggling off is non-destructive

When you set `sync_anki_tags` back to `false`, the addon stops writing or
removing `smsys::` tags.  Existing tags are **left in place**.  This is
deliberate: you may have Anki searches, filtered decks, or AnkiWeb exports
that depend on those tags.  If you want to remove all `smsys::` tags, do so
manually via the Anki tag browser.

### Conflict warning

If you already use `smsys::` tags for another purpose, enabling this feature
will overwrite them on reassignment.  The `smsys::` prefix is specific to this
addon; rename your existing tags before enabling if there is a clash.
