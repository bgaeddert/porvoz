import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLogStore } from "../electron/log-store.js";

test("the log store retains only the configured number of recent entries", (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "porvoz-logs-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const logsPath = path.join(directory, "logs.json");
  const store = createLogStore({ logsPath, maxEntries: 3 });

  for (const text of ["one", "two", "three", "four"]) {
    store.appendLog({ type: "transcript", text });
  }

  assert.deepEqual(store.getLogs().map((entry) => entry.text), ["four", "three", "two"]);
  assert.equal(JSON.parse(readFileSync(logsPath, "utf8")).length, 3);
});

test("the log store prunes an oversized existing archive on startup", (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "porvoz-logs-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const logsPath = path.join(directory, "logs.json");
  const entries = Array.from({ length: 5 }, (_, index) => ({
    id: String(index),
    type: "transcript",
    text: `entry-${index}`,
    createdAt: new Date(2026, 0, 5 - index).toISOString()
  }));
  writeFileSync(logsPath, JSON.stringify(entries));

  const store = createLogStore({ logsPath, maxEntries: 2 });

  assert.deepEqual(store.getLogs().map((entry) => entry.text), ["entry-0", "entry-1"]);
  assert.equal(JSON.parse(readFileSync(logsPath, "utf8")).length, 2);
});

test("the log store preserves actionable error metadata", (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "porvoz-logs-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = createLogStore({ logsPath: path.join(directory, "logs.json") });

  store.appendLog({
    type: "error",
    text: "No endpoints available matching your data policy.",
    stage: "transcription",
    status: 404,
    model: "openai/gpt-transcribe",
    mimeType: "audio/webm;codecs=opus",
    bytes: 42
  });

  assert.deepEqual(store.getLogs()[0], {
    id: store.getLogs()[0].id,
    type: "error",
    text: "No endpoints available matching your data policy.",
    createdAt: store.getLogs()[0].createdAt,
    groupId: "",
    model: "openai/gpt-transcribe",
    prefix: "",
    instructions: "",
    input: "",
    searchEnabled: false,
    searchUsed: false,
    clipboardEnabled: false,
    stage: "transcription",
    status: 404,
    errorCode: "",
    mimeType: "audio/webm;codecs=opus",
    bytes: 42,
    timing: null
  });
});

test("the log store updates timing for matching group entries", (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "porvoz-logs-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = createLogStore({ logsPath: path.join(directory, "logs.json") });

  store.appendLog({
    type: "transcript",
    text: "hello world",
    groupId: "grp-1",
    timing: { preTranscriptionMs: 120, transcriptionMs: 650 }
  });
  store.appendLog({
    type: "instruction",
    text: "hello world formatted",
    groupId: "grp-1",
    timing: { preTranscriptionMs: 120, transcriptionMs: 650, instructionMs: 1100 }
  });

  store.updateLogTiming("grp-1", { pasteMs: 85, totalMs: 1955 });

  const logs = store.getLogs();
  assert.equal(logs.length, 2);
  assert.equal(logs[0].timing.pasteMs, 85);
  assert.equal(logs[0].timing.totalMs, 1955);
  assert.equal(logs[0].timing.instructionMs, 1100);
  assert.equal(logs[1].timing.pasteMs, 85);
  assert.equal(logs[1].timing.totalMs, 1955);
  assert.equal(logs[1].timing.transcriptionMs, 650);
});
