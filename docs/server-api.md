# Porvoz server API

The Porvoz server has two authentication modes. Send either key as `Authorization: Bearer <key>`.

See [server setup and migration](server-setup.md) for deployment, desktop connections, and backup instructions.

- The admin key comes from `PORVOZ_ADMIN_KEY`. It permits all settings and activity operations. On transcription requests it treats `model` as an internal profile ID.
- Every profile has one readable inference key. It permits only `/v1/models` and `/v1/audio/transcriptions` for its bound profile. The submitted `model` value is accepted for client compatibility and ignored.

A third mode serves the browser administration website only. It uses a session cookie rather than a bearer key and is described under [Browser administration routes](#browser-administration-routes). Inference keys cannot obtain a session.

`GET /health` is unauthenticated and returns `{"status":"ok"}`.

## OpenAI-compatible routes

### `GET /v1/models`

An inference key receives exactly one current model description. The admin key receives one for every profile. Its `id` is informational and combines the profile name, transcription model, and instruction model.

```json
{
  "object": "list",
  "data": [
    {
      "id": "Default · gpt-4o-transcribe · gpt-5-mini",
      "object": "model",
      "created": 0,
      "owned_by": "porvoz"
    }
  ]
}
```

### `POST /v1/audio/transcriptions`

Send `multipart/form-data` with:

- `file`: required audio file.
- `model`: ignored for an inference key; required as a profile ID for the admin key.
- `response_format`: optional, but only `json` is supported.
- `porvoz_context`: optional JSON used by the first-party desktop. It can contain `clipboard` and `selectedText` strings. The desktop omits `selectedText` when the focused application reports no selection.
- `porvoz_timing`: optional JSON used by first-party clients to carry capture timing into the shared activity record. Unknown or malformed timing data is ignored.

The server transcribes the audio, selects the straight-transcription, prefix, or selection flow, and returns the final text:

With no selected text, a matching prefix chain invokes the instruction model with only the matched instructions and the transcript remaining after those prefix phrases are removed. Clipboard context is included only when a matched prefix enables it. Non-empty `selectedText` always invokes the instruction model through a separate selection prompt; prefix matching and clipboard forwarding are skipped. Search is available, but not required, on every instruction request. Selected text and clipboard values are treated as untrusted reference material.

```json
{
  "text": "Final text returned to the caller",
  "porvoz": {
    "raw_transcript": "Original transcription",
    "instruction_applied": true,
    "web_search_used": false,
    "log_group_id": "e224…",
    "timing": {
      "preTranscriptionMs": 120,
      "transcriptionMs": 640,
      "instructionPrepMs": 2,
      "instructionMs": 890
    }
  }
}
```

The `porvoz` object is additional first-party metadata. Generic clients can ignore it. Clipboard text is accepted on every desktop request but is included in the instruction-model prompt only when a matched prefix grants Clipboard access.

The packaged upload limit is 25 MiB per audio file. Oversized audio returns HTTP 413; malformed multipart input or context JSON returns HTTP 400. The desktop bounds the combined clipboard and selected-text context to fit the server's 300,000-byte multipart field limit, accounting for JSON escaping and UTF-8 encoding. Larger context values are truncated before transmission.

## Administrative routes

All routes below require the admin key, or an authenticated browser session carrying its request token.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/v1/porvoz/runtime?profileId=<id>` | Read profiles, selected-profile models, prefixes, and limits |
| `GET` | `/v1/porvoz/setup?profileId=<id>` | Check whether a profile is ready for inference |
| `POST` | `/v1/porvoz/profiles` | Create a profile |
| `PATCH` | `/v1/porvoz/profiles/<id>` | Rename a profile |
| `DELETE` | `/v1/porvoz/profiles/<id>` | Delete a profile |
| `GET` | `/v1/porvoz/profiles/<id>/connection` | Read provider connection state and the inference key |
| `PUT` | `/v1/porvoz/profiles/<id>/connection` | Update provider URL, certificate policy, or provider key |
| `POST` | `/v1/porvoz/profiles/<id>/models` | Refresh the upstream model catalog |
| `PUT` | `/v1/porvoz/profiles/<id>/models` | Update model selections, reasoning level, and search-tool mode (`omit`, `openai`, or `openrouter`) |
| `GET` | `/v1/porvoz/profiles/<id>/inference-key` | Read the profile inference key |
| `POST` | `/v1/porvoz/profiles/<id>/inference-key` | Replace the profile inference key |
| `PUT` | `/v1/porvoz/prefixes` | Replace the prefix registry |
| `POST` | `/v1/porvoz/prefixes/from-audio` | Draft a prefix from an audio description |
| `GET` | `/v1/porvoz/logs` | Read recent activity |
| `POST` | `/v1/porvoz/logs/errors` | Record a desktop-side error |
| `POST` | `/v1/porvoz/logs/timing` | Add final stage and total timing to an activity group |
| `DELETE` | `/v1/porvoz/logs` | Clear activity |
| `POST` | `/v1/porvoz/reset` | Reset server-owned configuration and activity |

The local desktop additionally uses `/v1/porvoz/import` once when migrating a pre-server installation. It is an internal migration route and should not be used by third-party clients.

## Browser administration routes

These exist only when the website is enabled (`PORVOZ_WEB_ADMIN` is not `off`). They are for the site's own pages, not for API clients.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/web/login` | Exchange `{"adminKey":"…"}` for a session; requires an `application/json` body |
| `POST` | `/api/web/logout` | End the session and clear its cookies |
| `GET` | `/api/web/session` | Report sign-in state, server version, secure-context status, and session timeouts |

Sign-in sets two cookies: `porvoz_session` (HttpOnly, SameSite=Strict, `Secure` over HTTPS) and `porvoz_csrf`. Every session-authenticated request to `/v1/...` and `/api/web/logout` must repeat the `porvoz_csrf` value in an `x-porvoz-csrf` header; without it the server answers `403` with code `invalid_request_token`. Requests carrying a bearer key are unaffected.

Sign-in is refused with `403` when the browser reached the server over plain HTTP at a host that is not a localhost address, unless `PORVOZ_WEB_ALLOW_INSECURE=true`. Repeated failures are rate limited with `429` and a `Retry-After` header.

The website's pages and assets are served from an explicit allowlist: `/` (sign-in), `/index.html` (Test), `/settings.html`, `/logs.html`, and the scripts and styles those pages need. `/test`, `/activity`, `/settings`, `/prefixes`, and `/provider` redirect to their pages, and `/capture` still reaches Test for older links. A request for an administration page without a session redirects to `/` with a `reason` explaining whether sign-in is required or a session expired. Desktop overlay pages and recording cue audio are not served.
