import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";

export function createSettingsStore({ defaultsPath, settingsPath, credentialsPath }) {
  const defaults = readJson(defaultsPath, "The packaged defaults could not be read.");
  const builtInDefaults = normalizeBuiltInEntries(defaults.prefixes);
  let settings;
  let apiKey = "";

  if (existsSync(settingsPath)) {
    settings = readJson(settingsPath, "The saved settings could not be read.");
    validateSettings(settings);
    const normalizedPrefixes = normalizePrefixEntries(
      settings.prefixes,
      defaults.limits.maxPrefixes,
      builtInDefaults
    );
    const normalizedSoundVolume = normalizeSoundVolume(settings.soundVolume, defaults.soundVolume);
    const normalizedInstructionReasoning = normalizeInstructionReasoning(
      settings.models.instructionReasoning,
      defaults.models?.instructionReasoning
    );
    if (JSON.stringify(normalizedPrefixes) !== JSON.stringify(settings.prefixes)
      || settings.soundVolume !== normalizedSoundVolume
      || settings.models.instructionReasoning !== normalizedInstructionReasoning) {
      settings.prefixes = normalizedPrefixes;
      settings.soundVolume = normalizedSoundVolume;
      settings.models.instructionReasoning = normalizedInstructionReasoning;
      saveSettingsFile();
    }
  } else {
    settings = createInitialSettings(defaults, builtInDefaults);
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
    savePrefixes,
    resetBuiltInPrefix,
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
    if (!available.includes(settings.models.transcription)) settings.models.transcription = "";
    if (!available.includes(settings.models.instruction)) settings.models.instruction = "";
    saveSettingsFile();
    return available;
  }

  function saveModelSelections({ transcription, instruction, instructionReasoning } = {}) {
    if (transcription !== undefined) {
      const nextTranscription = normalizeModel(transcription);
      if (nextTranscription && !settings.models.available.includes(nextTranscription)) {
        throw new Error("Choose a transcription model from the loaded models.");
      }
      settings.models.transcription = nextTranscription;
    }
    if (instruction !== undefined) {
      const nextInstruction = normalizeModel(instruction);
      if (nextInstruction && !settings.models.available.includes(nextInstruction)) {
        throw new Error("Choose an instruction model from the loaded models.");
      }
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

  function savePrefixes(prefixes) {
    settings.prefixes = normalizePrefixEntries(prefixes, defaults.limits.maxPrefixes, builtInDefaults);
    saveSettingsFile();
  }

  function resetBuiltInPrefix(id) {
    const builtIn = builtInDefaults.find((prefix) => prefix.id === id);
    if (!builtIn) throw new Error("Choose a built-in prefix to reset.");
    const prefixIndex = settings.prefixes.findIndex((prefix) => prefix.builtIn && prefix.id === id);
    if (prefixIndex === -1) {
      settings.prefixes = normalizePrefixEntries(settings.prefixes, defaults.limits.maxPrefixes, builtInDefaults);
    }
    const normalizedIndex = settings.prefixes.findIndex((prefix) => prefix.builtIn && prefix.id === id);
    if (normalizedIndex === -1) throw new Error("The built-in prefix could not be found.");
    settings.prefixes[normalizedIndex] = clone(builtIn);
    saveSettingsFile();
    return getSettings();
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
    settings = createInitialSettings(defaults, builtInDefaults);
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

function createInitialSettings(defaults, builtInDefaults = normalizeBuiltInEntries(defaults?.prefixes)) {
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
    prefixes: normalizePrefixEntries(defaults.prefixes, defaults.limits.maxPrefixes, builtInDefaults),
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

function normalizeBuiltInEntries(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((prefix, index) => ({
      id: normalizeId(prefix?.id) || `built-in-${index + 1}`,
      name: normalizeText(prefix?.name),
      instruction: normalizeText(prefix?.instruction),
      builtIn: true,
      enabled: typeof prefix?.enabled === "boolean" ? prefix.enabled : true,
      allowSearch: prefix?.allowSearch === true,
      allowClipboard: prefix?.allowClipboard === true
    }))
    .filter((prefix) => prefix.name && prefix.instruction);
}

function normalizePrefixEntries(value, maxPrefixes, builtInDefaults = []) {
  const entries = Array.isArray(value) ? value : [];
  const matchedEntryIndexes = new Set();
  const builtInNames = new Set();
  const builtIns = builtInDefaults.map((defaultPrefix) => {
    const entryIndex = entries.findIndex((entry, index) => {
      if (matchedEntryIndexes.has(index)) return false;
      const entryId = normalizeId(entry?.id);
      const entryName = normalizeText(entry?.name).toLocaleLowerCase();
      return entryId === defaultPrefix.id || entryName === defaultPrefix.name.toLocaleLowerCase();
    });
    if (entryIndex >= 0) matchedEntryIndexes.add(entryIndex);
    const storedPrefix = entryIndex >= 0 ? entries[entryIndex] : undefined;
    const normalizedPrefix = {
      id: defaultPrefix.id,
      name: defaultPrefix.name,
      instruction: normalizeText(storedPrefix?.instruction) || defaultPrefix.instruction,
      builtIn: true,
      enabled: typeof storedPrefix?.enabled === "boolean" ? storedPrefix.enabled : defaultPrefix.enabled,
      allowSearch: typeof storedPrefix?.allowSearch === "boolean"
        ? storedPrefix.allowSearch
        : defaultPrefix.allowSearch,
      allowClipboard: typeof storedPrefix?.allowClipboard === "boolean"
        ? storedPrefix.allowClipboard
        : defaultPrefix.allowClipboard
    };
    builtInNames.add(normalizedPrefix.name.toLocaleLowerCase());
    return normalizedPrefix;
  });

  const seenNames = new Set(builtInNames);
  const userPrefixes = [];
  entries.forEach((entry, index) => {
    if (matchedEntryIndexes.has(index) || entry?.builtIn === true) return;
    const name = normalizeText(entry?.name);
    const instruction = normalizeText(entry?.instruction);
    const normalizedName = name.toLocaleLowerCase();
    if (!name || !instruction || seenNames.has(normalizedName)) return;
    seenNames.add(normalizedName);
    userPrefixes.push({
      id: normalizeId(entry?.id) || `user-${userPrefixes.length + 1}`,
      name,
      instruction,
      builtIn: false,
      enabled: typeof entry?.enabled === "boolean" ? entry.enabled : true,
      allowSearch: entry?.allowSearch === true,
      allowClipboard: entry?.allowClipboard === true
    });
  });

  return [...builtIns, ...userPrefixes].slice(0, Number(maxPrefixes) || 100);
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
