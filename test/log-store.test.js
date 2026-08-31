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
