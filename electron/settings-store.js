import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { safeStorage } from "electron";

// Upgrade an untouched v1.2.1 prompt to the current packaged prompt while
// preserving any prompt the user actually edited.
const RELEASED_DEFAULT_PROMPT_SHA256 = "c6c4242e2ff03c816f88aa8cfa531b654f8f0e2ce544072474c2c985fbed608d";

// Pre-profiles installs kept one connection/model set at the settings root and
// a single raw encrypted buffer in the credentials file. This id lets both
// migrate deterministically into the new multi-profile shape on first load.
const LEGACY_PROFILE_ID = "default";

export function createSettingsStore({ defaultsPath, settingsPath, credentialsPath }) {
  const defaults = readJson(defaultsPath, "The packaged defaults could not be read.");
  let settings;
  let credentials;

  if (existsSync(settingsPath)) {
    const rawSettings = readJson(settingsPath, "The saved settings could not be read.");
    settings = migrateSettings(rawSettings, defaults);
    validateSettings(settings);
    if (JSON.stringify(settings) !== JSON.stringify(rawSettings)) saveSettingsFile();
  } else {
    settings = createInitialSettings(defaults);
    saveSettingsFile();
  }

  const { map: credentialsMap, legacy: hadLegacyCredentials } = readCredentialsFile(credentialsPath);
  credentials = credentialsMap;
  const apiKeyCache = new Map();
  if (hadLegacyCredentials) saveCredentialsFile();

  return {
    getLimits: () => clone(defaults.limits),
    getSettings,
    getApiKey,
    hasApiKey,
    saveConnection,
    saveModelCatalog,
    saveModelSelections,
    savePrompt,
    resetPrompt,
    savePrefixSettings,
    getHotkey,
    saveHotkey,
    saveSoundVolume,
    addProfile,
    renameProfile,
    deleteProfile,
    setActiveProfile,
    resetToDefaults
  };

  function getSettings() {
    return clone(settings);
  }

  function getProfile(id) {
    const profile = settings.profiles.find((candidate) => candidate.id === id);
    if (!profile) throw new Error("The requested connection profile does not exist.");
    return profile;
  }

  function resolveProfileId(profileId) {
    return typeof profileId === "string" && profileId ? profileId : settings.activeProfileId;
  }

  function saveConnection({ profileId, baseUrl, apiKey: nextApiKey, verifyCertificate } = {}) {
    const profile = getProfile(resolveProfileId(profileId));
    if (profile.connection.baseUrl !== baseUrl) {
      profile.models.available = [];
      profile.models.transcription = "";
      profile.models.instruction = "";
    }
    profile.connection.baseUrl = typeof baseUrl === "string" ? baseUrl : "";
    profile.connection.verifyCertificate = typeof verifyCertificate === "boolean"
      ? verifyCertificate
      : profile.connection.verifyCertificate !== false;
    if (typeof nextApiKey === "string" && nextApiKey.trim()) {
      saveApiKey(profile.id, nextApiKey.trim());
    }
    saveSettingsFile();
  }

  function saveModelCatalog(profileId, models) {
    if (!Array.isArray(models) || !models.length) {
      throw new Error("The model endpoint returned no models.");
    }
    const profile = getProfile(resolveProfileId(profileId));
    const available = uniqueStrings(models);
    profile.models.available = available;
    saveSettingsFile();
    return available;
  }

  function saveModelSelections(profileId, { transcription, instruction, instructionReasoning } = {}) {
    const profile = getProfile(resolveProfileId(profileId));
    if (transcription !== undefined) {
      profile.models.transcription = normalizeModel(transcription);
    }
    if (instruction !== undefined) {
      profile.models.instruction = normalizeModel(instruction);
    }
    if (instructionReasoning !== undefined) {
      const nextInstructionReasoning = normalizeInstructionReasoning(instructionReasoning, "");
      if (!nextInstructionReasoning) {
        throw new Error("Choose low, medium, or high reasoning for the instruction model.");
      }
      profile.models.instructionReasoning = nextInstructionReasoning;
    }
    saveSettingsFile();
  }

  function addProfile({ name } = {}) {
    if (settings.profiles.length >= defaults.limits.maxProfiles) {
      throw new Error(`You can save up to ${defaults.limits.maxProfiles} connection profiles.`);
    }
    const requestedName = normalizeProfileName(name, defaults.limits.maxProfileNameCharacters);
    const finalName = requestedName || generateProfileName();
    ensureUniqueProfileName(finalName);
    const profile = {
      id: randomUUID(),
      name: finalName,
      connection: { baseUrl: "", verifyCertificate: true },
      models: { available: [], transcription: "", instruction: "", instructionReasoning: "low" }
    };
    settings.profiles.push(profile);
    settings.activeProfileId = profile.id;
    saveSettingsFile();
    return clone(profile);
  }

  function renameProfile({ id, name } = {}) {
    const profile = getProfile(id);
    const nextName = normalizeProfileName(name, defaults.limits.maxProfileNameCharacters);
    if (!nextName) throw new Error("Enter a name for the connection profile.");
    ensureUniqueProfileName(nextName, profile.id);
    profile.name = nextName;
    saveSettingsFile();
    return clone(profile);
  }

  function deleteProfile({ id } = {}) {
    if (settings.profiles.length <= 1) throw new Error("Keep at least one connection profile.");
    const index = settings.profiles.findIndex((profile) => profile.id === id);
    if (index < 0) throw new Error("The requested connection profile does not exist.");
    settings.profiles.splice(index, 1);
    deleteApiKey(id);
    if (settings.activeProfileId === id) {
      settings.activeProfileId = settings.profiles[0].id;
    }
    saveSettingsFile();
    return clone(getProfile(settings.activeProfileId));
  }

  function setActiveProfile({ id } = {}) {
    const profile = getProfile(id);
    settings.activeProfileId = id;
    saveSettingsFile();
    return clone(profile);
  }

  function ensureUniqueProfileName(name, excludeId) {
    const normalizedName = name.toLocaleLowerCase();
    const duplicate = settings.profiles.some((profile) =>
      profile.id !== excludeId && profile.name.toLocaleLowerCase() === normalizedName);
    if (duplicate) throw new Error(`The connection profile name “${name}” is already in use.`);
  }

  function generateProfileName() {
    const usedNames = new Set(settings.profiles.map((profile) => profile.name.toLocaleLowerCase()));
    let counter = settings.profiles.length + 1;
    let candidate = `Connection ${counter}`;
    while (usedNames.has(candidate.toLocaleLowerCase())) {
      counter += 1;
      candidate = `Connection ${counter}`;
    }
    return candidate;
  }

  function savePrompt(prompt) {
    if (typeof prompt !== "string") throw new Error("The instruction prompt must be text.");
    settings.prompt = prompt;
    saveSettingsFile();
  }

  function resetPrompt() {
    settings.prompt = defaults.prompt;
    saveSettingsFile();
    return settings.prompt;
  }

  function savePrefixSettings({ prefixes } = {}) {
    settings.prefixes = normalizePrefixEntries(prefixes, defaults.limits.maxPrefixes);
    saveSettingsFile();
  }

  function getHotkey() {
    return clone(settings.hotkey);
  }

  function saveHotkey(hotkey) {
    settings.hotkey = clone(hotkey);
    saveSettingsFile();
    return getHotkey();
  }

  function saveSoundVolume(value) {
    settings.soundVolume = normalizeSoundVolume(value, settings.soundVolume);
    saveSettingsFile();
    return settings.soundVolume;
  }

  function resetToDefaults() {
    settings = createInitialSettings(defaults);
    credentials = {};
    apiKeyCache.clear();
    if (existsSync(credentialsPath)) unlinkSync(credentialsPath);
    saveSettingsFile();
    return getSettings();
  }

  function hasApiKey(profileId) {
    return Boolean(credentials[resolveProfileId(profileId)]);
  }

  function getApiKey(profileId) {
    const id = resolveProfileId(profileId);
    if (apiKeyCache.has(id)) return apiKeyCache.get(id);
    const key = decryptApiKey(id);
    apiKeyCache.set(id, key);
    return key;
  }

  function decryptApiKey(id) {
    const encoded = credentials[id];
    if (!encoded) return "";
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("The operating system credential store is unavailable.");
    }
    try {
      return safeStorage.decryptString(Buffer.from(encoded, "base64"));
    } catch (error) {
      console.error("Could not decrypt the saved API key:", error.message);
      throw new Error("The saved API key could not be decrypted.");
    }
  }

  function saveApiKey(id, value) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("The operating system credential store is unavailable.");
    }
    credentials[id] = safeStorage.encryptString(value).toString("base64");
    apiKeyCache.set(id, value);
    saveCredentialsFile();
  }

  function deleteApiKey(id) {
    if (!(id in credentials)) return;
    delete credentials[id];
    apiKeyCache.delete(id);
    saveCredentialsFile();
  }

  function saveSettingsFile() {
    writeJsonAtomically(settingsPath, settings);
  }

  function saveCredentialsFile() {
    writeJsonAtomically(credentialsPath, credentials);
  }
}

