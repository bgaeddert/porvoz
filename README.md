# Porvoz

Customizable, intelligent voice transcription.

Tray-first Electron app for transcribing microphone audio and applying instruction prefixes. API credentials stay in the local Electron app, and requests use the configured OpenAI-compatible endpoint.

1. Install dependencies: `npm install`
2. Run the desktop app: `npm start`
3. Open **Settings**, enter the endpoint base URL and API key, then choose **Load models**. Select one loaded model for transcription and one for instruction requests.

On Linux, Porvoz requires an X11 desktop session for global hotkeys and typing into the active application. Wayland sessions are not currently supported for those desktop-integration features. Linux development builds also require the X11 development headers used by the native hotkey module, including `libx11-dev`, `libxt-dev`, `libxtst-dev`, `libxrandr-dev`, `libxinerama-dev`, and `libxkbcommon-dev`. Porvoz uses the desktop's GNOME Keyring/libsecret service to protect the API key when available.

Porvoz starts hidden and adds a tray icon. Use **Open Porvoz** from the tray menu to open Settings; the app continues running in the tray when its windows are closed.

Hold **Right Ctrl** anywhere to record by default. Release the capture key to send the audio through transcription and, when a registered instruction prefix is present, the instruction model. The final result is pasted into the application that currently owns the cursor. Use **Capture hotkey** in Settings to choose a different key or combination, such as **Ctrl + Shift + F12**; the change takes effect immediately.

The main window remains available for direct use. **Settings** contains connection details, model choices, the instruction prompt, instruction prefixes, and the capture key. Select **Add prefix**, then choose **Create a new prefix with your voice** to describe a new prefix aloud. Porvoz transcribes the description, asks the instruction model for a trigger and instruction using the current prompt and prefix registry, and shows an editable preview before anything is saved. Porvoz runs entirely as an Electron tray app and does not start a web server.

Use **Start recording** to capture a complete microphone recording through the configured endpoint and display the raw transcription in the Transcript box. If the transcript starts with a registered instruction prefix, it is also sent with the main prompt and the full prefix registry to the selected instruction model; the model response appears in the separate Instruction response box.

The **Load models** button queries the endpoint's `/v1/models` endpoint and stores the complete returned model catalog in the local settings. The selected transcription and instruction models are stored separately and used by **Start recording**. Changing the endpoint clears the loaded catalog so it can be populated from the new endpoint.

**Logs** stores the 200 most recent transcript and instruction entries on this device. Older entries are removed automatically as new responses are saved, and **Clear all logs** removes the current archive without changing settings.

The Instructions prompt on **Settings** is sent as the model's editable instruction message. Instruction requests use the OpenAI SDK and Responses API. Built-in prefixes remain in the registry and can be reset to their packaged definitions; custom prefixes can be removed. Every prefix has an enabled switch plus separate Search access and Clipboard access switches. The built-in **search** and **clipboard** prefixes are disabled by default, with their corresponding access preconfigured; enable them before using them. Search access enables the hosted `web_search` tool and appends discovered sources to the result. Clipboard access reads the current text clipboard when the instruction runs and passes it to the model as explicitly labeled, untrusted reference context. For example, enabling the **clipboard** prefix and saying “clipboard summarize this” asks the instruction model to summarize the text currently on the clipboard. Transcripts without an enabled instruction prefix are returned without calling the instruction model. Response typing uses a cross-platform native keyboard automation provider and does not modify the system clipboard. macOS requires Accessibility permission; Linux support depends on the desktop session and is intended for X11-compatible environments.

The app stores non-secret user settings in the platform user-data directory as `settings.json`. The API key is encrypted in a separate credential file using the operating system's secure credential facility. The packaged `electron/defaults.json` file contains only first-run defaults and never contains an API key. **Verify certificate** is enabled by default and applies to every API request. It can be disabled for an endpoint using a trusted self-signed certificate; use that option only on a network you trust because it disables HTTPS server-certificate verification for this app's API transport.

Use **Reset to defaults** in Settings to remove the saved API key and all editable settings, then rebuild the user settings from the packaged defaults.

The capture feedback sounds are the CC0 **Recording Start.mp3** and **Recording Stop.mp3** clips by [AbdrTar on Freesound](https://freesound.org/people/AbdrTar/). The start clip is [sound 519985](https://freesound.org/people/AbdrTar/sounds/519985/), and the stop clip is [sound 519986](https://freesound.org/people/AbdrTar/sounds/519986/). Their shared playback volume defaults to 30% and can be adjusted under **Settings → Desktop capture → Recording cues**.
