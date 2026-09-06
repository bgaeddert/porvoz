# Linux selection and paste regression

The failure was reproduced on Ubuntu-XPS with Gedit and CopyQ stopped: an
Electron 44 `clipboard.writeText()` changed Gedit's selection count from one to
zero. Chromium's `ClipboardOzone::WritePortableTextRepresentation` explicitly
copies portable clipboard text into PRIMARY. Thus both the selection sentinel
and the eventual paste payload could destroy the GTK selection.

References:

- [Chromium clipboard implementation](https://github.com/chromium/chromium/blob/main/ui/base/clipboard/clipboard_ozone.cc)
- [Electron raw clipboard formats](https://github.com/electron/electron/blob/main/shell/browser/api/electron_api_clipboard_item.cc)
- [CopyQ synchronization ownership guard](https://github.com/hluk/CopyQ/blob/master/src/app/clipboardmonitor.cpp)
- [OpenWhispr selection implementation](https://github.com/OpenWhispr/openwhispr/blob/main/src/helpers/selectionManager.js)

Porvoz uses raw X11 formats for its temporary clipboard text and restoration.
It performs synthetic copy after the recording hotkey is released, waiting for
all modifiers to be up so the target receives plain Ctrl+C. No timing guess or
modifier release/re-press injection is required. The CopyQ ownership marker
excludes temporary writes from clipboard-to-selection synchronization. Paste
also waits for modifiers and verifies the recording window still has focus.

Direct PRIMARY reading was tested and rejected: Chrome retains old PRIMARY
text after its visible selection collapses, including when the owner is still
the same process. The synthetic-copy transaction correctly returns no selection
in that case. Clipboard ownership caches were also removed so subsequent
transactions snapshot the current clipboard even after another Porvoz action
writes to it.

Verified on Ubuntu-XPS on 2026-09-05: all six Gedit capture/replacement cases
passed with CopyQ 6.0.1 synchronization enabled in both directions; the held-Alt
paste check passed separately. Chrome capture, replacement, and collapsed
selection checks passed. The physical recording check below remains separate
from those automated checks.

## Automated desktop regression

This is an actual Gedit document test, not a mocked clipboard test. It uses
AT-SPI only to arrange and inspect a disposable document; the production app does
not depend on AT-SPI. It requires X11, Gedit, Python `pyatspi`, `xdotool`, `xclip`,
and the project's Electron installation. Stop other Porvoz instances while
running it, because their global hooks can react to test modifier events.

Create `/tmp/porvoz-selection-fixture.txt` containing `Before ORIGINAL after`,
then open it with `gedit --standalone --new-window`. Keep that window focused and
run from the repository in the graphical session environment:

```bash
node_modules/electron/dist/electron scripts/linux-selection-integration.js
```

The script imports the production selection reader and `typeText`. It checks:

- Capture waits for Control, Alt, Shift, Super, and combined modifiers to be
  released, then copies without clearing the highlighted selection.
- Unicode output replaces exactly the selection, preserving surrounding text.
- Original plain text and HTML clipboard data are restored.
- A collapsed selection returns no context.
- Paste waits for a held modifier to be released.

With CopyQ already running, also run:

```bash
bash scripts/linux-selection-copyq-check.sh
```

This temporarily enables both synchronization directions and restores the
previous options on exit. The fixture allows CopyQ's queued synchronization to
settle before seeding the clipboard for each case. These tests change the
desktop clipboard and the disposable document; do not run them while using the
desktop for other work.

## Chrome regression

Open `scripts/linux-selection-browser-fixture.html` in a separate Chrome app
window and keep it focused, then run:

```bash
node_modules/electron/dist/electron scripts/linux-selection-browser-check.js
```

The script selects the fixture text using keyboard events, captures and replaces
it through production code, and checks that the collapsed selection returns no
context even though Chrome retains old PRIMARY text.

## Physical recording check

The desktop regression exercises capture and paste directly, without audio or
the recording UI. A complete recording still needs a physical hotkey press:
select a phrase in Gedit, hold the configured recording hotkey, speak an edit,
release, and verify that the result replaces only the phrase. Repeat without a
selection and with a configured non-Control modifier combination. Do the same
in Chrome and Ghostty before claiming a full cross-application recording pass.
