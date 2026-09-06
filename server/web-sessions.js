import { randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "porvoz_session";
export const CSRF_COOKIE = "porvoz_csrf";
export const CSRF_HEADER = "x-porvoz-csrf";

const DEFAULT_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_MAXIMUM_LIFETIME_MS = 8 * 60 * 60 * 1000;
const MAXIMUM_SESSIONS = 200;

// Sessions live only in memory, so restarting the server signs every browser
// out. That is the documented behavior, and it keeps the database free of
// credentials that would outlive the process that issued them.
export function createSessionStore({
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  maximumLifetimeMs = DEFAULT_MAXIMUM_LIFETIME_MS,
  now = () => Date.now()
} = {}) {
  const sessions = new Map();

  return {
    idleTimeoutMs,
    maximumLifetimeMs,
    create,
    resolve,
    destroy,
    destroyAll: () => sessions.clear(),
    get size() {
      return sessions.size;
    }
  };

  function create() {
    prune();
    // A flood of sign-ins must not grow without bound; the oldest idle session
    // is the one a person is least likely to still be using.
    while (sessions.size >= MAXIMUM_SESSIONS) {
      const oldest = [...sessions.entries()]
        .sort((first, second) => first[1].lastSeenAt - second[1].lastSeenAt)[0];
      if (!oldest) break;
      sessions.delete(oldest[0]);
    }
    const id = createToken();
    const csrfToken = createToken();
    const createdAt = now();
    sessions.set(id, { csrfToken, createdAt, lastSeenAt: createdAt });
    return { id, csrfToken, createdAt };
  }

  function resolve(id) {
    prune();
    if (typeof id !== "string" || !id) return null;
    const session = sessions.get(id);
    if (!session) return null;
    const timestamp = now();
    if (isExpired(session, timestamp)) {
      sessions.delete(id);
      return null;
    }
    session.lastSeenAt = timestamp;
    return { id, csrfToken: session.csrfToken, createdAt: session.createdAt };
  }

  function destroy(id) {
    if (typeof id !== "string" || !id) return false;
    return sessions.delete(id);
  }

  function prune() {
    const timestamp = now();
    for (const [id, session] of sessions) {
      if (isExpired(session, timestamp)) sessions.delete(id);
    }
  }

  function isExpired(session, timestamp) {
    return timestamp - session.lastSeenAt >= idleTimeoutMs
      || timestamp - session.createdAt >= maximumLifetimeMs;
  }
}

// A fixed window is enough to blunt guessing without tracking anything about
// the people who sign in successfully.
export function createLoginRateLimiter({
  maximumAttempts = 10,
  windowMs = 15 * 60 * 1000,
  now = () => Date.now()
} = {}) {
  const attempts = new Map();

  return {
    maximumAttempts,
    windowMs,
    check,
    recordFailure,
    clear
  };

  function check(key) {
    prune();
    const entry = attempts.get(key);
    if (!entry || entry.count < maximumAttempts) return { allowed: true, retryAfterSeconds: 0 };
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.expiresAt - now()) / 1000))
    };
  }

  function recordFailure(key) {
    prune();
    const timestamp = now();
    const entry = attempts.get(key);
    if (!entry) {
      attempts.set(key, { count: 1, expiresAt: timestamp + windowMs });
      return;
    }
    entry.count += 1;
  }

  function clear(key) {
    attempts.delete(key);
  }

  function prune() {
    const timestamp = now();
    for (const [key, entry] of attempts) {
      if (entry.expiresAt <= timestamp) attempts.delete(key);
    }
  }
}

export function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (!name || Object.hasOwn(cookies, name)) continue;
    cookies[name] = decodeCookieValue(part.slice(separator + 1).trim());
  }
  return cookies;
}

export function serializeCookie(name, value, { maxAge, secure, httpOnly = false, sameSite = "Strict" } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", `SameSite=${sameSite}`];
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  if (Number.isFinite(maxAge)) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  return parts.join("; ");
}

export function createToken() {
  return randomBytes(32).toString("base64url");
}

export function secureEqual(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function decodeCookieValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
