# Server setup and migration

Porvoz 2.7.0-alpha-1 supports a private local backend and a shared remote backend. Both run the same server and store configuration in a SQLite database. Microphone capture, clipboard access, selected-text discovery, global hotkeys, the radial menu, and typing into applications remain on the desktop.

## Local desktop

The desktop starts a backend bound to a random loopback port. Its admin key is generated for that process. No server configuration is required for this mode.

On the first local-server launch, existing profiles, provider credentials, model selections, and prefixes are imported from the previous desktop settings. Retired custom prompt and Search-access fields are ignored. The desktop separately imports hotkey and sound preferences. Existing `settings.json`, `credentials.bin`, and `logs.json` files are retained; historical activity is not copied into the new database. Subsequent configuration changes use the new stores.

The platform user-data directory contains:

| File | Purpose |
| --- | --- |
| `porvoz.db` | Server profiles, encrypted provider keys, inference keys, prefixes, and activity |
| `server-master-key.bin` | Server encryption key protected by the operating system |
| `desktop-preferences.json` | Backend selection, encrypted remote admin key, active profile per backend, hotkey, cue volume, and console selection |

The directory is normally `%APPDATA%/Porvoz` on Windows or `$XDG_CONFIG_HOME/Porvoz` (default `~/.config/Porvoz`) on Linux. Local encryption depends on the operating system's credential service. Copying the database alone does not transfer its provider credentials to a different machine.

## Docker

Copy the repository's `.env.example` to `.env` and replace both key placeholders with independent random secrets. Set `PORVOZ_IMAGE_TAG=2.7.0-alpha-1` to pin this release, then run:

```bash
docker compose pull
docker compose up -d
```

The image is `bgaeddert/porvoz:2.7.0-alpha-1` and supports Linux amd64. Compose stores the database in the `porvoz-data` volume. To run the published image directly:

```bash
docker run -d --name porvoz --restart unless-stopped \
  --env-file .env -p 8080:8080 \
  -v porvoz-data:/data bgaeddert/porvoz:2.7.0-alpha-1
```

The image listens on `0.0.0.0:8080` and writes `/data/porvoz.db` by default. If changing the direct-run server port through `.env`, also adjust both sides of `-p`. The server provides plain HTTP; use an HTTPS reverse proxy for access beyond a trusted local network.

