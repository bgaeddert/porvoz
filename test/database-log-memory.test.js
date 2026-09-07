import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSqliteDatabase } from "../server/sqlite-database.js";
import { createDatabaseLogStore } from "../server/database-log-store.js";

test("large response logs survive save, subsequent reads and database reopen", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "porvoz-log-memory-"));
  const databasePath = path.join(directory, "history.db");
  let database;
  try {
    database = await createSqliteDatabase(databasePath);
    database.exec(`CREATE TABLE activity_logs (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, entry_json TEXT NOT NULL
    )`);
    const logs = createDatabaseLogStore(database);
    // Binding, inserting and exporting this response exceeds the old asm.js
    // heap even though the on-disk database is much smaller than that heap.
    const text = "x".repeat(12 * 1024 * 1024);
    logs.appendLog({ id: "large", type: "instruction", text });
    logs.appendLog({ id: "next", type: "transcript", text: "Still working" });
    assert.equal(logs.getLogs().find((log) => log.id === "large").text, text);
    database.close();
    database = await createSqliteDatabase(databasePath);
    const restored = createDatabaseLogStore(database).getLogs();
    assert.equal(restored.length, 2);
    assert.equal(restored.find((log) => log.id === "large").text, text);
    assert.equal(restored.find((log) => log.id === "next").text, "Still working");
  } finally {
    database?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("timing updates reach every retained database activity entry", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "porvoz-log-timing-"));
  const databasePath = path.join(directory, "history.db");
  let database;
  try {
    database = await createSqliteDatabase(databasePath);
    database.exec(`CREATE TABLE activity_logs (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, entry_json TEXT NOT NULL
    )`);
    const logs = createDatabaseLogStore(database, { maxEntries: 100 });
    logs.appendLog({ id: "target", type: "transcript", text: "Earlier response", groupId: "target-group" });
    for (let index = 0; index < 60; index += 1) {
      logs.appendLog({ id: `later-${index}`, type: "transcript", text: `Later response ${index}` });
    }

    logs.updateLogTiming("target-group", { totalMs: 1250 });

    assert.equal(logs.getLogs().find((log) => log.id === "target").timing.totalMs, 1250);
  } finally {
    database?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
