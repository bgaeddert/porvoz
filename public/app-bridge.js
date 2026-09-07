import { request, signOut } from "./web-client.js";

// One interface, two environments. Desktop operations go through Electron's
// preload bridge; browser operations go through same-origin HTTP. The browser
// never claims to be Electron — every desktop-only capability is reported as
// unavailable so existing checks keep working instead of being bypassed.

const PROFILE_STORAGE_KEY = "porvoz.web.activeProfileId";

const DESKTOP_FEATURES = Object.freeze({
  hotkeys: true,
  sounds: true,
  consoleSelection: true,
  serverSwitching: true,
  typing: true,
  systemClipboard: true,
  desktopStatus: true,
  activityEvents: true,
  signOut: false
});

const BROWSER_FEATURES = Object.freeze({
  hotkeys: false,
  sounds: false,
  consoleSelection: false,
  serverSwitching: false,
  typing: false,
  systemClipboard: false,
  desktopStatus: false,
  activityEvents: false,
  signOut: true
});

const desktop = window.porvozDesktop?.isElectron ? window.porvozDesktop : null;

export const bridge = desktop ? createDesktopBridge(desktop) : createBrowserBridge();

export const isBrowserAdministration = !desktop;

function createDesktopBridge(desktopBridge) {
  return {
    ...desktopBridge,
    environment: "desktop",
    isAvailable: true,
    features: DESKTOP_FEATURES,
    signOut: undefined
  };
}