The image also serves the browser administration website from the same port. See [Browser administration](#browser-administration) below.

## Browser administration

Open the server's address in a browser and sign in with `PORVOZ_ADMIN_KEY`. There is no user name. Successful sign-in opens the Provider page; an existing session goes there directly. The website administers only the server hosting it. Its sidebar lists Provider and Prefixes, then Test and Activity, then Log out; Keyboard and Sound are desktop-only and do not appear. On a narrow window the sidebar becomes a bar across the bottom.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORVOZ_WEB_ADMIN` | `on` | Set to `off` to serve only the API |
| `PORVOZ_WEB_ALLOW_INSECURE` | `false` | Set to `true` to permit sign-in over plain HTTP on a trusted network |
| `PORVOZ_TRUSTED_PROXIES` | empty | Comma-separated proxy addresses whose forwarded headers are believed |
| `PORVOZ_WEB_IDLE_TIMEOUT_MINUTES` | `60` | Sign out after this much inactivity |
| `PORVOZ_WEB_SESSION_MINUTES` | `480` | Maximum session lifetime after sign-in |

### Sessions

Log out asks for confirmation before ending the session. The admin key is exchanged for a random session token held in an HttpOnly, SameSite=Strict cookie. A second, readable cookie carries a request token the page echoes in a header, so a request that did not come from the site is refused. The admin key is never kept in browser storage, URLs, or logs. Sessions live in the server's memory: restarting the server signs every browser out. Sign-in is rate limited per client address.

Bearer-key authentication is unchanged for the desktop and other API clients. Inference keys never grant website access, and a browser session cannot reach an endpoint a bearer inference key could not.

### HTTP, HTTPS, and reverse proxies

Browsers treat HTTPS and localhost addresses as secure contexts and offer the microphone only there. The server applies the same rule to sign-in:

- **HTTPS**, or a browser reaching the server at `localhost`, `127.0.0.1`, or `[::1]`: sign-in and recording both work.
- **Plain HTTP to any other host name**: sign-in is refused unless `PORVOZ_WEB_ALLOW_INSECURE=true`. With it set, administration works on a trusted network but recording stays unavailable and the page explains why.

Terminate HTTPS at a reverse proxy for remote access, and list that proxy in `PORVOZ_TRUSTED_PROXIES` (exact addresses, IPv4 CIDR ranges such as `172.18.0.0/16`, or the keyword `loopback`). Only listed addresses have their `X-Forwarded-Proto` and `X-Forwarded-Host` believed; forwarded headers from anywhere else are ignored, so an unlisted client cannot claim an HTTPS origin it does not have. Forward the original `Host` header, or set `X-Forwarded-Host`, so the server sees the origin the browser used.

### Microphone, Test, and voice prefixes

Recording uses the microphone of the computer visiting the website. The container needs no audio device and no device passthrough. The Test page and voice prefix creation share one capability check — secure context, `getUserMedia`, and a supported `MediaRecorder` format — and one explanation when any of them is missing. Both controls stay visible and disabled rather than disappearing.

The Test page displays the raw transcript and any instruction response in the page with explicit Copy controls. It does not type into other applications, does not run returned keyboard notation, and sends no clipboard or selected-text context: a prefix that permits clipboard context receives nothing from the browser. Existing transcription API access for the desktop and other compatible clients is unchanged.

### Shared-server effects

One server's profiles, prefixes, inference keys, and activity are shared by every client connected to it. **Reset to defaults** and **Clear all logs** say so in the browser before you confirm. Neither changes any desktop's hotkey, sound, or console-selection preference, which live on each computer. Choosing a provider profile in the browser is remembered by that browser alone and does not change what other clients are using.

## Connect a desktop or third-party client

In **Provider & models → Porvoz server**, choose **Remote server**, enter the server's origin URL (for example, `https://porvoz.example.com`) and admin key, then save. Do not append `/v1` to this desktop URL. A successful connection loads that server's configuration; local profiles are not uploaded automatically.

If the saved remote server cannot be reached at startup, the desktop opens with its local backend for recovery. Correct the connection or choose Local in the server settings. Changes to the recovery backend remain local.

Provider profiles, prefixes, and activity are shared across desktops connected to the same server. Each desktop keeps its own selected profile, hotkey, and sound volume. Use **Refresh prefixes** to load registry changes from another client. A full reset affects all clients of that server.

Third-party OpenAI-compatible clients use the server URL with `/v1` and the selected profile's **Third-party inference API key** from **Provider & models**. The key binds requests to that profile regardless of the client's submitted model name. Regenerating it immediately invalidates the previous key. The admin key permits configuration changes and should be reserved for administration and trusted desktops. See the [API reference](server-api.md).

## Run from source

Install the project dependencies, set `PORVOZ_ADMIN_KEY` and `PORVOZ_MASTER_KEY` in the process environment, and run `npm run server`. This command does not automatically load `.env`.

| Variable | Source-server default | Purpose |
| --- | --- | --- |
| `PORVOZ_ADMIN_KEY` | Required | Administrative API authentication |
| `PORVOZ_MASTER_KEY` | Required | Encryption of stored provider credentials |
| `PORVOZ_HOST` | `127.0.0.1` | Listener interface; use `0.0.0.0` for remote access |
| `PORVOZ_PORT` | `8080` | Listener port |
| `PORVOZ_DATABASE_PATH` | `data/porvoz.db` under the working directory | Database location |
| `PORVOZ_DEFAULTS_PATH` | Packaged `electron/defaults.json` | Initial settings and limits |
| `PORVOZ_WEB_ADMIN` | `on` | Browser administration website |
| `PORVOZ_WEB_ALLOW_INSECURE` | `false` | Permit sign-in over plain remote HTTP |
| `PORVOZ_TRUSTED_PROXIES` | empty | Proxy addresses whose forwarded headers are believed |

The desktop's private child server always runs with `PORVOZ_WEB_ADMIN=off`. See the [WSL browser testing guide](wsl-browser-testing.md) for running a disposable container and reaching it from a Windows browser.

## Backups and upgrades

Stop the server before copying its database. Keep the Docker volume or database when replacing a container, and retain the same `PORVOZ_MASTER_KEY`. Back up that key separately: replacing it does not re-encrypt existing provider keys and makes them unreadable. The local desktop's protected master key must remain accessible through the same operating-system credential service.

For a pinned Docker upgrade, change `PORVOZ_IMAGE_TAG`, then run `docker compose pull` and `docker compose up -d`. Do not remove the data volume. Keep a backup before changing server versions; the previous desktop settings files do not receive changes made through the new server.
