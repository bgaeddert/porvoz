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
all modifiers to be up so ordinary applications receive Ctrl+C. Recognized
standalone terminals are skipped by default; enabling Console selection in
Keyboard settings allows Ctrl+Shift+C. Porvoz waits for the physical modifiers
to be released instead of releasing and re-pressing them. The CopyQ ownership marker
excludes temporary writes from clipboard-to-selection synchronization. Paste
also waits for modifiers and verifies the recording window still has focus.
Recognized terminals receive Ctrl+Shift+V for paste; other applications receive
Ctrl+V. Terminal Copy and Paste events are spaced by 25 ms at the X server so
the receiving toolkit can process the modifier changes around the letter key.
This fixes Ghostty forwarding the instant shortcut as terminal escape sequences.

Terminal detection reads the X11 `WM_CLASS` instance and class through
`XGetClassHint`; it does not use accessibility APIs. Both platforms share the
known-terminal identity list. An empty terminal copy returns no selected
context without retrying Ctrl+C. Unknown terminals and embedded editor
terminals may still receive Ctrl+C. Native Wayland selection capture is not
added by this change.

The Console selection toggle affects only selection copying in recognized
terminals. When off, no clipboard transaction or Copy keystroke is attempted
there. When on, the prior copy path is retained. The warning explains that an
empty selection can let the shortcut reach a CLI as Control-C and interrupt it.
Paste and ordinary-editor selection copying do not depend on this toggle.

The terminal shortcut branches, event delays, default-off behavior, and
focus-change guard are covered by mocked X11 input-boundary tests. Native class
lookup was checked in the Ubuntu X11 session. For the 2.3.0 release, the user
manually confirmed working dictation in Gedit, GNOME Terminal, and Ghostty after
the terminal paste shortcut and event timing fixes. These results cover those
tested desktop configurations, not every identity in the shared terminal list.

For future terminal regression checks, leave Console selection off and confirm
dictation pastes while a disposable CLI remains running. Then enable it and
check selection capture using the terminal's actual keybindings. With nothing
selected, the warning still applies: the terminal may forward Copy to the CLI.
Check ordinary editor selection capture as well. The earlier editor-specific
desktop results below predate the terminal changes.

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
