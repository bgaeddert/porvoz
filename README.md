# Porvoz

Porvoz turns your voice into a deeply customizable control layer for your computer. Dictate into nearly any application, transform rough speech into polished text, trigger reusable workflows with phrases that feel natural to you, and use spoken requests to send keyboard actions wherever your cursor is active.

Instead of forcing you into a fixed vocabulary or workflow, Porvoz adapts to the way you want to speak and work. You choose the transcription and instruction models, create your own instruction prefixes, decide which workflows can use web search or clipboard context, and tune the hotkey, feedback, and behavior to fit your setup. It can be a fast voice keyboard, a collection of specialized assistants, or a powerful hands-free interface for controlling your machine.

## Download and install

The current release is [Porvoz v2.0.0](https://github.com/bgaeddert/porvoz/releases/tag/v2.0.0). Release packages are x64 builds. See the [release history](https://github.com/bgaeddert/porvoz/releases) for version notes and downloads.

### Windows

Download and run the [Windows installer](https://github.com/bgaeddert/porvoz/releases/download/v2.0.0/Porvoz-2.0.0-win-x64.exe). It is an interactive per-user NSIS installer and can create Start Menu and desktop shortcuts.

### Linux

Download the [Linux AppImage](https://github.com/bgaeddert/porvoz/releases/download/v2.0.0/Porvoz-2.0.0-linux-x86_64.AppImage), then make it executable and launch it:

```bash
chmod +x Porvoz-2.0.0-linux-x86_64.AppImage
./Porvoz-2.0.0-linux-x86_64.AppImage
```

The Linux build requires an X11 desktop session for global hotkeys and typing into the active application. Wayland sessions are not currently supported for those desktop-integration features. A Secret Service provider such as GNOME Keyring/libsecret must be available to start the local backend and protect its encryption key. On Ubuntu/Debian, install missing runtime services and libraries with:

```bash
sudo apt install gnome-keyring libsecret-1-0 libgtk-3-0 libnss3 libgbm1 libasound2 libxss1 libxtst6
```

The AppImage does not need to be installed system-wide. The SHA-256 values for both release files are available in [`SHA256SUMS.txt`](https://github.com/bgaeddert/porvoz/releases/download/v2.0.0/SHA256SUMS.txt).

There is no macOS package in the current release.

## First-time setup

Porvoz starts hidden and adds a tray icon. Choose **Open Porvoz** from the tray menu to open Settings; the app continues running in the tray when its windows are closed.

The desktop uses its private local child server by default. To share one backend across machines, open **Settings → Provider & models → Porvoz server**, choose **Remote server**, and enter its URL and admin API key.

1. Open **Settings → Provider & models**.
2. Enter the endpoint's base URL and API key under the active connection profile. To configure another endpoint later, select **New profile** above the form, give it a name, then fill in its own base URL, key, and models — Porvoz keeps every profile's settings separate and switches instantly when you pick a different one from the dropdown. Use **Rename** or **Delete** for any profile except the last one.
3. Select **Load models**. Porvoz reads the endpoint's `/v1/models` catalog for the selected profile.
4. Type or paste a model ID into the **Transcription model** and **Instruction model** fields; each is saved automatically. You can also use the browse button beside either field to search the loaded catalog, choose a model, and save it into that field. Choose the instruction reasoning level (`low`, `medium`, or `high`); it defaults to `low` and applies only to instruction-model requests.

The endpoint must provide the OpenAI-compatible audio transcription and Responses API operations used by the app. **Verify certificate** is enabled by default for every API request. Disable it only for a trusted self-signed endpoint on a network you control.

## Instruction prefixes

Prefixes are reusable voice triggers. A transcript reaches the instruction model when it begins with a prefix in the registry; matching is case-insensitive. Porvoz can recognize a chain of consecutive prefixes from left to right, remove the matched trigger phrases, and apply every matched instruction in order. If no registered prefix matches, the transcription is returned without calling the instruction model.

The **Instruction prefix registry** in Settings shows every entry at the same level with its trigger name and instruction. Select **Edit** to change the name, instruction, access, or remove the prefix. Every saved prefix is active immediately. Use **Refresh prefixes** to load changes made by another desktop connected to the same server. Settings opens **Prefixes & instructions** by default; **Provider & models**, **Keyboard**, and **Sound** have separate pages.

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

Hold **Right Ctrl** anywhere to record by default. Release the key to transcribe and type the result into the application that owns the cursor. Use **Settings → Keyboard → Set hotkey** to choose another key or combination, such as **Ctrl + Shift + F12**; changes take effect immediately.

While a capture is active, the status pill appears near the bottom of the display containing the cursor. It uses short labels for **Recording**, **Transcribing**, **Processing**, and **Placing text**, then briefly shows **Done** or a categorized error. The pill is visual-only: it ignores mouse input and does not become the active typing window.

The main window also provides **Start recording**, which displays the raw transcription and any instruction response directly in the app. If a transcript begins with a registered instruction prefix, Porvoz sends it with the editable instruction prompt and prefix registry to the selected instruction model using the configured reasoning level. Transcripts without a registered prefix bypass the instruction model.

When Search access is enabled for a matched prefix, Porvoz enables the hosted `web_search` tool and appends discovered sources to the result. When Clipboard access is enabled for a matched prefix, the current clipboard is included as untrusted reference context for that request. **Activity** stores the 200 most recent transcript, instruction, and error entries on the selected server. Desktops using the same remote server share that history.

When a typed response needs a keyboard action, the instruction model can return bracketed key notation such as `[Enter]`, `[Control+F]`, or `[Control+Shift+ArrowDown]`. Put modifier names first, separate keys with `+`, and use one notation per action; Porvoz parses the notation and sends the corresponding key press or combination. Linux typing uses X11 for the global hotkey and simulated paste input. macOS is not supported in the current release.

Windows and Linux use one clipboard transaction: Porvoz snapshots the clipboard, writes the response as text, simulates `Ctrl+V` into the target application, waits briefly for the paste to be consumed, and restores the original clipboard contents unless another process changed them during the transaction. Windows captures the top-level foreground window when recording starts and refocuses it before pasting; Linux pastes into the current X11 focus. There is no preflight editability probe, software-KVM block, or per-character typing path.

## Headless server and Docker

Porvoz's provider connections, model choices, prompt, prefixes, inference keys, and activity are owned by one headless server. The desktop either starts that server as a private child process or connects to an independently hosted copy. Both modes use the same API and SQLite database format.

For a Docker deployment, copy `.env.example` to `.env`, replace both placeholder keys, and start Compose:

```bash
docker compose pull
docker compose up -d
```

Compose pulls the published `bgaeddert/porvoz` image from Docker Hub. `PORVOZ_IMAGE_TAG` defaults to `latest`; set it to a release such as `2.0.0` to pin that exact server version. Compose reads `.env` for interpolation and explicitly passes only the declared runtime values into the container. `PORVOZ_ADMIN_KEY` authorizes the settings API and first-party profile routing. `PORVOZ_MASTER_KEY` encrypts upstream provider API keys in the database. The database is kept in the `porvoz-data` volume and survives container replacement.

To build the image from the current source checkout instead, run `docker compose up -d --build`.

The included server speaks plain HTTP. For access beyond a trusted local network, place it behind an HTTPS reverse proxy rather than exposing port 8080 directly to the internet.

The server exposes `GET /v1/models` and `POST /v1/audio/transcriptions` for OpenAI-compatible clients. Each profile receives a visible inference API key. For requests using that key, the server ignores the submitted `model` value and routes to the bound profile. The Porvoz desktop authenticates with the admin key and sends the internal profile ID in `model`. The server returns text only and does not support verbose, timestamp, or subtitle response formats. See [the server API reference](docs/server-api.md) for the complete contract and administrative routes.

## Local data and security

The local child server stores its SQLite database and encrypted server master key in the platform user-data directory. Desktop-only preferences—including local/remote mode, the selected profile for each backend, hotkey, and sound volume—are stored separately. A configured remote admin key is protected with Electron's operating-system-backed credential encryption.

On the first local-server launch, Porvoz imports existing desktop connection profiles, provider keys, models, prompt, and prefixes. Hotkey and sound preferences remain local. The previous settings and credentials files are retained; the old activity archive is not imported. See [server setup and migration](docs/server-setup.md) for data locations, backups, and deployment options.

Upstream provider API keys are encrypted inside the server database and are never returned by the API. Profile inference API keys are intentionally stored as readable values so the admin UI can display and copy them. For Docker, keep `.env` out of source control and back up `PORVOZ_MASTER_KEY` separately from the database; the encrypted provider keys cannot be recovered without it.

Use **Reset to defaults** in Settings to remove every server profile, provider credential, prompt, prefix, inference key, and activity entry, while restoring the desktop capture defaults. On a shared remote server, this resets the configuration for every connected client.

## Development

Requirements: Node.js 22.14.0 or a compatible Node.js 22 release. From the project directory:

```bash
npm install
npm test
npm start
```

Run only the headless server by supplying its required environment variables and starting:

```bash
npm run server
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

GitHub Actions runs the test suite on Windows and Ubuntu. Pushing a version tag builds the Windows NSIS installer and Linux AppImage, publishes the server image to Docker Hub, then attaches both desktop packages and a checksum manifest to a GitHub Release. Docker publishing requires the repository variable `DOCKERHUB_USERNAME` and secret `DOCKERHUB_TOKEN`.

## Attributions

Porvoz uses the [Tabler Icons](https://github.com/tabler/tabler-icons) outline set for interface icons. Icons are kept inline so the app remains self-contained and available offline; the standard is Tabler’s 24×24 viewBox with a 2px stroke.

The capture feedback sounds are the CC0 **Recording Start.mp3** and **Recording Stop.mp3** clips by [AbdrTar on Freesound](https://freesound.org/people/AbdrTar/). The start clip is [sound 519985](https://freesound.org/people/AbdrTar/sounds/519985/), and the stop clip is [sound 519986](https://freesound.org/people/AbdrTar/sounds/519986/). Failed text placement uses the CC0 [Wrong Choice](https://freesound.org/people/unadamlar/sounds/476177/) clip by unadamlar. Their shared playback volume defaults to 30% and can be previewed or adjusted under **Settings → Sound → Recording cues**.
