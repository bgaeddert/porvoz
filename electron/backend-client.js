export function createBackendClient({ baseUrl, adminKey, getActiveProfileId, setActiveProfileId }) {
  const endpoint = baseUrl.replace(/\/+$/, "");

  return {
    getRuntimeConfig,
    getConnectionSettings,
    getSetupStatus,
    saveConnection,
    populateModels,
    saveModelSelections,
    savePrompt,
    resetPrompt,
    savePrefixSettings,
    createProfile,
    renameProfile,
    deleteProfile,
    setActiveProfile,
    resetToDefaults,
    getLogs: () => request("/v1/porvoz/logs"),
    clearLogs: () => request("/v1/porvoz/logs", { method: "DELETE" }),
    logError: (value) => request("/v1/porvoz/logs/errors", { method: "POST", json: value }),
    transcribe,
    createPrefixFromVoice,
    getInferenceKey,
    rotateInferenceKey,
    importLegacy: (value) => request("/v1/porvoz/import", { method: "POST", json: value }),
    health: () => request("/health", { authenticate: false })
  };

  async function getRuntimeConfig() {
    let profileId = getActiveProfileId();
    let runtime;
    try {
      runtime = await request(`/v1/porvoz/runtime${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ""}`);
    } catch (error) {
      if (!profileId || error.status !== 500) throw error;
      profileId = "";
      runtime = await request("/v1/porvoz/runtime");
    }
    setActiveProfileId(runtime.activeProfileId);
    return runtime;
  }

  async function getConnectionSettings() {
    const profileId = await activeProfileId();
    return request(`/v1/porvoz/profiles/${encodeURIComponent(profileId)}/connection`);
  }

  async function getSetupStatus() {
    const profileId = await activeProfileId();
    return request(`/v1/porvoz/setup?profileId=${encodeURIComponent(profileId)}`);
  }

  async function saveConnection(value) {
    const profileId = await activeProfileId();
    return request(`/v1/porvoz/profiles/${encodeURIComponent(profileId)}/connection`, {
      method: "PUT",
      json: value
    });
  }

  async function populateModels({ signal } = {}) {
    const profileId = await activeProfileId();
    return request(`/v1/porvoz/profiles/${encodeURIComponent(profileId)}/models`, {
      method: "POST",
      signal
    });
  }

  async function saveModelSelections(value) {
    const profileId = await activeProfileId();
    return request(`/v1/porvoz/profiles/${encodeURIComponent(profileId)}/models`, {
      method: "PUT",
      json: value
    });
  }

  async function savePrompt(prompt) {
    return (await request("/v1/porvoz/prompt", { method: "PUT", json: { prompt } })).prompt;
  }

  async function resetPrompt() {
    return (await request("/v1/porvoz/prompt/reset", { method: "POST" })).prompt;
  }

  async function savePrefixSettings(value) {
    await request("/v1/porvoz/prefixes", { method: "PUT", json: value });
    return getRuntimeConfig();
  }

  async function createProfile(value) {
    const runtime = await request("/v1/porvoz/profiles", { method: "POST", json: value });
    setActiveProfileId(runtime.activeProfileId);
    return runtime;
  }

  async function renameProfile(value) {
    await request(`/v1/porvoz/profiles/${encodeURIComponent(value.id)}`, {
      method: "PATCH",
      json: { name: value.name }
    });
    return getRuntimeConfig();
  }

  async function deleteProfile(value) {
    await request(`/v1/porvoz/profiles/${encodeURIComponent(value.id)}`, { method: "DELETE" });
    setActiveProfileId("");
    return getRuntimeConfig();
  }

  async function setActiveProfile({ id } = {}) {
    const runtime = await request(`/v1/porvoz/runtime?profileId=${encodeURIComponent(id)}`);
    setActiveProfileId(id);
    return runtime;
  }

  async function resetToDefaults() {
    await request("/v1/porvoz/reset", { method: "POST" });
    setActiveProfileId("");
    return getRuntimeConfig();
  }

  async function transcribe({ audio, mimeType, clipboardText = "" } = {}, { signal } = {}) {
    const profileId = await activeProfileId();
    const form = new FormData();
    form.set("model", profileId);
    form.set("response_format", "json");
    form.set("porvoz_context", serializeClipboardContext(clipboardText));
    form.set("file", new Blob([audio], { type: mimeType }), audioFileName(mimeType));
    const result = await request("/v1/audio/transcriptions", { method: "POST", body: form, signal });
    return {
      transcript: result.text,
      rawTranscript: result.porvoz?.raw_transcript || result.text,
      instructionApplied: result.porvoz?.instruction_applied === true,
      logGroupId: result.porvoz?.log_group_id || ""
    };
  }

  async function createPrefixFromVoice({ audio, mimeType } = {}, { signal } = {}) {
    const profileId = await activeProfileId();
    const form = new FormData();
    form.set("model", profileId);
    form.set("file", new Blob([audio], { type: mimeType }), audioFileName(mimeType));
    return request("/v1/porvoz/prefixes/from-audio", { method: "POST", body: form, signal });
  }

  async function getInferenceKey() {
    const profileId = await activeProfileId();
    return request(`/v1/porvoz/profiles/${encodeURIComponent(profileId)}/inference-key`);
  }

  async function rotateInferenceKey() {
    const profileId = await activeProfileId();
    return request(`/v1/porvoz/profiles/${encodeURIComponent(profileId)}/inference-key`, { method: "POST" });
  }

  async function activeProfileId() {
    return getActiveProfileId() || (await getRuntimeConfig()).activeProfileId;
  }

  async function request(path, { method = "GET", json, body, signal, authenticate = true } = {}) {
    const headers = {};
    if (authenticate) headers.authorization = `Bearer ${adminKey}`;
    if (json !== undefined) headers["content-type"] = "application/json";
    let response;
    try {
      response = await fetch(`${endpoint}${path}`, {
        method,
        headers,
        body: json !== undefined ? JSON.stringify(json) : body,
        signal
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new Error(`Could not reach the Porvoz backend at ${endpoint}.`);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `The Porvoz backend returned HTTP ${response.status}.`);
      error.status = response.status;
      error.code = payload?.error?.code;
      throw error;
    }
    return payload;
  }
}

function serializeClipboardContext(value) {
  // Stay below the server's 300,000-byte multipart field limit, including
  // JSON escaping and UTF-8 encoding rather than just clipboard characters.
  const maxBytes = 299_999;
  const clipboard = typeof value === "string" ? value : "";
  const candidate = JSON.stringify({ clipboard: clipboard.slice(0, maxBytes) });
  if (clipboard.length <= maxBytes && Buffer.byteLength(candidate) <= maxBytes) return candidate;

  const suffix = "\n[Clipboard context truncated to fit the request.]";
  let low = 0;
  let high = Math.min(clipboard.length, maxBytes);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const json = JSON.stringify({ clipboard: clipboard.slice(0, middle) + suffix });
    if (Buffer.byteLength(json) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  // Avoid cutting an astral character between its UTF-16 surrogate halves.
  const lastCodeUnit = clipboard.charCodeAt(low - 1);
  if (lastCodeUnit >= 0xD800 && lastCodeUnit <= 0xDBFF) low -= 1;
  return JSON.stringify({ clipboard: clipboard.slice(0, low) + suffix });
}

function audioFileName(mimeType = "") {
  const type = mimeType.toLocaleLowerCase();
  const extension = type.includes("mp4") ? "mp4"
    : type.includes("mpeg") ? "mp3"
      : type.includes("ogg") ? "ogg"
        : type.includes("wav") ? "wav"
          : "webm";
  return `transcription.${extension}`;
}
