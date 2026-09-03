# Porvoz

Porvoz is a tray-first Electron desktop app for voice transcription and customizable instruction workflows. It records microphone audio, sends it to a configured OpenAI-compatible endpoint, and can type the resulting transcription or instruction response into the application that currently owns the cursor.

The API key stays in the operating system credential store. Porvoz does not start a web server. When it types a response, it temporarily places the text on the system clipboard for a simulated paste and restores the previous clipboard contents when they have not changed externally.

## Iconography

Porvoz uses the [Tabler Icons](https://github.com/tabler/tabler-icons) outline set for interface icons. Icons are kept inline so the app remains self-contained and available offline; the standard is Tabler’s 24×24 viewBox with a 2px stroke.

## Download and install

The current release is [Porvoz v1.3.1](https://github.com/bgaeddert/porvoz/releases/tag/v1.3.1). Release packages are x64 builds.

### What's new in v1.3.1

Prefixes can now be copied as portable JSON and imported into another Porvoz installation. The JSON contains the prefix name, instruction, and access settings, but not the source machine's local registry ID. Imported prefixes are validated, receive a fresh local ID, and get a `duplicate` suffix when their name is already in use. The repository also includes [portable prefix examples](examples.md).

The interface now uses the [Tabler Icons](https://github.com/tabler/tabler-icons) outline set for its actionable and status icons. Icons are embedded inline so the application remains self-contained and available offline.

### What's new in v1.3.0

Instruction prefixes are now ordinary editable entries: rename, update, grant Search or Clipboard access, and remove any prefix, including the packaged defaults. New prefixes can be created manually or drafted from a voice description, with access choices reviewed before saving. Existing installations keep their saved prefix definitions while migrating the packaged instruction prompt to the current key-action and access rules when it was not customized.

Instruction responses can now contain bracketed keyboard actions such as `[Enter]`, `[Control+F]`, and `[Control+Shift+ArrowDown]`; Porvoz sends supported standalone keys and modifier combinations between pasted text segments. Press **Escape** from anywhere to cancel an active recording, request, or text-placement operation. The capture renderer stays available while the main window is showing Settings or Logs, and cancellation restores the clipboard safely.

### What's new in v1.2.1

The Settings model picker now uses a unified searchable combobox: type to filter the loaded catalog, open the contained results list, select a model, and save it into the requested model field. The results list has its own scroll area, model choices are clickable, browse controls stay disabled until models are loaded, and the picker controls use consistent vector icons and accessible focus states.

### What's new in v1.2.0

Porvoz now shows a compact, click-through status pill at the bottom of the active display while it records, transcribes, applies instructions, and places text. It confirms successful placement briefly and keeps concise categorized error feedback visible when an operation fails. The overlay is available while Porvoz is hidden to the system tray and does not take focus away from the application receiving the text.

### What's new in v1.1.2

Linux text placement no longer attempts to read Electron's internal X11 clipboard transport targets, which could cause multi-second delays before a response was pasted. The footer now keeps the app name and current version together on the left across every page.

### What's new in v1.1.1

The Settings model-routing section now includes an instruction reasoning dropdown with `low`, `medium`, and `high` options. It defaults to `low` and applies only to instruction-model requests; transcription requests are unchanged. Existing installations migrate to the new default automatically.

### What's new in v1.1.0

Windows and Linux now use a TypeWhisper-style temporary clipboard transaction for text insertion. Porvoz snapshots the existing clipboard, pastes the response through the target application, and restores the original clipboard when it has not changed externally. The release also adds a failure cue when text placement cannot be completed and removes the previous platform-specific literal typing and strict Windows control eligibility paths.

### Windows

Download and run the [Windows installer](https://github.com/bgaeddert/porvoz/releases/download/v1.3.1/Porvoz-1.3.1-win-x64.exe). It is an interactive per-user NSIS installer and can create Start Menu and desktop shortcuts.

### Linux

Download the [Linux AppImage](https://github.com/bgaeddert/porvoz/releases/download/v1.3.1/Porvoz-1.3.1-linux-x86_64.AppImage), then make it executable and launch it:

```bash
chmod +x Porvoz-1.3.1-linux-x86_64.AppImage
./Porvoz-1.3.1-linux-x86_64.AppImage
```

The Linux build requires an X11 desktop session for global hotkeys and typing into the active application. Wayland sessions are not currently supported for those desktop-integration features. A Secret Service provider such as GNOME Keyring/libsecret must be available to save the API key securely. On Ubuntu/Debian, install missing runtime services and libraries with:

```bash
sudo apt install gnome-keyring libsecret-1-0 libgtk-3-0 libnss3 libgbm1 libasound2 libxss1 libxtst6
```

The AppImage does not need to be installed system-wide. The SHA-256 values for both release files are available in [`SHA256SUMS.txt`](https://github.com/bgaeddert/porvoz/releases/download/v1.3.1/SHA256SUMS.txt).

There is no macOS package in the current release.

## First-time setup

Porvoz starts hidden and adds a tray icon. Choose **Open Porvoz** from the tray menu to open Settings; the app continues running in the tray when its windows are closed.

1. Open **Settings**.
2. Enter the endpoint's base URL and API key.
3. Select **Load models**. Porvoz reads the endpoint's `/v1/models` catalog.
4. Type or paste a model ID into the **Transcription model** and **Instruction model** fields; each is saved automatically. You can also use the browse button beside either field to search the loaded catalog, choose a model, and save it into that field. Choose the instruction reasoning level (`low`, `medium`, or `high`); it defaults to `low` and applies only to instruction-model requests.

The endpoint must provide the OpenAI-compatible audio transcription and Responses API operations used by the app. **Verify certificate** is enabled by default for every API request. Disable it only for a trusted self-signed endpoint on a network you control.

## Instruction prefixes

Prefixes are reusable voice triggers. A transcript reaches the instruction model when it begins with a prefix in the registry; matching is case-insensitive. Porvoz can recognize a chain of consecutive prefixes from left to right, remove the matched trigger phrases, and apply every matched instruction in order. If no registered prefix matches, the transcription is returned without calling the instruction model.

The **Instruction prefix registry** in Settings shows every entry at the same level with its trigger name and instruction. Select **Edit** to change the name, instruction, access, or remove the prefix. Every saved prefix is active immediately.

Each prefix row also has a **Copy** button. It puts a portable JSON version of that prefix on the system clipboard without its local registry ID. Select **Import from clipboard** to read and add it; imported prefixes are validated before saving, receive a fresh local ID, and a name collision gets a `duplicate` suffix automatically. The repository's ready-to-copy examples are in [examples.md](examples.md).

Porvoz loads these five ordinary prefix entries by default when no settings have been saved:

- **digits** — Extracts every number from the transcript, converts number words to numerals when needed, concatenates the results, and returns digits only.
- **one word** — Responds with exactly one word, without punctuation or explanation.
- **letters** — Combines spoken letters into a compact string. It can also insert a space, dash, dot, or exclamation point when that is spoken explicitly.
- **search** — Uses web search to find and verify an answer, then responds concisely. Search access is enabled by default for this prefix.
- **clipboard** — Applies the spoken request to the current text clipboard as reference context. Clipboard access is enabled by default for this prefix; clipboard contents are treated as untrusted data and are not replaced.

All five packaged entries are active after first-run setup or a full reset, and are ordinary editable prefixes.

### Add your own prefix

Select **Add prefix** in the registry and choose one of two paths:

- **Add a prefix manually** opens a blank editor. Enter a unique trigger name and the instruction the model should follow, choose any access it needs, then save it. The prefix becomes active immediately and remains fully editable.
- **Create a new prefix with your voice** lets you describe the trigger and desired result aloud. Select **Start listening**, speak the request, then select **Stop and create**. Porvoz sends the recording to the configured transcription and instruction models to draft a name and instruction using your prompt and existing registry. Review and edit the proposed prefix, then select **Add prefix** to save it; nothing is saved until you approve the preview.

Prefix names must be unique, ignoring case. Use **Remove prefix** to delete any entry. Each prefix row has independent **Search access** and **Clipboard access** controls. When prefixes are chained, either capability is available only when at least one matched prefix grants it.

## Using Porvoz

Hold **Right Ctrl** anywhere to record by default. Release the key to transcribe and type the result into the application that owns the cursor. Use **Capture hotkey** in Settings to choose another key or combination, such as **Ctrl + Shift + F12**; changes take effect immediately.

While a capture is active, the status pill appears near the bottom of the display containing the cursor. It uses short labels for **Recording**, **Transcribing**, **Processing**, and **Placing text**, then briefly shows **Done** or a categorized error. The pill is visual-only: it ignores mouse input and does not become the active typing window.

The main window also provides **Start recording**, which displays the raw transcription and any instruction response directly in the app. If a transcript begins with a registered instruction prefix, Porvoz sends it with the editable instruction prompt and prefix registry to the selected instruction model using the configured reasoning level. Transcripts without a registered prefix bypass the instruction model.

When Search access is enabled for a matched prefix, Porvoz enables the hosted `web_search` tool and appends discovered sources to the result. When Clipboard access is enabled for a matched prefix, the current clipboard is included as untrusted reference context for that request. **Logs** stores the 200 most recent transcript and instruction entries on this device.

When a typed response needs a keyboard action, the instruction model can return bracketed key notation such as `[Enter]`, `[Control+F]`, or `[Control+Shift+ArrowDown]`. Put modifier names first, separate keys with `+`, and use one notation per action; Porvoz parses the notation and sends the corresponding key press or combination. Linux typing uses X11 for the global hotkey and simulated paste input. macOS is not supported in the current release.

Windows and Linux use one clipboard transaction: Porvoz snapshots the clipboard, writes the response as text, simulates `Ctrl+V` into the target application, waits briefly for the paste to be consumed, and restores the original clipboard contents unless another process changed them during the transaction. Windows captures the top-level foreground window when recording starts and refocuses it before pasting; Linux pastes into the current X11 focus. There is no preflight editability probe, software-KVM block, or per-character typing path.

## Local data and security

Non-secret settings are stored in the platform user-data directory as `settings.json`. The API key is encrypted in a separate credential file using the operating system's secure credential facility. The packaged `electron/defaults.json` contains only first-run defaults and never contains an API key.

Use **Reset to defaults** in Settings to remove the saved API key and editable settings, then rebuild from the packaged defaults.

## Development

Requirements: Node.js 22.14.0 or a compatible Node.js 22 release. From the project directory:

```bash
npm install
npm test
npm start
```

To build locally, run the target command on its native operating system:

```bash
npm run package:win    # Windows x64 NSIS installer
npm run package:linux  # Linux x64 AppImage
```

Linux development and packaging also require native build headers and Electron runtime libraries. On Ubuntu/Debian:

```bash
sudo apt install build-essential libasound2-dev libgbm-dev libgtk-3-dev libnss3-dev \
  libx11-dev libxext-dev libxi-dev libxinerama-dev libxkbcommon-dev \
  libxkbcommon-x11-dev libxrandr-dev libxt-dev libxtst-dev
```

GitHub Actions runs the test suite on Windows and Ubuntu. Pushing a tag beginning with `v` builds the Windows NSIS installer and Linux AppImage, then attaches both files and a checksum manifest to a GitHub Release.

The capture feedback sounds are the CC0 **Recording Start.mp3** and **Recording Stop.mp3** clips by [AbdrTar on Freesound](https://freesound.org/people/AbdrTar/). The start clip is [sound 519985](https://freesound.org/people/AbdrTar/sounds/519985/), and the stop clip is [sound 519986](https://freesound.org/people/AbdrTar/sounds/519986/). Failed text placement uses the CC0 [Wrong Choice](https://freesound.org/people/unadamlar/sounds/476177/) clip by unadamlar. Their shared playback volume defaults to 30% and can be adjusted under **Settings → Desktop capture → Recording cues**.