function migrateSettings(rawSettings, defaults) {
  if (Array.isArray(rawSettings?.profiles)) return normalizeSettingsShape(rawSettings, defaults);

  const migrated = { ...rawSettings };
  migrated.profiles = [{
    id: LEGACY_PROFILE_ID,
    name: "Default",
    connection: rawSettings?.connection,
    models: rawSettings?.models
  }];
  migrated.activeProfileId = LEGACY_PROFILE_ID;
  delete migrated.connection;
  delete migrated.models;
  return normalizeSettingsShape(migrated, defaults);
}

function normalizeSettingsShape(rawSettings, defaults) {
  const normalizedPrompt = normalizePrompt(rawSettings?.prompt, defaults.prompt);
  const profiles = normalizeProfileEntries(rawSettings?.profiles, defaults);
  const activeProfileId = profiles.some((profile) => profile.id === rawSettings?.activeProfileId)
    ? rawSettings.activeProfileId
    : profiles[0].id;
  return {
    ...rawSettings,
    profiles,
    activeProfileId,
    prefixes: normalizePrefixEntries(rawSettings?.prefixes, defaults.limits.maxPrefixes),
    soundVolume: normalizeSoundVolume(rawSettings?.soundVolume, defaults.soundVolume),
    prompt: normalizedPrompt,
    hotkey: rawSettings?.hotkey ? clone(rawSettings.hotkey) : clone(defaults.hotkey)
  };
}

