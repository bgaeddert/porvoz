import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export function createDesktopPreferences({ preferencesPath, safeStorage, legacySettings = {} }) {
  let state = readState();

  return {
    getBackendSettings,
    saveBackendSettings,
    getRemoteAdminKey,
    getActiveProfileId,
    setActiveProfileId,
    getHotkey: () => structuredClone(state.hotkey),
    saveHotkey,
    getSoundVolume: () => state.soundVolume,
    saveSoundVolume,
    resetCaptureSettings
  };

  function readState() {
    if (existsSync(preferencesPath)) {
      try {
        return normalize(JSON.parse(readFileSync(preferencesPath, "utf8")));
      } catch (error) {
        throw new Error(`The desktop preferences could not be read: ${error.message}`);
      }
    }
    const initial = normalize({
      hotkey: legacySettings.hotkey,
      soundVolume: legacySettings.soundVolume
    });
    writeState(initial);
    return initial;
  }

  function normalize(value) {
    return {
      backend: {
        mode: value?.backend?.mode === "remote" ? "remote" : "local",
        remoteUrl: normalizeUrl(value?.backend?.remoteUrl),
        encryptedAdminKey: typeof value?.backend?.encryptedAdminKey === "string"
          ? value.backend.encryptedAdminKey
          : ""
      },
      activeProfiles: value?.activeProfiles && typeof value.activeProfiles === "object"
        ? { ...value.activeProfiles }
        : {},
      hotkey: value?.hotkey && typeof value.hotkey === "object"
        ? structuredClone(value.hotkey)
        : { key: "ControlRight", modifiers: [], label: "Right Ctrl" },
      soundVolume: normalizeVolume(value?.soundVolume)
    };
  }

  function getBackendSettings() {
    return {
      mode: state.backend.mode,
      remoteUrl: state.backend.remoteUrl,
      adminKeyConfigured: Boolean(state.backend.encryptedAdminKey)
    };
  }

  function saveBackendSettings({ mode, remoteUrl, adminKey } = {}) {
    const nextMode = mode === "remote" ? "remote" : mode === "local" ? "local" : "";
    if (!nextMode) throw new Error("Choose the local or remote backend.");
    const nextUrl = normalizeUrl(remoteUrl);
    if (nextMode === "remote" && !isHttpUrl(nextUrl)) {
      throw new Error("Enter a valid HTTP or HTTPS remote server URL.");
    }
    state.backend.mode = nextMode;
    state.backend.remoteUrl = nextUrl;
    if (typeof adminKey === "string" && adminKey.trim()) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("The operating system credential protection service is unavailable.");
      }
      state.backend.encryptedAdminKey = safeStorage.encryptString(adminKey.trim()).toString("base64");
    }
    if (nextMode === "remote" && !state.backend.encryptedAdminKey) {
      throw new Error("Enter the remote server admin key.");
    }
    save();
    return getBackendSettings();
  }

  function getRemoteAdminKey() {
    if (!state.backend.encryptedAdminKey) return "";
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("The operating system credential protection service is unavailable.");
    }
    try {
      return safeStorage.decryptString(Buffer.from(state.backend.encryptedAdminKey, "base64"));
    } catch {
      throw new Error("The saved remote server admin key could not be decrypted.");
    }
  }

  function getActiveProfileId(backendIdentity) {
    return typeof state.activeProfiles[backendIdentity] === "string"
      ? state.activeProfiles[backendIdentity]
      : "";
  }

  function setActiveProfileId(backendIdentity, profileId) {
    if (!backendIdentity || !profileId) return;
    state.activeProfiles[backendIdentity] = profileId;
    save();
  }

  function saveHotkey(value) {
    state.hotkey = structuredClone(value);
    save();
    return structuredClone(state.hotkey);
  }

  function saveSoundVolume(value) {
    state.soundVolume = normalizeVolume(value);
    save();
    return state.soundVolume;
  }

  function resetCaptureSettings(defaults = {}) {
    state.hotkey = structuredClone(defaults.hotkey || { key: "ControlRight", modifiers: [], label: "Right Ctrl" });
    state.soundVolume = normalizeVolume(defaults.soundVolume);
    save();
  }

  function save() {
    writeState(state);
  }

  function writeState(value) {
    const temporaryPath = `${preferencesPath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(temporaryPath, preferencesPath);
  }
}

function normalizeUrl(value) {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function normalizeVolume(value) {
  const number = Number(value);
  return Math.min(1, Math.max(0, Number.isFinite(number) ? number : 0.3));
}
