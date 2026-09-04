# Server setup and migration

Porvoz 2.0.0 supports a private local backend and a shared remote backend. Both run the same server and store configuration in a SQLite database. Microphone capture, clipboard access, global hotkeys, and typing into applications remain on the desktop.

## Local desktop

The desktop starts a backend bound to a random loopback port. Its admin key is generated for that process. No server configuration is required for this mode.

On the first local-server launch, existing profiles, provider credentials, model selections, prompt, and prefixes are imported from the previous desktop settings. The desktop separately imports hotkey and sound preferences. Existing `settings.json`, `credentials.bin`, and `logs.json` files are retained; historical activity is not copied into the new database. Subsequent configuration changes use the new stores.

The platform user-data directory contains:

| File | Purpose |
| --- | --- |
| `porvoz.db` | Server profiles, encrypted provider keys, inference keys, prompt, prefixes, and activity |
| `server-master-key.bin` | Server encryption key protected by the operating system |
| `desktop-preferences.json` | Backend selection, encrypted remote admin key, active profile per backend, hotkey, and cue volume |

The directory is normally `%APPDATA%/Porvoz` on Windows or `$XDG_CONFIG_HOME/Porvoz` (default `~/.config/Porvoz`) on Linux. Local encryption depends on the operating system's credential service. Copying the database alone does not transfer its provider credentials to a different machine.

## Docker

Copy the repository's `.env.example` to `.env` and replace both key placeholders with independent random secrets. Set `PORVOZ_IMAGE_TAG=2.0.0` to pin this release, then run:

```bash
docker compose pull
docker compose up -d
```

The image is `bgaeddert/porvoz:2.0.0` and supports Linux amd64. Compose stores the database in the `porvoz-data` volume. To run the published image directly:

```bash
docker run -d --name porvoz --restart unless-stopped \
  --env-file .env -p 8080:8080 \
  -v porvoz-data:/data bgaeddert/porvoz:2.0.0
```

The image listens on `0.0.0.0:8080` and writes `/data/porvoz.db` by default. If changing the direct-run server port through `.env`, also adjust both sides of `-p`. The server provides plain HTTP; use an HTTPS reverse proxy for access beyond a trusted local network.

## Connect a desktop or third-party client

In **Settings → Provider & models → Porvoz server**, choose **Remote server**, enter the server's origin URL (for example, `https://porvoz.example.com`) and admin key, then save. Do not append `/v1` to this desktop URL. A successful connection loads that server's configuration; local profiles are not uploaded automatically.

If the saved remote server cannot be reached at startup, the desktop opens with its local backend for recovery. Correct the connection or choose Local in the server settings. Changes to the recovery backend remain local.

Provider profiles, prompt, prefixes, and activity are shared across desktops connected to the same server. Each desktop keeps its own selected profile, hotkey, and sound volume. Use **Refresh prefixes** to load registry changes from another client. A full reset affects all clients of that server.

Third-party OpenAI-compatible clients use the server URL with `/v1` and the selected profile's **Third-party inference API key** from Settings. The key binds requests to that profile regardless of the client's submitted model name. Regenerating it immediately invalidates the previous key. The admin key permits configuration changes and should be reserved for administration and trusted desktops. See the [API reference](server-api.md).

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

## Backups and upgrades

Stop the server before copying its database. Keep the Docker volume or database when replacing a container, and retain the same `PORVOZ_MASTER_KEY`. Back up that key separately: replacing it does not re-encrypt existing provider keys and makes them unreadable. The local desktop's protected master key must remain accessible through the same operating-system credential service.

For a pinned Docker upgrade, change `PORVOZ_IMAGE_TAG`, then run `docker compose pull` and `docker compose up -d`. Do not remove the data volume. Keep a backup before changing server versions; the previous desktop settings files do not receive changes made through the new server.