function normalizeProfileEntries(value, defaults) {
  const entries = Array.isArray(value) && value.length ? value : defaults.profiles;
  const seenIds = new Set();
  const seenNames = new Set();
  return entries.map((entry, index) => {
    let id = normalizeId(entry?.id) || randomUUID();
    while (seenIds.has(id)) id = randomUUID();
    seenIds.add(id);

    let name = normalizeProfileName(entry?.name, defaults.limits.maxProfileNameCharacters);
    if (!name || seenNames.has(name.toLocaleLowerCase())) {
      name = `Connection ${index + 1}`;
      while (seenNames.has(name.toLocaleLowerCase())) {
        name = `${name} (${randomUUID().slice(0, 4)})`;
      }
    }
    seenNames.add(name.toLocaleLowerCase());

    return {
      id,
      name,
      connection: {
        baseUrl: typeof entry?.connection?.baseUrl === "string" ? entry.connection.baseUrl : "",
        verifyCertificate: entry?.connection?.verifyCertificate !== false
      },
      models: {
        available: Array.isArray(entry?.models?.available) ? uniqueStrings(entry.models.available) : [],
        transcription: normalizeModel(entry?.models?.transcription),
        instruction: normalizeModel(entry?.models?.instruction),
        instructionReasoning: normalizeInstructionReasoning(
          entry?.models?.instructionReasoning,
          defaults.profiles?.[0]?.models?.instructionReasoning
        )
      }
    };
  });
}

function createInitialSettings(defaults) {
  if (!defaults?.limits
    || typeof defaults.prompt !== "string"
    || !Array.isArray(defaults.prefixes)
    || !Array.isArray(defaults.profiles)
    || !defaults.profiles.length) {
    throw new Error("The packaged defaults are invalid.");
  }
  const profiles = normalizeProfileEntries(defaults.profiles, defaults);
  return {
    profiles,
    activeProfileId: profiles[0].id,
    prompt: defaults.prompt,
    prefixes: normalizePrefixEntries(defaults.prefixes, defaults.limits.maxPrefixes),
    hotkey: clone(defaults.hotkey),
    soundVolume: normalizeSoundVolume(defaults.soundVolume, 0.3)
  };
}

