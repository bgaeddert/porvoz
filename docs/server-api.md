# Porvoz server API

The Porvoz server has two authentication modes. Send either key as `Authorization: Bearer <key>`.

See [server setup and migration](server-setup.md) for deployment, desktop connections, and backup instructions.

- The admin key comes from `PORVOZ_ADMIN_KEY`. It permits all settings and activity operations. On transcription requests it treats `model` as an internal profile ID.
- Every profile has one readable inference key. It permits only `/v1/models` and `/v1/audio/transcriptions` for its bound profile. The submitted `model` value is accepted for client compatibility and ignored.

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
- `porvoz_context`: optional JSON used by the first-party desktop, currently `{"clipboard":"..."}`.

The server transcribes the audio, detects the configured prefix chain, optionally calls the instruction model, and returns the final text:

```json
{
  "text": "Final text returned to the caller",
  "porvoz": {
    "raw_transcript": "Original transcription",
    "instruction_applied": true,
    "log_group_id": "e224…"
  }
}
```

The `porvoz` object is additional first-party metadata. Generic clients can ignore it. Clipboard text is accepted on every desktop request but is included in the instruction-model prompt only when a matched prefix grants Clipboard access.

The packaged upload limit is 25 MiB per audio file. Oversized audio returns HTTP 413; malformed multipart input or context JSON returns HTTP 400. The desktop bounds clipboard context to fit the server's 300,000-byte multipart field limit, accounting for JSON escaping and UTF-8 encoding. Larger clipboard content is truncated before transmission.

## Administrative routes

All routes below require the admin key.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/v1/porvoz/runtime?profileId=<id>` | Read profiles, selected-profile models, prompt, prefixes, and limits |
| `GET` | `/v1/porvoz/setup?profileId=<id>` | Check whether a profile is ready for inference |
| `POST` | `/v1/porvoz/profiles` | Create a profile |
| `PATCH` | `/v1/porvoz/profiles/<id>` | Rename a profile |
| `DELETE` | `/v1/porvoz/profiles/<id>` | Delete a profile |
| `GET` | `/v1/porvoz/profiles/<id>/connection` | Read provider connection state and the inference key |
| `PUT` | `/v1/porvoz/profiles/<id>/connection` | Update provider URL, certificate policy, or provider key |
| `POST` | `/v1/porvoz/profiles/<id>/models` | Refresh the upstream model catalog |
| `PUT` | `/v1/porvoz/profiles/<id>/models` | Update model selections and reasoning level |
| `GET` | `/v1/porvoz/profiles/<id>/inference-key` | Read the profile inference key |
| `POST` | `/v1/porvoz/profiles/<id>/inference-key` | Replace the profile inference key |
| `PUT` | `/v1/porvoz/prompt` | Update the shared instruction prompt |
| `POST` | `/v1/porvoz/prompt/reset` | Restore the packaged prompt |
| `PUT` | `/v1/porvoz/prefixes` | Replace the prefix registry |
| `POST` | `/v1/porvoz/prefixes/from-audio` | Draft a prefix from an audio description |
| `GET` | `/v1/porvoz/logs` | Read recent activity |
| `POST` | `/v1/porvoz/logs/errors` | Record a desktop-side error |
| `DELETE` | `/v1/porvoz/logs` | Clear activity |
| `POST` | `/v1/porvoz/reset` | Reset server-owned configuration and activity |

The local desktop additionally uses `/v1/porvoz/import` once when migrating a pre-server installation. It is an internal migration route and should not be used by third-party clients.