function createBrowserBridge() {
  return {
    environment: "browser",
    isElectron: false,
    isAvailable: true,
    features: BROWSER_FEATURES,

    getAppVersion: async () => (await request("/api/web/session")).version || "",
    getSessionDetails: () => request("/api/web/session"),
    signOut,

    getRuntimeConfig,
    setActiveProfile,
    getConnectionSettings,
    getSetupStatus,
    saveConnection,
    populateModels,
    saveModelSelections,
    savePrefixSettings,
    createProfile,
    renameProfile,
    deleteProfile,
    resetToDefaults,
    getInferenceKey,
    rotateInferenceKey,
    transcribe,
    createPrefixFromVoice,

    getLogs: () => request("/v1/porvoz/logs"),
    clearLogs: () => request("/v1/porvoz/logs", { method: "DELETE" }),
    updateLogTiming: (value) => request("/v1/porvoz/logs/timing", { method: "POST", json: value }),
    logError: (value) => request("/v1/porvoz/logs/errors", { method: "POST", json: value }),

    // Desktop status reporting has no counterpart in a browser tab. Accepting
    // and discarding the call keeps the shared capture code free of branches
    // for a purely cosmetic desktop affordance.
    setStatus() {},

    // Event subscriptions exist only on the desktop; returning a no-op
    // unsubscribe keeps callers from special-casing the browser.
    onHotkey: noSubscription,
    onHotkeyUpdated: noSubscription,
    onHotkeyCaptureStatus: noSubscription,
    onSoundVolumeUpdated: noSubscription,
    onActivityCanceled: noSubscription,
    onSetupUpdated: noSubscription,
    onLogsUpdated: noSubscription
  };

  async function getRuntimeConfig() {
    let profileId = readStoredProfileId();
    let runtime;
    try {
      runtime = await request(`/v1/porvoz/runtime${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ""}`);
    } catch (error) {
      // A profile deleted from another client leaves a stale local choice;
      // fall back to the server's own active profile rather than failing.
      if (!profileId || error.status !== 500) throw error;
      writeStoredProfileId("");
      runtime = await request("/v1/porvoz/runtime");
    }
    writeStoredProfileId(runtime.activeProfileId);
    return runtime;
  }

  // Selecting a profile in this browser must not change which profile other
  // clients of the same server are using, so the choice is only remembered here.
  async function setActiveProfile({ id } = {}) {
    const runtime = await request(`/v1/porvoz/runtime?profileId=${encodeURIComponent(id)}`);
    writeStoredProfileId(id);
    return runtime;
  }

  async function getConnectionSettings() {
    return request(`/v1/porvoz/profiles/${encodeURIComponent(await activeProfileId())}/connection`);
  }

  async function getSetupStatus() {
    return request(`/v1/porvoz/setup?profileId=${encodeURIComponent(await activeProfileId())}`);
  }

  async function saveConnection(value) {
    return request(`/v1/porvoz/profiles/${encodeURIComponent(await activeProfileId())}/connection`, {
      method: "PUT",
      json: value
    });
  }

  async function populateModels({ signal } = {}) {
    return request(`/v1/porvoz/profiles/${encodeURIComponent(await activeProfileId())}/models`, {
      method: "POST",
      signal
    });
  }

  async function saveModelSelections(value) {
    return request(`/v1/porvoz/profiles/${encodeURIComponent(await activeProfileId())}/models`, {
      method: "PUT",
      json: value
    });
  }

  async function savePrefixSettings(value) {
    await request("/v1/porvoz/prefixes", { method: "PUT", json: value });
    return getRuntimeConfig();
  }

  async function createProfile(value) {
    const runtime = await request("/v1/porvoz/profiles", { method: "POST", json: value });
    writeStoredProfileId(runtime.activeProfileId);
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
    writeStoredProfileId("");
    return getRuntimeConfig();
  }

  async function resetToDefaults() {
    await request("/v1/porvoz/reset", { method: "POST" });
    writeStoredProfileId("");
    return getRuntimeConfig();
  }

  async function getInferenceKey() {
    return request(`/v1/porvoz/profiles/${encodeURIComponent(await activeProfileId())}/inference-key`);
  }

  async function rotateInferenceKey() {
    return request(`/v1/porvoz/profiles/${encodeURIComponent(await activeProfileId())}/inference-key`, {
      method: "POST"
    });
  }

  // Browser capture sends no clipboard or selected-text context: the page never
  // reads either, and a prefix that permits clipboard context simply receives
  // nothing here.
  async function transcribe({ audio, mimeType, timing } = {}, { signal } = {}) {
    const form = new FormData();
    form.set("model", await activeProfileId());
    form.set("response_format", "json");
    if (timing && typeof timing === "object") {
      form.set("porvoz_timing", JSON.stringify(timing));
    }
    form.set("file", new Blob([audio], { type: mimeType }), audioFileName(mimeType));
    const result = await request("/v1/audio/transcriptions", { method: "POST", body: form, signal });
    return {
      transcript: result.text,
      rawTranscript: result.porvoz?.raw_transcript || result.text,
      instructionApplied: result.porvoz?.instruction_applied === true,
      webSearchUsed: result.porvoz?.web_search_used === true,
      logGroupId: result.porvoz?.log_group_id || "",
      ...(result.porvoz?.timing ? { timing: result.porvoz.timing } : {})
    };
  }

  async function createPrefixFromVoice({ audio, mimeType } = {}, { signal } = {}) {
    const form = new FormData();
    form.set("model", await activeProfileId());
    form.set("file", new Blob([audio], { type: mimeType }), audioFileName(mimeType, "prefix-brief"));
    return request("/v1/porvoz/prefixes/from-audio", { method: "POST", body: form, signal });
  }

  async function activeProfileId() {
    return readStoredProfileId() || (await getRuntimeConfig()).activeProfileId;
  }
}

function readStoredProfileId() {
  try {
    return window.localStorage.getItem(PROFILE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function writeStoredProfileId(profileId) {
  try {
    if (profileId) window.localStorage.setItem(PROFILE_STORAGE_KEY, profileId);
    else window.localStorage.removeItem(PROFILE_STORAGE_KEY);
  } catch {
    // A browser with site data blocked still works; it simply falls back to
    // the server's active profile on every page load.
  }
}

function noSubscription() {
  return () => {};
}

function audioFileName(mimeType = "", stem = "transcription") {
  const type = mimeType.toLocaleLowerCase();
  const extension = type.includes("mp4") ? "mp4"
    : type.includes("mpeg") ? "mp3"
      : type.includes("ogg") ? "ogg"
        : type.includes("wav") ? "wav"
          : "webm";
  return `${stem}.${extension}`;
}
