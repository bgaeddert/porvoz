import { randomUUID } from "node:crypto";

export function createDatabaseLogStore(database, { maxEntries = 200 } = {}) {
  const entryLimit = Math.max(1, Number(maxEntries) || 200);
  return {
    getLogs,
    appendLog,
    updateLogTiming,
    clearLogs
  };

  function getLogs() {
    return database.prepare(`
      SELECT entry_json FROM activity_logs
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
    `).all(entryLimit).map((row) => JSON.parse(row.entry_json));
  }

  function appendLog(entry = {}) {
    const normalized = normalizeLog(entry);
    if (!normalized) throw new Error("The response log entry is invalid.");
    const transaction = database.transaction(() => {
      database.prepare("INSERT INTO activity_logs (id, created_at, entry_json) VALUES (?, ?, ?)")
        .run(normalized.id, normalized.createdAt, JSON.stringify(normalized));
      database.prepare(`
        DELETE FROM activity_logs WHERE id IN (
          SELECT id FROM activity_logs ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?
        )
      `).run(entryLimit);
    });
    transaction();
    return structuredClone(normalized);
  }

  function clearLogs() {
    database.prepare("DELETE FROM activity_logs").run();
    return [];
  }

  function updateLogTiming(groupId, timing = {}) {
    if (!groupId || typeof groupId !== "string") return;
    const normalizedTiming = normalizeTiming(timing);
    if (!normalizedTiming) return;

    const rows = database.prepare(`
      SELECT id, created_at, entry_json FROM activity_logs
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
    `).all(entryLimit);

    const updateStmt = database.prepare("UPDATE activity_logs SET entry_json = ? WHERE id = ?");
    database.transaction(() => {
      for (const row of rows) {
        try {
          const entry = JSON.parse(row.entry_json);
          if (entry.groupId === groupId) {
            entry.timing = {
              ...(entry.timing || {}),
              ...Object.fromEntries(Object.entries(normalizedTiming).filter(([_, v]) => v !== null))
            };
            updateStmt.run(JSON.stringify(entry), row.id);
          }
        } catch {}
      }
    })();
  }
}

function normalizeLog(entry) {
  if (!entry || typeof entry !== "object") return null;
  const type = ["transcript", "instruction", "error"].includes(entry.type) ? entry.type : "";
  const rawText = typeof entry.text === "string" ? entry.text : "";
  const text = type === "instruction" ? rawText : rawText.trim();
  if (!type || !text.trim()) return null;
  return {
    id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : randomUUID(),
    type,
    text,
    createdAt: typeof entry.createdAt === "string" && Number.isFinite(Date.parse(entry.createdAt))
      ? entry.createdAt
      : new Date().toISOString(),
    groupId: string(entry.groupId),
    model: string(entry.model),
    prefix: string(entry.prefix),
    instructions: typeof entry.instructions === "string" ? entry.instructions : "",
    input: typeof entry.input === "string" ? entry.input : "",
    searchEnabled: entry.searchEnabled === true,
    searchUsed: entry.searchUsed === true,
    clipboardEnabled: entry.clipboardEnabled === true,
    stage: type === "error" ? normalizeStage(entry.stage) : "",
    status: type === "error" && Number.isInteger(Number(entry.status)) ? Number(entry.status) : null,
    errorCode: type === "error" ? string(entry.errorCode) : "",
    mimeType: type === "error" ? string(entry.mimeType) : "",
    bytes: type === "error" && Number.isSafeInteger(Number(entry.bytes)) ? Number(entry.bytes) : null,
    timing: normalizeTiming(entry.timing)
  };
}

function normalizeTiming(timing) {
  if (!timing || typeof timing !== "object") return null;
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : null);
  const positiveNum = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
  const result = {
    hotkeyReleasedAt: num(timing.hotkeyReleasedAt),
    textPastedAt: num(timing.textPastedAt),
    preTranscriptionMs: num(timing.preTranscriptionMs),
    transcriptionMs: num(timing.transcriptionMs),
    instructionPrepMs: num(timing.instructionPrepMs),
    instructionMs: num(timing.instructionMs),
    pasteMs: num(timing.pasteMs),
    totalMs: positiveNum(timing.totalMs)
  };
  return Object.values(result).some((v) => v !== null) ? result : null;
}

function normalizeStage(value) {
  const stage = string(value).toLocaleLowerCase();
  return ["recording", "transcription", "instruction", "typing", "models", "configuration", "application"]
    .includes(stage) ? stage : "application";
}

function string(value) {
  return typeof value === "string" ? value.trim() : "";
}
