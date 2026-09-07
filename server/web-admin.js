import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestOrigin, parseTrustedProxies } from "./request-origin.js";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
  createLoginRateLimiter,
  createSessionStore,
  parseCookies,
  secureEqual,
  serializeCookie
} from "./web-sessions.js";

const LOGIN_BODY_LIMIT_BYTES = 8 * 1024;

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "media-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

// Every file the website can serve is named here. Desktop-only pages such as
// status-overlay.html are absent on purpose: the browser must not be able to
// reach a surface whose behavior only exists inside Electron.
const PUBLIC_FILES = new Map([
  ["/styles.css", "styles.css"],
  ["/login.js", "login.js"],
  ["/assets/icon.svg", "assets/icon.svg"]
]);

const PRIVATE_FILES = new Map([
  ["/app-bridge.js", "app-bridge.js"],
  ["/app-version.js", "app-version.js"],
  ["/app.js", "app.js"],
  ["/capture-policy.js", "capture-policy.js"],
  ["/environment-chrome.js", "environment-chrome.js"],
  ["/icons.js", "icons.js"],
  ["/log-timing.js", "log-timing.js"],
  ["/logs.js", "logs.js"],
  ["/media-support.js", "media-support.js"],
  ["/prefix-transfer.js", "prefix-transfer.js"],
  ["/runtime-config.js", "runtime-config.js"],
  ["/settings-navigation.js", "settings-navigation.js"],
  ["/settings.js", "settings.js"],
  ["/setup-warning.js", "setup-warning.js"],
  ["/web-client.js", "web-client.js"]
]);

const PRIVATE_PAGES = new Map([
  ["/index.html", "index.html"],
  ["/settings.html", "settings.html"],
  ["/logs.html", "logs.html"]
]);

const PAGE_ALIASES = new Map([
  ["/test", "/index.html"],
  // The recorder page answered to this name before it became Test.
  ["/capture", "/index.html"],
  ["/activity", "/logs.html"],
  ["/settings", "/settings.html"],
  ["/prefixes", "/settings.html#prefixes"],
  ["/provider", "/settings.html#provider"]
]);

const DEFAULT_SIGNED_IN_PATH = "/settings.html#provider";

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"]
]);

