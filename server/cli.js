import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createPorvozHttpServer } from "./http-server.js";
import { createServerStore } from "./store.js";
import { createLoginRateLimiter, createSessionStore } from "./web-sessions.js";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultsPath = process.env.PORVOZ_DEFAULTS_PATH
  || path.resolve(serverDirectory, "../electron/defaults.json");
const databasePath = process.env.PORVOZ_DATABASE_PATH
  || path.resolve(process.cwd(), "data/porvoz.db");
const adminKey = process.env.PORVOZ_ADMIN_KEY;
const masterKey = process.env.PORVOZ_MASTER_KEY;
const host = process.env.PORVOZ_HOST || "127.0.0.1";
const port = parsePort(process.env.PORVOZ_PORT);
// The desktop's private child server sets this to "off": its renderer already
// speaks to the backend over IPC and must never expose a login page.
const webAdminEnabled = String(process.env.PORVOZ_WEB_ADMIN ?? "on").toLowerCase() !== "off";
const allowInsecureWebAdmin = String(process.env.PORVOZ_WEB_ALLOW_INSECURE ?? "").toLowerCase() === "true";
const idleTimeoutMs = parseDurationMinutes(process.env.PORVOZ_WEB_IDLE_TIMEOUT_MINUTES, 60) * 60_000;
const maximumLifetimeMs = parseDurationMinutes(process.env.PORVOZ_WEB_SESSION_MINUTES, 480) * 60_000;

if (!adminKey || !masterKey) {
  console.error("PORVOZ_ADMIN_KEY and PORVOZ_MASTER_KEY are required.");
  process.exitCode = 1;
} else {
  const store = await createServerStore({ databasePath, defaultsPath, masterKey });
  const application = createPorvozHttpServer({
    store,
    adminKey,
    host,
    port,
    webAdmin: {
      enabled: webAdminEnabled,
      allowInsecure: allowInsecureWebAdmin,
      trustedProxies: process.env.PORVOZ_TRUSTED_PROXIES || "",
      appVersion: readAppVersion(),
      publicRoot: path.resolve(serverDirectory, "../public"),
      sessions: createSessionStore({ idleTimeoutMs, maximumLifetimeMs }),
      rateLimiter: createLoginRateLimiter()
    }
  });
  const address = await application.start();
  const ready = { type: "ready", host, port: address.port };
  if (typeof process.send === "function") process.send(ready);
  else {
    console.log(`Porvoz server listening on http://${host}:${address.port}`);
    if (webAdminEnabled) console.log("Browser administration is available at that address; sign in with the admin key.");
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await application.close();
      process.exit(0);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("disconnect", shutdown);
  process.once("message", (message) => {
    if (message?.type === "shutdown") void shutdown();
  });
}

function parseDurationMinutes(value, fallbackMinutes) {
  if (value === undefined || value === "") return fallbackMinutes;
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error("Session timeout variables must be a positive number of minutes.");
  }
  return minutes;
}

function readAppVersion() {
  try {
    return JSON.parse(readFileSync(path.resolve(serverDirectory, "../package.json"), "utf8")).version || "";
  } catch {
    return "";
  }
}

function parsePort(value) {
  if (value === undefined || value === "") return 8080;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORVOZ_PORT must be an integer from 0 through 65535.");
  }
  return port;
}
