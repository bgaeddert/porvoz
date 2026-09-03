import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { safeStorage } from "electron";

// Upgrade an untouched v1.2.1 prompt to the current packaged prompt while
// preserving any prompt the user actually edited.
const RELEASED_DEFAULT_PROMPT_SHA256 = "c6c4242e2ff03c816f88aa8cfa531b654f8f0e2ce544072474c2c985fbed608d";

export function createSettingsStore({ defaultsPath, settingsPath, credentialsPath }) {
  const defaults = readJson(defaultsPath, "The packaged defaults could not be read.");
  let settings;
  let apiKey = "";

  if (existsSync(settingsPath)) {
    settings = readJson(settingsPath, "The saved settings could not be read.");
    validateSettings(settings);
    const normalizedPrefixes = normalizePrefixEntries(settings.prefixes, defaults.limits.maxPrefixes);
    const normalizedSoundVolume = normalizeSoundVolume(settings.soundVolume, defaults.soundVolume);
    const normalizedInstructionReasoning = normalizeInstructionReasoning(
      settings.models.instructionReasoning,
      defaults.models?.instructionReasoning
    );
    const normalizedPrompt = normalizePrompt(settings.prompt, defaults.prompt);
    if (JSON.stringify(normalizedPrefixes) !== JSON.stringify(settings.prefixes)
      || settings.soundVolume !== normalizedSoundVolume
      || settings.models.instructionReasoning !== normalizedInstructionReasoning
      || settings.prompt !== normalizedPrompt) {
      settings.prefixes = normalizedPrefixes;
      settings.soundVolume = normalizedSoundVolume;
      settings.models.instructionReasoning = normalizedInstructionReasoning;
      settings.prompt = normalizedPrompt;
      saveSettingsFile();
    }
  } else {
    settings = createInitialSettings(defaults);
    saveSettingsFile();
  }

  apiKey = readApiKey();

  return {
    getLimits: () => clone(defaults.limits),
    getSettings,
    getApiKey: () => apiKey,
    saveConnection,
    saveModelCatalog,
    saveModelSelections,
    savePrompt,
    resetPrompt,
    savePrefixSettings,
    getHotkey,
    saveHotkey,
    saveSoundVolume,
    resetToDefaults
  };

  function getSettings() {
    return clone(settings);
  }

  function saveConnection({ baseUrl, apiKey: nextApiKey, verifyCertificate } = {}) {
    if (settings.connection.baseUrl !== baseUrl) {
      settings.models.available = [];
      settings.models.transcription = "";
      settings.models.instruction = "";
    }
    settings.connection.baseUrl = typeof baseUrl === "string" ? baseUrl : "";
    settings.connection.verifyCertificate = typeof verifyCertificate === "boolean"
      ? verifyCertificate
      : settings.connection.verifyCertificate !== false;
    if (typeof nextApiKey === "string" && nextApiKey.trim()) {
      apiKey = nextApiKey.trim();
      saveApiKey(apiKey);
    }
    saveSettingsFile();
  }

  function saveModelCatalog(models) {
    if (!Array.isArray(models) || !models.length) {
      throw new Error("The model endpoint returned no models.");
    }
    const available = uniqueStrings(models);
    settings.models.available = available;
    saveSettingsFile();
    return available;
  }

  function saveModelSelections({ transcription, instruction, instructionReasoning } = {}) {
    if (transcription !== undefined) {
      const nextTranscription = normalizeModel(transcription);
      settings.models.transcription = nextTranscription;
    }
    if (instruction !== undefined) {
      const nextInstruction = normalizeModel(instruction);
      settings.models.instruction = nextInstruction;
    }
    if (instructionReasoning !== undefined) {
      const nextInstructionReasoning = normalizeInstructionReasoning(instructionReasoning, "");
      if (!nextInstructionReasoning) {
        throw new Error("Choose low, medium, or high reasoning for the instruction model.");
      }
      settings.models.instructionReasoning = nextInstructionReasoning;
    }
    saveSettingsFile();
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
    apiKey = "";
    if (existsSync(credentialsPath)) unlinkSync(credentialsPath);
    saveSettingsFile();
    return getSettings();
  }

  function readApiKey() {
    if (!existsSync(credentialsPath)) return "";
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("The operating system credential store is unavailable.");
    }
    try {
      return safeStorage.decryptString(readFileSync(credentialsPath));
    } catch (error) {
      console.error("Could not decrypt the saved API key:", error.message);
      throw new Error("The saved API key could not be decrypted.");
    }
  }

  function saveApiKey(value) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("The operating system credential store is unavailable.");
    }
    writeFileAtomically(credentialsPath, safeStorage.encryptString(value));
  }

  function saveSettingsFile() {
    writeJsonAtomically(settingsPath, settings);
  }
}

function createInitialSettings(defaults) {
  if (!defaults?.limits || typeof defaults.prompt !== "string" || !Array.isArray(defaults.prefixes)) {
    throw new Error("The packaged defaults are invalid.");
  }
  return {
    connection: {
      baseUrl: typeof defaults.connection?.baseUrl === "string" ? defaults.connection.baseUrl : "",
      verifyCertificate: defaults.connection?.verifyCertificate !== false
    },
    models: {
      available: [],
      transcription: "",
      instruction: "",
      instructionReasoning: normalizeInstructionReasoning(
        defaults.models?.instructionReasoning,
        "low"
      )
    },
    prompt: defaults.prompt,
    prefixes: normalizePrefixEntries(defaults.prefixes, defaults.limits.maxPrefixes),
    hotkey: clone(defaults.hotkey),
    soundVolume: normalizeSoundVolume(defaults.soundVolume, 0.3)
  };
}

function validateSettings(settings) {
  if (!settings
    || typeof settings !== "object"
    || !settings.connection
    || !settings.models
    || !Array.isArray(settings.models.available)
    || typeof settings.models.transcription !== "string"
    || typeof settings.models.instruction !== "string"
    || typeof settings.prompt !== "string"
    || !Array.isArray(settings.prefixes)
    || !settings.hotkey) {
    throw new Error("The saved settings are invalid.");
  }
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