export function createWebAdmin({
  adminKey,
  enabled = true,
  allowInsecure = false,
  trustedProxies = "",
  appVersion = "",
  publicRoot = fileURLToPath(new URL("../public/", import.meta.url)),
  sessions = createSessionStore(),
  rateLimiter = createLoginRateLimiter()
} = {}) {
  const proxies = parseTrustedProxies(trustedProxies);
  const root = path.resolve(publicRoot);

  return {
    enabled,
    sessions,
    rateLimiter,
    applySecurityHeaders,
    resolveRequestSession,
    handleWebRequest
  };

  function applySecurityHeaders(response) {
    if (response.headersSent) return;
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("x-frame-options", "DENY");
    response.setHeader("cross-origin-opener-policy", "same-origin");
    // The website records with the visiting computer's microphone; no other
    // origin embedded by these pages is granted the capability.
    response.setHeader("permissions-policy", "microphone=(self), camera=(), geolocation=()");
    response.setHeader("content-security-policy", CONTENT_SECURITY_POLICY);
  }

  // Returns how a browser session applies to an API request. `csrfValid` is
  // reported separately so the caller can refuse with a specific explanation
  // instead of a generic 401 that looks like a signed-out session.
  function resolveRequestSession(request) {
    if (!enabled) return null;
    const cookies = parseCookies(request.headers.cookie);
    const session = sessions.resolve(cookies[SESSION_COOKIE]);
    if (!session) return null;
    const header = request.headers[CSRF_HEADER];
    const submitted = Array.isArray(header) ? header[0] : header;
    return { session, csrfValid: secureEqual(submitted, session.csrfToken) };
  }

  async function handleWebRequest(request, response, url) {
    if (!enabled) return false;
    const method = request.method || "GET";
    const { pathname } = url;

    if (pathname === "/api/web/login") {
      if (method !== "POST") return sendJson(response, 405, { error: { message: "Sign in uses POST." } });
      await handleLogin(request, response);
      return true;
    }
    if (pathname === "/api/web/logout") {
      if (method !== "POST") return sendJson(response, 405, { error: { message: "Sign out uses POST." } });
      handleLogout(request, response);
      return true;
    }
    if (pathname === "/api/web/session") {
      if (method !== "GET" && method !== "HEAD") {
        return sendJson(response, 405, { error: { message: "Session details use GET." } });
      }
      return sendJson(response, 200, describeSession(request));
    }

    if (method !== "GET" && method !== "HEAD") return false;

    if (pathname === "/") {
      if (resolveRequestSession(request)) return redirect(response, DEFAULT_SIGNED_IN_PATH);
      return sendFile(request, response, "login.html", { store: false });
    }

    const alias = PAGE_ALIASES.get(pathname);
    if (alias) {
      if (!resolveRequestSession(request)) return redirectToLogin(request, response, alias);
      return redirect(response, alias);
    }

    if (PRIVATE_PAGES.has(pathname)) {
      if (!resolveRequestSession(request)) return redirectToLogin(request, response, pathname);
      return sendFile(request, response, PRIVATE_PAGES.get(pathname), { store: false });
    }

    if (PUBLIC_FILES.has(pathname)) {
      return sendFile(request, response, PUBLIC_FILES.get(pathname), { store: false });
    }

    if (PRIVATE_FILES.has(pathname)) {
      if (!resolveRequestSession(request)) {
        return sendJson(response, 401, { error: { message: "Sign in to load the administration site." } });
      }
      return sendFile(request, response, PRIVATE_FILES.get(pathname), { store: false });
    }

    // A browser navigating to anything else — a desktop overlay page, a stale
    // bookmark — gets an honest page rather than an OpenAI-shaped JSON error.
    if (pathname !== "/health" && !pathname.startsWith("/v1/") && acceptsHtml(request)) {
      return sendHtml(response, 404, notFoundPage());
    }

    return false;
  }

  async function handleLogin(request, response) {
    const origin = getRequestOrigin(request, proxies);
    if (!origin.secureContext && !allowInsecure) {
      return sendJson(response, 403, {
        error: {
          message: "This server refuses administration sign-in over plain HTTP. Use HTTPS, reach it at localhost, "
            + "or set PORVOZ_WEB_ALLOW_INSECURE=true to permit HTTP administration on a trusted network."
        }
      });
    }

    const limitKey = origin.clientAddress || "unknown";
    const limit = rateLimiter.check(limitKey);
    if (!limit.allowed) {
      response.setHeader("retry-after", String(limit.retryAfterSeconds));
      return sendJson(response, 429, {
        error: { message: `Too many sign-in attempts. Try again in ${limit.retryAfterSeconds} seconds.` }
      });
    }

    // Requiring a JSON body keeps a cross-site HTML form from posting here at
    // all; a form can only send the three simple content types.
    if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
      return sendJson(response, 415, { error: { message: "Sign in must send a JSON request body." } });
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      return sendJson(response, 400, { error: { message: error.message } });
    }

    if (!secureEqual(body?.adminKey, adminKey)) {
      rateLimiter.recordFailure(limitKey);
      return sendJson(response, 401, { error: { message: "That admin key is not correct." } });
    }

    rateLimiter.clear(limitKey);
    const session = sessions.create();
    const maxAge = Math.floor(sessions.maximumLifetimeMs / 1000);
    response.setHeader("set-cookie", [
      serializeCookie(SESSION_COOKIE, session.id, { httpOnly: true, secure: origin.protocol === "https", maxAge }),
      serializeCookie(CSRF_COOKIE, session.csrfToken, { secure: origin.protocol === "https", maxAge })
    ]);
    return sendJson(response, 200, {
      next: DEFAULT_SIGNED_IN_PATH,
      ...describeSession(request, session)
    });
  }

  function handleLogout(request, response) {
    // Ending a session is a state change, so it carries the same request token
    // every other one does. A signed-out browser simply has nothing to end.
    const active = resolveRequestSession(request);
    if (active && !active.csrfValid) {
      return sendJson(response, 403, {
        error: { message: "This browser request did not carry its Porvoz request token." }
      });
    }
    const cookies = parseCookies(request.headers.cookie);
    sessions.destroy(cookies[SESSION_COOKIE]);
    const secure = getRequestOrigin(request, proxies).protocol === "https";
    response.setHeader("set-cookie", [
      serializeCookie(SESSION_COOKIE, "", { httpOnly: true, secure, maxAge: 0 }),
      serializeCookie(CSRF_COOKIE, "", { secure, maxAge: 0 })
    ]);
    return sendJson(response, 200, { signedOut: true });
  }

  function describeSession(request, createdSession) {
    const origin = getRequestOrigin(request, proxies);
    const active = createdSession || resolveRequestSession(request)?.session || null;
    return {
      authenticated: Boolean(active),
      version: appVersion,
      // The page runs its own capability checks; this only explains why a
      // browser on plain HTTP will find recording unavailable.
      secureContext: origin.secureContext,
      insecureAdministrationAllowed: allowInsecure,
      idleTimeoutSeconds: Math.floor(sessions.idleTimeoutMs / 1000),
      maximumLifetimeSeconds: Math.floor(sessions.maximumLifetimeMs / 1000)
    };
  }

  function redirectToLogin(request, response, requestedPath) {
    const hadSession = Boolean(parseCookies(request.headers.cookie)[SESSION_COOKIE]);
    const reason = hadSession ? "expired" : "required";
    // An alias resolves to its page before this point, and a fragment is the
    // browser's business, so only the page path is carried through sign-in.
    const [targetPath] = String(requestedPath).split("#");
    const next = PRIVATE_PAGES.has(targetPath) ? targetPath : "";
    const query = new URLSearchParams({ reason });
    if (next) query.set("next", next);
    return redirect(response, `/?${query}`);
  }

  async function sendFile(request, response, relativePath, { store = false } = {}) {
    const filePath = path.join(root, relativePath);
    // Every path here comes from a literal allowlist, so this only guards
    // against a mistake in that table rather than against user input.
    if (!filePath.startsWith(root + path.sep)) return sendHtml(response, 404, notFoundPage());
    let contents;
    try {
      contents = await readFile(filePath);
    } catch {
      return sendHtml(response, 404, notFoundPage());
    }
    const type = CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
    applySecurityHeaders(response);
    response.writeHead(200, {
      "content-type": type,
      "content-length": contents.length,
      "cache-control": store ? "private, max-age=300" : "no-store"
    });
    response.end(request.method === "HEAD" ? undefined : contents);
    return true;
  }

  function sendHtml(response, status, html) {
    applySecurityHeaders(response);
    const body = Buffer.from(html, "utf8");
    response.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "content-length": body.length,
      "cache-control": "no-store"
    });
    response.end(body);
    return true;
  }

  function sendJson(response, status, value) {
    applySecurityHeaders(response);
    const body = Buffer.from(JSON.stringify(value), "utf8");
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": body.length,
      "cache-control": "no-store"
    });
    response.end(body);
    return true;
  }

  function redirect(response, location) {
    applySecurityHeaders(response);
    response.writeHead(302, { location, "cache-control": "no-store", "content-length": 0 });
    response.end();
    return true;
  }
}

function acceptsHtml(request) {
  return String(request.headers.accept || "").includes("text/html");
}

function notFoundPage() {
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
    + "<title>Porvoz · Not found</title></head><body>"
    + "<h1>Not found</h1><p>That page is not part of the Porvoz administration site.</p>"
    + "<p><a href=\"/\">Return to Porvoz</a></p></body></html>";
}

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > LOGIN_BODY_LIMIT_BYTES) throw new Error("The sign-in request is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("The sign-in request must contain valid JSON.");
  }
}
