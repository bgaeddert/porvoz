import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBackendClient } from "./backend-client.js";

export function createBackendManager({ app, safeStorage, preferences, userDataPath, legacyConfiguration }) {
  let child;
  let client;
  let identity = "";
  let connectionError = "";
  const localDatabasePath = path.join(userDataPath, "porvoz.db");

  return {
    start,
    stop,
    getClient: () => {
      if (!client) throw new Error("The Porvoz backend is not connected.");
      return client;
    },
    getSettings: () => ({
      ...preferences.getBackendSettings(),
      connectedMode: identity === "local" ? "local" : "remote",
      connectionError
    }),
    saveSettings
  };

  async function start() {
    const settings = preferences.getBackendSettings();
    if (settings.mode === "remote") {
      try {
        await connectRemote(settings);
        await client.health();
        await client.getRuntimeConfig();
      } catch (error) {
        connectionError = error.message || "The remote Porvoz server is unavailable.";
        client = undefined;
        await startLocal();
      }
    } else {
      await startLocal();
      await client.health();
      await client.getRuntimeConfig();
    }
    return settings;
  }

  async function saveSettings(value) {
    const requestedMode = value?.mode;
    if (requestedMode === "remote") {
      const remoteUrl = typeof value.remoteUrl === "string" ? value.remoteUrl.trim().replace(/\/+$/, "") : "";
      const adminKey = typeof value.adminKey === "string" && value.adminKey.trim()
        ? value.adminKey.trim()
        : preferences.getRemoteAdminKey();
      const remoteIdentity = `remote:${remoteUrl}`;
      const candidate = createClient(remoteUrl, adminKey, remoteIdentity);
      await candidate.health();
      await candidate.getRuntimeConfig();
      const saved = preferences.saveBackendSettings(value);
      await stopChild();
      identity = remoteIdentity;
      client = candidate;
      connectionError = "";
      return saved;
    }
    if (requestedMode !== "local") throw new Error("Choose the local or remote backend.");
    await startLocal();
    await client.health();
    await client.getRuntimeConfig();
    const saved = preferences.saveBackendSettings(value);
    connectionError = "";
    return saved;
  }

  async function connectRemote(settings) {
    identity = `remote:${settings.remoteUrl}`;
    client = createClient(settings.remoteUrl, preferences.getRemoteAdminKey(), identity);
  }

  async function startLocal() {
    if (child) return;
    const shouldImportLegacy = !existsSync(localDatabasePath)
      && legacyConfiguration?.settings?.profiles?.length;
    const adminKey = randomBytes(32).toString("base64url");
    const masterKey = getOrCreateLocalMasterKey();
    const cliPath = fileURLToPath(new URL("../server/cli.js", import.meta.url));
    const defaultsPath = fileURLToPath(new URL("./defaults.json", import.meta.url));
    child = fork(cliPath, [], {
      execPath: process.execPath,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        PORVOZ_ADMIN_KEY: adminKey,
        PORVOZ_MASTER_KEY: masterKey,
        PORVOZ_DATABASE_PATH: localDatabasePath,
        PORVOZ_DEFAULTS_PATH: defaultsPath,
        PORVOZ_HOST: "127.0.0.1",
        PORVOZ_PORT: "0"
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"]
    });
    child.stdout?.on("data", (value) => console.log(`[backend] ${value.toString().trimEnd()}`));
    child.stderr?.on("data", (value) => console.error(`[backend] ${value.toString().trimEnd()}`));
    const launchedChild = child;
    try {
      const ready = await waitForReady(launchedChild);
      identity = "local";
      client = createClient(`http://127.0.0.1:${ready.port}`, adminKey, identity);
      if (shouldImportLegacy) await client.importLegacy(legacyConfiguration);
    } catch (error) {
      if (child === launchedChild) child = undefined;
      if (launchedChild.exitCode === null) launchedChild.kill();
      throw error;
    }
  }

  function createClient(baseUrl, adminKey, backendIdentity) {
    return createBackendClient({
      baseUrl,
      adminKey,
      getActiveProfileId: () => preferences.getActiveProfileId(backendIdentity),
      setActiveProfileId: (profileId) => preferences.setActiveProfileId(backendIdentity, profileId)
    });
  }

  async function stop() {
    client = undefined;
    await stopChild();
  }

  async function stopChild() {
    if (!child) return;
    const processToStop = child;
    child = undefined;
    if (processToStop.exitCode !== null) return;
    processToStop.send?.({ type: "shutdown" });
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        processToStop.kill();
        resolve();
      }, 3_000);
      processToStop.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  function getOrCreateLocalMasterKey() {
    const keyPath = path.join(userDataPath, "server-master-key.bin");
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("The operating system credential protection service is unavailable.");
    }
    if (existsSync(keyPath)) {
      try {
        return safeStorage.decryptString(readFileSync(keyPath));
      } catch {
        throw new Error("The local server encryption key could not be decrypted.");
      }
    }
    const key = randomBytes(32).toString("base64url");
    const temporaryPath = `${keyPath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, safeStorage.encryptString(key));
    renameSync(temporaryPath, keyPath);
    return key;
  }
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("The local Porvoz backend did not start in time.")), 15_000);
    const finish = (callback, value) => {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("exit", onExit);
      callback(value);
    };
    const onMessage = (message) => {
      if (message?.type === "ready" && Number.isInteger(message.port)) finish(resolve, message);
    };
    const onExit = (code) => finish(reject, new Error(`The local Porvoz backend exited during startup (${code}).`));
    child.on("message", onMessage);
    child.once("exit", onExit);
  });
}
