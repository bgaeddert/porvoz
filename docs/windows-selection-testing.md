# Windows selection regression

Verified on Windows on 2026-09-06 using the workspace's Electron 44 and production
Windows input code against a disposable Notepad tab.

The selected fixture was `Porvoz Windows selection test — café 日本語` (40 UTF-16
code units). The test confirmed exact capture, preservation of the editor's text
and selection, and restoration of every original clipboard format and payload.
It then executed the current `porvoz:transcribe` main-process handler, the real
backend client and multipart HTTP server, and the instruction-routing service.
The upstream instruction request contained the exact captured selection and the
selected-text routing instruction. After collapsing the selection, capture
returned empty text and no instruction request was made. All 85 Node tests also
passed on Windows.

This tests real desktop copying and the full request transport with a local model
fixture. It does not test a physical recording hotkey, microphone recording, or
a real cloud model. No actual credentials or audio were used.

## Physical-hotkey regression found afterward

The user's physical test with Meta + Left Ctrl exposed a gap in the initial
test: Windows captured at key-down and injected C while both modifiers remained
held, producing Ctrl+Meta+C. Recording therefore worked while selected context
was empty. Windows now captures at key-up, waits for every modifier to be
released, and rechecks foreground/modifier state immediately before Ctrl+C.

The revised Notepad-to-instruction-request test passed. The automated suite
includes Ctrl+Meta release-order tests and Win32-boundary tests that verify no
input is injected until both modifiers are released. The physical hotkey check
remains separate from those automated tests.

## Repeat the desktop test

Run `scripts/windows-selection-integration.js` with Electron on Windows. Set
`PORVOZ_SELECTION_TEST_STATE` to a temporary JSON path; the helper writes its
loopback control URL and random authorization token there. Open a disposable
editor document, select the desired fixture text, and keep that editor focused.

POST `{ "expected": "the selected fixture text" }` to `/run` on the control
URL with the token in the `authorization` header. A successful JSON response
reports `passed`, `clipboardRestored`, `selectionDelivered`, and
`instructionApplied`. Collapse the selection and repeat with an empty expected
string. POST `/stop` using the same authorization to close the servers and
remove the temporary test database. Close only the disposable editor document.

The helper preserves clipboard contents and sends fixture requests only to
loopback servers; it does not load or change the user's Porvoz settings.
