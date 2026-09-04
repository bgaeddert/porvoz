import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createSqliteDatabase } from "./sqlite-database.js";

const STATE_ID = 1;

export async function createServerStore({ databasePath, defaultsPath, masterKey }) {
  if (!databasePath) throw new Error("PORVOZ_DATABASE_PATH is required.");
  if (!masterKey) throw new Error("PORVOZ_MASTER_KEY is required.");
  const defaults = readJson(defaultsPath, "The packaged defaults could not be read.");
  const database = await createSqliteDatabase(databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      settings_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS provider_credentials (
      profile_id TEXT PRIMARY KEY,
      encrypted_value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inference_keys (
      profile_id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      entry_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS activity_logs_created_at
      ON activity_logs(created_at DESC);
  `);
  const encryptionKey = createHash("sha256").update(String(masterKey)).digest();
  let settings = loadSettings();
  ensureInferenceKeys();

  return {
    getLimits: () => clone(defaults.limits),
    getSettings: () => clone(settings),
    getApiKey,
    hasApiKey,
    saveConnection,
    saveModelCatalog,
    saveModelSelections,
    savePrompt,
    resetPrompt,
    savePrefixSettings,
    addProfile,
    renameProfile,
    deleteProfile,
    setActiveProfile,
    resetToDefaults,
    getInferenceKey,
    rotateInferenceKey,
    resolveInferenceKey,
    importLegacy,
    getDatabase: () => database,
    close: () => database.close()
  };

  function loadSettings() {
    const row = database.prepare("SELECT settings_json FROM state WHERE id = ?").get(STATE_ID);
    if (!row) {
      const initial = createInitialSettings(defaults);
      database.prepare("INSERT INTO state (id, settings_json) VALUES (?, ?)")
        .run(STATE_ID, JSON.stringify(initial));
      return initial;
    }
    const parsed = JSON.parse(row.settings_json);
    return normalizeSettings(parsed, defaults);
  }

  function saveSettings() {
    database.prepare("UPDATE state SET settings_json = ? WHERE id = ?")
      .run(JSON.stringify(settings), STATE_ID);
  }

  function getProfile(profileId) {
    const id = profileId || settings.activeProfileId;
    const profile = settings.profiles.find((candidate) => candidate.id === id);
    if (!profile) throw new Error("The requested connection profile does not exist.");
    return profile;
  }

  function saveConnection({ profileId, baseUrl, apiKey, verifyCertificate } = {}) {
    const profile = getProfile(profileId);
    const nextBaseUrl = typeof baseUrl === "string" ? baseUrl : "";
    if (profile.connection.baseUrl !== nextBaseUrl) {
      profile.models.available = [];
      profile.models.transcription = "";
      profile.models.instruction = "";
    }
    profile.connection.baseUrl = nextBaseUrl;
    profile.connection.verifyCertificate = verifyCertificate !== false;
    if (typeof apiKey === "string" && apiKey.trim()) {
      database.prepare(`
        INSERT INTO provider_credentials (profile_id, encrypted_value) VALUES (?, ?)
        ON CONFLICT(profile_id) DO UPDATE SET encrypted_value = excluded.encrypted_value
      `).run(profile.id, encrypt(apiKey.trim()));
    }
    saveSettings();
  }

  function getApiKey(profileId) {
    const profile = getProfile(profileId);
    const row = database.prepare("SELECT encrypted_value FROM provider_credentials WHERE profile_id = ?")
      .get(profile.id);
    return row ? decrypt(row.encrypted_value) : "";
  }

  function hasApiKey(profileId) {
    const profile = getProfile(profileId);
    return Boolean(database.prepare("SELECT 1 FROM provider_credentials WHERE profile_id = ?")
      .get(profile.id));
  }

  function saveModelCatalog(profileId, models) {
    const available = uniqueStrings(models);
    if (!available.length) throw new Error("The model endpoint returned no models.");
    getProfile(profileId).models.available = available;
    saveSettings();
    return available;
  }

  function saveModelSelections(profileId, value = {}) {
    const profile = getProfile(profileId);
    if (value.transcription !== undefined) profile.models.transcription = normalizeText(value.transcription);
    if (value.instruction !== undefined) profile.models.instruction = normalizeText(value.instruction);
    if (value.instructionReasoning !== undefined) {
      const reasoning = normalizeReasoning(value.instructionReasoning, "");
      if (!reasoning) throw new Error("Choose low, medium, or high reasoning for the instruction model.");
      profile.models.instructionReasoning = reasoning;
    }
    saveSettings();
  }

  function savePrompt(prompt) {
    if (typeof prompt !== "string") throw new Error("The instruction prompt must be text.");
    settings.prompt = prompt;
    saveSettings();
  }

  function resetPrompt() {
    settings.prompt = defaults.prompt;
    saveSettings();
    return settings.prompt;
  }

  function savePrefixSettings({ prefixes } = {}) {
    settings.prefixes = normalizePrefixes(prefixes, defaults.limits.maxPrefixes);
    saveSettings();
  }

  function addProfile({ name } = {}) {
    if (settings.profiles.length >= defaults.limits.maxProfiles) {
      throw new Error(`You can save up to ${defaults.limits.maxProfiles} connection profiles.`);
    }
    const finalName = normalizeProfileName(name, defaults.limits.maxProfileNameCharacters)
      || generateProfileName();
    ensureUniqueProfileName(finalName);
    const profile = {
      id: randomUUID(),
      name: finalName,
      connection: { baseUrl: "", verifyCertificate: true },
      models: { available: [], transcription: "", instruction: "", instructionReasoning: "low" }
    };
    settings.profiles.push(profile);
    settings.activeProfileId = profile.id;
    saveSettings();
    ensureInferenceKey(profile.id);
    return clone(profile);
  }

  function renameProfile({ id, name } = {}) {
    const profile = getProfile(id);
    const nextName = normalizeProfileName(name, defaults.limits.maxProfileNameCharacters);
    if (!nextName) throw new Error("Enter a name for the connection profile.");
    ensureUniqueProfileName(nextName, profile.id);
    profile.name = nextName;
    saveSettings();
    return clone(profile);
  }

  function deleteProfile({ id } = {}) {
    if (settings.profiles.length <= 1) throw new Error("Keep at least one connection profile.");
    const index = settings.profiles.findIndex((profile) => profile.id === id);
    if (index < 0) throw new Error("The requested connection profile does not exist.");
    const transaction = database.transaction(() => {
      settings.profiles.splice(index, 1);
      database.prepare("DELETE FROM provider_credentials WHERE profile_id = ?").run(id);
      database.prepare("DELETE FROM inference_keys WHERE profile_id = ?").run(id);
      if (settings.activeProfileId === id) settings.activeProfileId = settings.profiles[0].id;
      saveSettings();
    });
    transaction();
    return clone(getProfile(settings.activeProfileId));
  }

  function setActiveProfile({ id } = {}) {
    const profile = getProfile(id);
    settings.activeProfileId = profile.id;
    saveSettings();
    return clone(profile);
  }

  function resetToDefaults() {
    const transaction = database.transaction(() => {
      settings = createInitialSettings(defaults);
      database.prepare("DELETE FROM provider_credentials").run();
      database.prepare("DELETE FROM inference_keys").run();
      database.prepare("DELETE FROM activity_logs").run();
      saveSettings();
      ensureInferenceKeys();
    });
    transaction();
    return clone(settings);
  }

  function getInferenceKey(profileId) {
    const profile = getProfile(profileId);
    ensureInferenceKey(profile.id);
    return database.prepare("SELECT api_key FROM inference_keys WHERE profile_id = ?")
      .get(profile.id).api_key;
  }

  function rotateInferenceKey(profileId) {
    const profile = getProfile(profileId);
    const key = createInferenceKey();
    database.prepare(`
      INSERT INTO inference_keys (profile_id, api_key) VALUES (?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET api_key = excluded.api_key
    `).run(profile.id, key);
    return key;
  }

  function resolveInferenceKey(apiKey) {
    if (typeof apiKey !== "string" || !apiKey) return null;
    const row = database.prepare("SELECT profile_id FROM inference_keys WHERE api_key = ?").get(apiKey);
    return row?.profile_id || null;
  }

  function ensureInferenceKeys() {
    for (const profile of settings.profiles) ensureInferenceKey(profile.id);
  }

  function ensureInferenceKey(profileId) {
    const existing = database.prepare("SELECT 1 FROM inference_keys WHERE profile_id = ?").get(profileId);
    if (!existing) {
      database.prepare("INSERT INTO inference_keys (profile_id, api_key) VALUES (?, ?)")
        .run(profileId, createInferenceKey());
    }
  }

  function importLegacy({ settings: legacySettings, providerKeys = {} } = {}) {
    if (!legacySettings?.profiles?.length) return false;
    const imported = normalizeSettings(legacySettings, defaults);
    const transaction = database.transaction(() => {
      settings = imported;
      database.prepare("DELETE FROM provider_credentials").run();
      database.prepare("DELETE FROM inference_keys").run();
      for (const profile of settings.profiles) {
        const value = providerKeys[profile.id];
        if (typeof value === "string" && value) {
          database.prepare("INSERT INTO provider_credentials (profile_id, encrypted_value) VALUES (?, ?)")
            .run(profile.id, encrypt(value));
        }
      }
      saveSettings();
      ensureInferenceKeys();
    });
    transaction();
    return true;
  }

  function ensureUniqueProfileName(name, excludeId) {
    const normalizedName = name.toLocaleLowerCase();
    if (settings.profiles.some((profile) =>
      profile.id !== excludeId && profile.name.toLocaleLowerCase() === normalizedName)) {
      throw new Error(`The connection profile name “${name}” is already in use.`);
    }
  }

  function generateProfileName() {
    const names = new Set(settings.profiles.map((profile) => profile.name.toLocaleLowerCase()));
    let index = settings.profiles.length + 1;
    while (names.has(`connection ${index}`)) index += 1;
    return `Connection ${index}`;
  }

  function encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
  }

  function decrypt(value) {
    const [version, iv, tag, ciphertext] = String(value).split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("The stored provider credential is invalid.");
    try {
      const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64")),
        decipher.final()
      ]).toString("utf8");
    } catch {
      throw new Error("The stored provider credential could not be decrypted with this server master key.");
    }
  }
}

function createInitialSettings(defaults) {
  return normalizeSettings({
    profiles: defaults.profiles,
    prompt: defaults.prompt,
    prefixes: defaults.prefixes
  }, defaults);
}

function normalizeSettings(value, defaults) {
  const profiles = normalizeProfiles(value?.profiles, defaults);
  return {
    profiles,
    activeProfileId: profiles.some((profile) => profile.id === value?.activeProfileId)
      ? value.activeProfileId
      : profiles[0].id,
    prompt: typeof value?.prompt === "string" ? value.prompt : defaults.prompt,
    prefixes: normalizePrefixes(value?.prefixes, defaults.limits.maxPrefixes)
  };
}

function normalizeProfiles(value, defaults) {
  const source = Array.isArray(value) && value.length ? value : defaults.profiles;
  const ids = new Set();
  const names = new Set();
  return source.slice(0, defaults.limits.maxProfiles).map((entry, index) => {
    let id = normalizeText(entry?.id) || randomUUID();
    while (ids.has(id)) id = randomUUID();
    ids.add(id);
    let name = normalizeProfileName(entry?.name, defaults.limits.maxProfileNameCharacters)
      || `Connection ${index + 1}`;
    while (names.has(name.toLocaleLowerCase())) name = `${name} (${randomUUID().slice(0, 4)})`;
    names.add(name.toLocaleLowerCase());
    return {
      id,
      name,
      connection: {
        baseUrl: typeof entry?.connection?.baseUrl === "string" ? entry.connection.baseUrl : "",
        verifyCertificate: entry?.connection?.verifyCertificate !== false
      },
      models: {
        available: uniqueStrings(entry?.models?.available),
        transcription: normalizeText(entry?.models?.transcription),
        instruction: normalizeText(entry?.models?.instruction),
        instructionReasoning: normalizeReasoning(entry?.models?.instructionReasoning)
      }
    };
  });
}

function normalizePrefixes(value, maxPrefixes) {
  const prefixes = [];
  const names = new Set();
  for (const [index, entry] of (Array.isArray(value) ? value : []).entries()) {
    const name = normalizeText(entry?.name);
    const instruction = normalizeText(entry?.instruction);
    if (!name || !instruction || names.has(name.toLocaleLowerCase())) continue;
    names.add(name.toLocaleLowerCase());
    prefixes.push({
      id: normalizeText(entry?.id) || `prefix-${index + 1}`,
      name,
      instruction,
      allowSearch: entry?.allowSearch === true,
      allowClipboard: entry?.allowClipboard === true
    });
  }
  return prefixes.slice(0, Number(maxPrefixes) || 100);
}

function normalizeReasoning(value, fallback = "low") {
  const candidate = normalizeText(value).toLocaleLowerCase();
  if (["low", "medium", "high"].includes(candidate)) return candidate;
  const normalizedFallback = normalizeText(fallback).toLocaleLowerCase();
  return ["low", "medium", "high"].includes(normalizedFallback) ? normalizedFallback : "low";
}

function normalizeProfileName(value, maxLength) {
  return normalizeText(value).slice(0, Number(maxLength) || 60);
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(normalizeText)
    .filter(Boolean))];
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createInferenceKey() {
  return `porvoz_${randomBytes(24).toString("base64url")}`;
}

function readJson(filePath, errorMessage) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(errorMessage);
  }
}

function clone(value) {
  return structuredClone(value);
}
