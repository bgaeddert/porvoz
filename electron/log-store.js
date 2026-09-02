import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function createLogStore({ logsPath, maxEntries = 200 }) {
  const entryLimit = Math.max(1, Number(maxEntries) || 200);
  let logs = existsSync(logsPath)
    ? readLogsFile(logsPath)
    : [];
  const shouldPruneStoredLogs = logs.length > entryLimit;
  logs = logs.slice(0, entryLimit);

  if (!existsSync(logsPath) || shouldPruneStoredLogs) saveLogsFile();

  return {
    getLogs: () => clone(logs),
    appendLog,
    clearLogs
  };

  function appendLog(entry = {}) {
    const normalized = normalizeLog(entry);
    if (!normalized) throw new Error("The response log entry is invalid.");
    logs.unshift(normalized);
    if (logs.length > entryLimit) logs.length = entryLimit;
    saveLogsFile();
    return clone(normalized);
  }

  function clearLogs() {
    logs = [];
    saveLogsFile();
    return [];
  }

  function saveLogsFile() {
    writeJsonAtomically(logsPath, logs);
  }
}

function readLogsFile(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("The log file must contain an array.");
    return parsed.map(normalizeLog).filter(Boolean);
  } catch (error) {
    console.error(`Could not read ${path.basename(filePath)}:`, error.message);
    throw new Error("The saved response logs could not be read.");
  }
}

function normalizeLog(entry) {
  if (!entry || typeof entry !== "object") return null;
  const type = entry.type === "transcript" || entry.type === "instruction" || entry.type === "error"
    ? entry.type
    : "";
  const rawText = typeof entry.text === "string" ? entry.text : "";
  const text = type === "instruction" ? rawText : rawText.trim();
  if (!type || !text.trim()) return null;

  return {
    id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : randomUUID(),
    type,
    text,
    createdAt: isValidDate(entry.createdAt) ? entry.createdAt : new Date().toISOString(),
    groupId: typeof entry.groupId === "string" ? entry.groupId.trim() : "",
    model: typeof entry.model === "string" ? entry.model.trim() : "",
    prefix: typeof entry.prefix === "string" ? entry.prefix.trim() : "",
    instructions: typeof entry.instructions === "string" ? entry.instructions : "",
    input: typeof entry.input === "string" ? entry.input : "",
    searchEnabled: entry.searchEnabled === true,
    clipboardEnabled: entry.clipboardEnabled === true,
    stage: type === "error" ? normalizeErrorStage(entry.stage) : "",
    status: type === "error" ? normalizeStatus(entry.status) : null,
    errorCode: type === "error" && typeof entry.errorCode === "string" ? entry.errorCode.trim() : "",
    mimeType: type === "error" && typeof entry.mimeType === "string" ? entry.mimeType.trim() : "",
    bytes: type === "error" ? normalizeBytes(entry.bytes) : null
  };
}

function normalizeErrorStage(value) {
  const stage = typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
  return ["recording", "transcription", "instruction", "typing", "models", "configuration", "application"].includes(stage)
    ? stage
    : "application";
}

function normalizeStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function normalizeBytes(value) {
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

function isValidDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporaryPath, filePath);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