function validateSettings(settings) {
  if (!settings
    || typeof settings !== "object"
    || !Array.isArray(settings.profiles)
    || !settings.profiles.length
    || !settings.profiles.every(isValidProfile)
    || typeof settings.activeProfileId !== "string"
    || !settings.profiles.some((profile) => profile.id === settings.activeProfileId)
    || typeof settings.prompt !== "string"
    || !Array.isArray(settings.prefixes)
    || !settings.hotkey) {
    throw new Error("The saved settings are invalid.");
  }
}

function isValidProfile(profile) {
  return Boolean(profile)
    && typeof profile.id === "string"
    && typeof profile.name === "string"
    && profile.connection
    && typeof profile.connection.baseUrl === "string"
    && profile.models
    && Array.isArray(profile.models.available)
    && typeof profile.models.transcription === "string"
    && typeof profile.models.instruction === "string";
}

function normalizePrefixEntries(value, maxPrefixes) {
  const entries = Array.isArray(value) ? value : [];
  const seenNames = new Set();
  const prefixes = [];
  entries.forEach((entry, index) => {
    const name = normalizeText(entry?.name);
    const instruction = normalizeText(entry?.instruction);
    const normalizedName = name.toLocaleLowerCase();
    if (!name || !instruction || seenNames.has(normalizedName)) return;
    seenNames.add(normalizedName);
    prefixes.push({
      id: normalizeId(entry?.id) || `prefix-${index + 1}`,
      name,
      instruction,
      allowSearch: entry?.allowSearch === true,
      allowClipboard: entry?.allowClipboard === true
    });
  });

  return prefixes.slice(0, Number(maxPrefixes) || 100);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeId(value) {
  return normalizeText(value);
}

function normalizeProfileName(value, maxLength) {
  const name = normalizeText(value);
  const limit = Number(maxLength) || 60;
  return name.slice(0, limit);
}

function normalizeModel(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePrompt(value, currentDefault) {
  const prompt = typeof value === "string" ? value : "";
  const promptHash = createHash("sha256").update(prompt).digest("hex");
  return promptHash === RELEASED_DEFAULT_PROMPT_SHA256 ? currentDefault : prompt;
}

function normalizeInstructionReasoning(value, fallback = "low") {
  const normalizedValue = typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
  if (["low", "medium", "high"].includes(normalizedValue)) return normalizedValue;
  const normalizedFallback = typeof fallback === "string" ? fallback.trim().toLocaleLowerCase() : "";
  return ["low", "medium", "high"].includes(normalizedFallback) ? normalizedFallback : "low";
}

function normalizeSoundVolume(value, fallback = 0.3) {
  const numericValue = Number(value);
  const numericFallback = Number(fallback);
  const resolvedValue = Number.isFinite(numericValue)
    ? numericValue
    : Number.isFinite(numericFallback)
      ? numericFallback
      : 0.7;
  return Math.min(1, Math.max(0, resolvedValue));
}

function uniqueStrings(values) {
  return [...new Set(values
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean))];
}

function readJson(filePath, errorMessage) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`Could not read ${path.basename(filePath)}:`, error.message);
    throw new Error(errorMessage);
  }
}

function readCredentialsFile(credentialsPath) {
  if (!existsSync(credentialsPath)) return { map: {}, legacy: false };
  const raw = readFileSync(credentialsPath);
  try {
    const parsed = JSON.parse(raw.toString("utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { map: parsed, legacy: false };
    }
  } catch {
    // Not JSON: this is the legacy single-buffer credentials file.
  }
  return { map: { [LEGACY_PROFILE_ID]: raw.toString("base64") }, legacy: true };
}

function writeJsonAtomically(filePath, value) {
  writeFileAtomically(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFileAtomically(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, value);
  renameSync(temporaryPath, filePath);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
