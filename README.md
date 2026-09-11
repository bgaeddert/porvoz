# Porvoz

Porvoz turns your voice into a deeply customizable control layer for your computer. Dictate into nearly any application, transform rough speech into polished text, trigger reusable workflows with phrases that feel natural to you, and use spoken requests to send keyboard actions wherever your cursor is active.

Instead of forcing you into a fixed vocabulary or workflow, Porvoz adapts to the way you want to speak and work. You choose the transcription and instruction models, create your own instruction prefixes, decide which prefixes receive clipboard context, and tune the hotkey, feedback, and behavior to fit your setup. It can be a fast voice keyboard, a collection of specialized assistants, or a powerful hands-free interface for controlling your machine.

## Download and install

The current release is [Porvoz v2.7.0-alpha-1](https://github.com/bgaeddert/porvoz/releases/tag/v2.7.0-alpha-1). Release packages are x64 builds. See the [release history](https://github.com/bgaeddert/porvoz/releases) for version notes and downloads.

### Windows

Download and run the [Windows installer](https://github.com/bgaeddert/porvoz/releases/download/v2.7.0-alpha-1/Porvoz-2.7.0-alpha-1-win-x64.exe). It is an interactive per-user NSIS installer and can create Start Menu and desktop shortcuts.

### Linux

Download the [Linux AppImage](https://github.com/bgaeddert/porvoz/releases/download/v2.7.0-alpha-1/Porvoz-2.7.0-alpha-1-linux-x86_64.AppImage), then make it executable and launch it:

```bash
chmod +x Porvoz-2.7.0-alpha-1-linux-x86_64.AppImage
./Porvoz-2.7.0-alpha-1-linux-x86_64.AppImage
```

The Linux build requires an X11 desktop session for global hotkeys and typing into the active application. Wayland sessions are not currently supported for those desktop-integration features. A Secret Service provider such as GNOME Keyring/libsecret must be available to start the local backend and protect its encryption key. On Ubuntu/Debian, install missing runtime services and libraries with:

```bash
sudo apt install gnome-keyring libsecret-1-0 libgtk-3-0 libnss3 libgbm1 libasound2 libxss1 libxtst6 xclip
```

The AppImage does not need to be installed system-wide. The SHA-256 values for both release files are available in [`SHA256SUMS.txt`](https://github.com/bgaeddert/porvoz/releases/download/v2.7.0-alpha-1/SHA256SUMS.txt).

There is no macOS package in the current release.

## First-time setup

Porvoz starts hidden and adds a tray icon. Choose **Open Porvoz** from the tray menu to open its settings; the app continues running in the tray when its windows are closed.

The desktop uses its private local child server by default. To share one backend across machines, open **Provider & models → Porvoz server**, choose **Remote server**, and enter its URL and admin API key.

1. Open **Provider & models**.
2. Enter the endpoint's base URL and API key under the active connection profile. To configure another endpoint later, select **New profile** above the form, give it a name, then fill in its own base URL, key, and models — Porvoz keeps every profile's settings separate and switches instantly when you pick a different one from the dropdown. Use **Rename** or **Delete** for any profile except the last one.
3. Select **Load models**. Porvoz reads the endpoint's `/v1/models` catalog for the selected profile.
4. Type or paste a model ID into the **Transcription model** and **Instruction model** fields; each is saved automatically. You can also use the browse button beside either field to search the loaded catalog, choose a model, and save it into that field. Choose the instruction reasoning level (`low`, `medium`, or `high`); it defaults to `low` and applies only to instruction-model requests. Enable **OpenRouter search tool** when the selected endpoint is OpenRouter; leave it off for endpoints that implement the standard Responses API `web_search` tool.

The endpoint must provide the OpenAI-compatible audio transcription and Responses API operations used by the app. **Verify certificate** is enabled by default for every API request. Disable it only for a trusted self-signed endpoint on a network you control.

## Instruction prefixes

Prefixes are reusable voice triggers. A transcript reaches the instruction model when it begins with a prefix in the registry; matching is case-insensitive. Porvoz can recognize a chain of consecutive prefixes from left to right, remove the matched trigger phrases, and apply every matched instruction in order. If no registered prefix matches and the focused application reports no selected text, the transcription is returned without calling the instruction model.

The **Instruction prefix registry** in Settings shows every entry at the same level with its trigger name and instruction. Select a row to change the name, instruction, clipboard context setting, or remove the prefix. Every saved prefix is active immediately. Use **Refresh prefixes** to load changes made by another desktop connected to the same server.

The sidebar lists each page at the top level, with no settings sub-menu: **Provider**, **Prefixes**, **Keyboard**, and **Sound** are what you configure, and **Test** and **Activity** below them are what you check the result with. Porvoz opens on **Provider**.

Below about 820px the sidebar becomes a labelled bar across the bottom of the window and the content takes the full width, so the same pages work on a phone.

Each prefix row also has a **Copy** button. It puts a portable JSON version of that prefix on the system clipboard without its local registry ID. Select **Import from clipboard** to read and add it; imported prefixes are validated before saving, receive a fresh local ID, and a name collision gets a `duplicate` suffix automatically. The repository's ready-to-copy examples are in [examples.md](examples.md).

Porvoz loads these five ordinary prefix entries by default when no settings have been saved:

- **digits** — Extracts every number from the transcript, converts number words to numerals when needed, concatenates the results, and returns digits only.
- **one word** — Responds with exactly one word, without punctuation or explanation.
- **letters** — Combines spoken letters into a compact string. It can also insert a space, dash, dot, or exclamation point when that is spoken explicitly.
- **search** — Tells the model to use web search to find and verify an answer, then respond concisely.
- **clipboard** — Applies the spoken request to the current text clipboard as reference context. Clipboard access is enabled by default for this prefix; clipboard contents are treated as untrusted data and are not replaced.

All five packaged entries are active after first-run setup or a full reset, and are ordinary editable prefixes.

### Add your own prefix

Select **Add prefix** in the registry and choose one of two paths:

- **Add a prefix manually** opens a blank editor. Enter a unique trigger name and the instruction the model should follow, choose whether it receives clipboard context, then save it. The prefix becomes active immediately and remains fully editable.
- **Create a new prefix with your voice** lets you describe the trigger and desired result aloud. Select **Start listening**, speak the request, then select **Stop and create**. Porvoz sends the recording to the configured transcription and instruction models to draft a name and instruction using the existing registry as context. Review and edit the proposed prefix, then select **Add prefix** to save it; nothing is saved until you approve the preview.

Prefix names must be unique, ignoring case. Use **Remove prefix** to delete any entry. Each prefix has an independent **Include clipboard context** control. When prefixes are chained, clipboard context is included when at least one matched prefix enables it.

## Using Porvoz

Hold **Right Ctrl** anywhere to record by default. Release the key to transcribe and type the result into the application that owns the cursor. Use **Keyboard → Set hotkey** to choose another key or combination, such as **Ctrl + Super** or **Ctrl + Shift + F12**; changes take effect immediately.

**Keyboard → Console selection** controls automatic selection copying only in recognized terminal windows. It is **off by default**, including for existing desktops. Dictation, paste, and selection copying in other applications are unaffected. Enable it to attempt `Ctrl+Shift+C` in recognized terminals. **Warning:** if nothing is selected, a terminal can pass that shortcut through as Control-C, likely canceling or exiting running applications or commands. Unknown terminals and terminal panes inside editors are not covered by this setting. The preference is saved on this computer and applies immediately.

While a capture is active, the status pill appears near the bottom of the display containing the cursor. It uses short labels for **Recording**, **Transcribing**, **Processing**, and **Placing text**, then briefly shows **Done** or a categorized error. Double-tap the configured hotkey to open the last completed response, even after the pill disappears. When web search is used, the response panel displays automatically for two seconds unless hovered, staying open until dismissed. Hold the hotkey for 300 ms to start recording; short taps do not record audio or touch the clipboard. Hovering over an ordinary status pill has no effect. The response panel renders common Markdown and provides **Copy** and **×** controls. Press **Escape** to dismiss it. The non-activating overlay does not become the typing target.

Use **Radial → Set trigger** to assign the global key or mouse button that opens the radial menu. Hold it for 200 ms to show the 12-segment wheel; releasing sooner sends the center action without showing the wheel. Once open, move over a segment and release to send its assigned keyboard shortcut or Back/Forward navigation action. The center is slot 13: releasing there sends its action when assigned; releasing outside the wheel cancels. All slots are optional. The radial trigger and every slot shortcut are recorded from actual input, including Windows-key combinations, and labels can be customized in the Radial settings page. The radial wheel uses a 552 × 552 pixel overlay modeled on the reference design. The non-activating overlay does not become the typing target.

The main window also provides **Start recording**, which displays the raw transcription and any instruction response directly in the app. With no selected text, Porvoz matches consecutive prefixes at the beginning of the transcript, removes the matched phrases, and sends only those matched prefix instructions and the remaining spoken request to the instruction model. A transcript without a matched prefix bypasses the instruction model and is returned directly.

Every instruction-model request makes web search available without requiring the model to use it. The **Enable OpenRouter search tool** checkbox selects the wire protocol: checked requests use OpenRouter's `openrouter:web_search` server tool and its response metadata; unchecked requests use the standard `web_search` Responses tool and response metadata. Discovered citations may be appended to the result. In the prefix flow, the current clipboard is included as untrusted reference context only when at least one matched prefix enables it. When text is selected, Porvoz instead sends the complete transcript and selected text through a dedicated selection prompt; it does not match or send prefixes and does not include clipboard context. Porvoz captures selected text with a clipboard snapshot, a unique sentinel, and synthetic copy, then restores the original clipboard. On Windows and Linux, this runs when recording stops and waits for all Control, Alt, Shift, and Meta keys to be released. Recognized standalone terminals are skipped unless Console selection is enabled, in which case they receive `Ctrl+Shift+C`; other applications receive `Ctrl+C`. An empty terminal copy is never retried with `Ctrl+C`. Detection uses Windows window classes and executable names or Linux X11 window classes and instance names, without accessibility APIs. Unknown terminals and terminal panes embedded in editors are not automatically recognized. Linux writes raw X11 clipboard formats so neither capture nor paste clears the application's selection. Selection capture is bounded to 200,000 characters; unavailable selections are omitted. **Activity** stores the 200 most recent transcript, instruction, and error entries on the selected server, marks responses that actually used web search, and shows per-stage and total processing time when timing data is available. Desktops using the same remote server share that history.

When a typed response needs a keyboard action, the instruction model can return bracketed key notation such as `[Enter]`, `[Control+F]`, or `[Control+Shift+ArrowDown]`. Put modifier names first, separate keys with `+`, and use one notation per action; Porvoz parses the notation and sends the corresponding key press or combination. Linux typing uses X11 for the global hotkey and simulated paste input. macOS is not supported in the current release.

Text placement uses serialized clipboard transactions: snapshot the clipboard, temporarily supply the response, simulate Paste, and restore the original formats unless clipboard ownership changed. Recognized Linux terminals receive `Ctrl+Shift+V`, with short delays between key events so terminals such as Ghostty recognize the shortcut. Other Linux applications and Windows retain `Ctrl+V`. Paste remains enabled regardless of the Console selection setting. Linux supplies raw X11 clipboard formats because Chromium's normal text write also takes over `PRIMARY` and clears GTK selections. A CopyQ ownership marker prevents clipboard-to-selection synchronization of these temporary writes. Linux waits for held modifiers to be released and verifies that the recording window still has focus before pasting; Windows retains its foreground-window restoration. Linux clipboard snapshots use `xclip`. See the [Linux](docs/linux-selection-testing.md) and [Windows](docs/windows-selection-testing.md) selection regression guides for real desktop verification and repeatable regression checks.

## Headless server and Docker

Porvoz's provider connections, model choices, prefixes, inference keys, and activity are owned by one headless server. The desktop either starts that server as a private child process or connects to an independently hosted copy. Both modes use the same API and SQLite database format.

For a Docker deployment, copy `.env.example` to `.env`, replace both placeholder keys, and start Compose:

```bash
docker compose pull
docker compose up -d
```

Compose pulls the published `bgaeddert/porvoz` image from Docker Hub. `PORVOZ_IMAGE_TAG` defaults to `latest`; set it to a release such as `2.7.0-alpha-1` to pin that exact server version. Compose reads `.env` for interpolation and explicitly passes only the declared runtime values into the container. `PORVOZ_ADMIN_KEY` authorizes the settings API and first-party profile routing. `PORVOZ_MASTER_KEY` encrypts upstream provider API keys in the database. The database is kept in the `porvoz-data` volume and survives container replacement.

To build the image from the current source checkout instead, run `docker compose up -d --build`.

The included server speaks plain HTTP. For access beyond a trusted local network, place it behind an HTTPS reverse proxy rather than exposing port 8080 directly to the internet.

The server exposes `GET /v1/models` and `POST /v1/audio/transcriptions` for OpenAI-compatible clients. Each profile receives a visible inference API key. For requests using that key, the server ignores the submitted `model` value and routes to the bound profile. The Porvoz desktop authenticates with the admin key and sends the internal profile ID in `model`. The server returns text only and does not support verbose, timestamp, or subtitle response formats. See [the server API reference](docs/server-api.md) for the complete contract and administrative routes.

## Browser administration

The server also hosts a website for administering itself. Open the server's address in a browser, enter its admin key — there is no user name — and it opens on the Provider page. The site's navigation matches the desktop's: **Provider** and **Prefixes**, then **Test** and **Activity**, then **Log out**. Keyboard, Radial, and Sound are desktop-only and do not appear. The site administers only the server hosting it.

Provider profiles, credentials, models, prefixes, prefix import and export, inference-key viewing and rotation, activity, and Reset are all available. Server switching, keyboard and hotkey settings, radial-menu settings, console selection, recording sounds, desktop overlays, and typing into other applications stay in the desktop app and are absent from the website. Because one server's configuration is shared, Reset and Clear activity say so before you confirm.

**Test and voice prefix creation** record with the microphone of the computer visiting the site, so the container needs no audio device. Browsers offer microphone access only in a secure context, so recording requires an HTTPS connection or a localhost address; over ordinary remote HTTP both recording controls are disabled and explain why, while the rest of administration still works. The Test page shows its transcript and instruction response in the page with explicit Copy controls. It never types into other applications, never runs returned keyboard notation, and never reads your clipboard or selected text.

Signing in exchanges the admin key for a session held in an HttpOnly cookie; the key itself is never stored in the browser. Log out confirms first. Sessions time out after an hour of inactivity, expire eight hours after sign-in, and end when the server restarts. Sign-in over plain HTTP is refused unless the browser reached the server at a localhost address or `PORVOZ_WEB_ALLOW_INSECURE=true` is set for a trusted network. Inference API keys never grant access to the website. Set `PORVOZ_WEB_ADMIN=off` to run the API alone; the desktop's private child server always runs with the website off.


## Local data and security

The local child server stores its SQLite database and encrypted server master key in the platform user-data directory. Desktop-only preferences—including local/remote mode, the selected profile for each backend, hotkey, sound volume, and console selection—are stored separately. A configured remote admin key is protected with Electron's operating-system-backed credential encryption.

On the first local-server launch, Porvoz imports existing desktop connection profiles, provider keys, models, and prefixes. Retired custom prompt and Search-access fields are ignored. Hotkey and sound preferences remain local. The previous settings and credentials files are retained; the old activity archive is not imported. See [server setup and migration](docs/server-setup.md) for data locations, backups, and deployment options.

Upstream provider API keys are encrypted inside the server database and are never returned by the API. Profile inference API keys are intentionally stored as readable values so the admin UI can display and copy them. For Docker, keep `.env` out of source control and back up `PORVOZ_MASTER_KEY` separately from the database; the encrypted provider keys cannot be recovered without it.

Use **Reset to defaults** on the Prefixes page to remove every server profile, provider credential, prefix, inference key, and activity entry, while restoring the desktop capture defaults. On a shared remote server, this resets the configuration for every connected client.

Browser administration sessions live only in the server's memory. Restarting the server signs every browser out. Put the server behind an HTTPS reverse proxy for any access beyond a trusted local network, and name that proxy in `PORVOZ_TRUSTED_PROXIES` so its forwarded protocol is believed; forwarded headers from anywhere else are ignored.

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
  libxkbcommon-x11-dev libxrandr-dev libxt-dev libxtst-dev xclip
```

To exercise the browser administration site against a real container, follow the [WSL browser testing guide](docs/wsl-browser-testing.md). It covers building and running a disposable container in WSL and reaching it from a Windows browser at a localhost address, which is what lets the browser offer the microphone.

GitHub Actions runs the test suite on Windows and Ubuntu. Pushing a version tag builds the Windows NSIS installer and Linux AppImage, publishes the server image to Docker Hub, then attaches both desktop packages and a checksum manifest to a GitHub Release. Docker publishing requires the repository variable `DOCKERHUB_USERNAME` and secret `DOCKERHUB_TOKEN`.

## Attributions

Porvoz uses the [Tabler Icons](https://github.com/tabler/tabler-icons) outline set for interface icons. Icons are kept inline so the app remains self-contained and available offline; the standard is Tabler’s 24×24 viewBox with a 2px stroke.

The capture feedback sounds are the CC0 **Recording Start.mp3** and **Recording Stop.mp3** clips by [AbdrTar on Freesound](https://freesound.org/people/AbdrTar/). The start clip is [sound 519985](https://freesound.org/people/AbdrTar/sounds/519985/), and the stop clip is [sound 519986](https://freesound.org/people/AbdrTar/sounds/519986/). Failed text placement uses the CC0 [Wrong Choice](https://freesound.org/people/unadamlar/sounds/476177/) clip by unadamlar. Their shared playback volume defaults to 30% and can be previewed or adjusted under **Sound → Recording cues**.
