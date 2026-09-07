import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createPorvozHttpServer } from "../server/http-server.js";
import { createServerStore } from "../server/store.js";
import { createLoginRateLimiter, createSessionStore } from "../server/web-sessions.js";
import { getRequestOrigin, parseTrustedProxies } from "../server/request-origin.js";

const defaultsPath = fileURLToPath(new URL("../electron/defaults.json", import.meta.url));
const ADMIN_KEY = "test-admin-key";

async function startServer(context, { webAdmin = {}, upstream } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "porvoz-web-"));
  const store = await createServerStore({
    databasePath: path.join(directory, "porvoz.db"),
    defaultsPath,
    masterKey: "test-master-key"
  });
  const application = createPorvozHttpServer({
    store,
    adminKey: ADMIN_KEY,
    host: "127.0.0.1",
    port: 0,
    webAdmin: { appVersion: "9.9.9", ...webAdmin }
  });
  const address = await application.start();
  context.after(async () => {
    await application.close();
    if (upstream) await new Promise((resolve) => upstream.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });
  return { baseUrl: `http://127.0.0.1:${address.port}`, application, store };
}

// A browser holds two cookies: the HttpOnly session and the readable token it
// echoes back in a header. This mirrors that pair so tests exercise the real
// double-submit path rather than a shortcut around it.
function createBrowser(baseUrl) {
  const cookies = new Map();
  return {
    cookies,
    get csrfToken() {
      return cookies.get("porvoz_csrf") || "";
    },
    async fetch(path, { method = "GET", headers = {}, body, csrf = true, redirect = "manual" } = {}) {
      const cookieHeader = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      const requestHeaders = { ...headers };
      if (cookieHeader) requestHeaders.cookie = cookieHeader;
      if (csrf && cookies.has("porvoz_csrf")) requestHeaders["x-porvoz-csrf"] = cookies.get("porvoz_csrf");
      const response = await fetch(`${baseUrl}${path}`, { method, headers: requestHeaders, body, redirect });
      for (const raw of response.headers.getSetCookie?.() || []) {
        const [pair] = raw.split(";");
        const separator = pair.indexOf("=");
        const name = pair.slice(0, separator).trim();
        const value = decodeURIComponent(pair.slice(separator + 1).trim());
        if (value) cookies.set(name, value);
        else cookies.delete(name);
      }
      return response;
    },
    signIn(adminKey = ADMIN_KEY) {
      return this.fetch("/api/web/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adminKey })
      });
    }
  };
}

test("the website requires sign-in and serves only its allowlisted files", async (context) => {
  const { baseUrl } = await startServer(context);
  const browser = createBrowser(baseUrl);

  const login = await browser.fetch("/", { headers: { accept: "text/html" } });
  assert.equal(login.status, 200);
  assert.match(await login.text(), /Administer this Porvoz server/);
  assert.equal(login.headers.get("cache-control"), "no-store");
  assert.equal(login.headers.get("x-frame-options"), "DENY");
  assert.match(login.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(login.headers.get("permissions-policy"), /microphone=\(self\)/);

  // A direct link to an administration page returns to sign-in and says why.
  const settings = await browser.fetch("/settings.html", { headers: { accept: "text/html" } });
  assert.equal(settings.status, 302);
  assert.equal(settings.headers.get("location"), "/?reason=required&next=%2Fsettings.html");

  // A friendly alias resolves to the page it stands for before sign-in, so
  // signing in returns the administrator to that page. An alias that carries a
  // fragment keeps only its path through sign-in.
  for (const [alias, next] of [["/test", "%2Findex.html"], ["/capture", "%2Findex.html"],
    ["/activity", "%2Flogs.html"], ["/prefixes", "%2Fsettings.html"], ["/provider", "%2Fsettings.html"]]) {
    const response = await browser.fetch(alias, { headers: { accept: "text/html" } });
    assert.equal(response.status, 302, alias);
    assert.equal(response.headers.get("location"), `/?reason=required&next=${next}`, alias);
  }

  // The login page's own assets are public; everything else needs a session.
  assert.equal((await browser.fetch("/styles.css")).status, 200);
  assert.equal((await browser.fetch("/login.js")).status, 200);
  assert.equal((await browser.fetch("/assets/icon.svg")).status, 200);
  assert.equal((await browser.fetch("/settings.js")).status, 401);

  // Desktop-only pages and recording cue audio are absent from the website.
  for (const overlayPath of ["/status-overlay.html", "/status-overlay.css", "/status-overlay.js",
    "/markdown-renderer.js", "/assets/recording-start.mp3", "/../package.json"]) {
    const response = await browser.fetch(overlayPath, { headers: { accept: "text/html" } });
    assert.ok(response.status === 404 || response.status === 401,
      `${overlayPath} returned ${response.status}`);
    assert.doesNotMatch(await response.text(), /porvozDesktop|overlay-shell|"name": "porvoz"/);
  }

  await browser.signIn();
  assert.equal((await browser.fetch("/log-timing.js")).status, 200);
});

test("signing in issues a session that carries a request token", async (context) => {
  const { baseUrl } = await startServer(context);
  const browser = createBrowser(baseUrl);

  const refused = await browser.signIn("wrong-key");
  assert.equal(refused.status, 401);
  assert.match((await refused.json()).error.message, /admin key is not correct/);

  // A cross-site HTML form can only send simple content types, so JSON is required.
  const formPost = await browser.fetch("/api/web/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `adminKey=${ADMIN_KEY}`
  });
  assert.equal(formPost.status, 415);

  const signedIn = await browser.signIn();
  assert.equal(signedIn.status, 200);
  const details = await signedIn.json();
  assert.equal(details.authenticated, true);
  assert.equal(details.version, "9.9.9");
  assert.equal(details.next, "/settings.html#provider");
  assert.equal(details.idleTimeoutSeconds, 3600);

  const setCookies = signedIn.headers.getSetCookie();
  const sessionCookie = setCookies.find((cookie) => cookie.startsWith("porvoz_session="));
  const csrfCookie = setCookies.find((cookie) => cookie.startsWith("porvoz_csrf="));
  assert.match(sessionCookie, /HttpOnly/);
  assert.match(sessionCookie, /SameSite=Strict/);
  // Plain HTTP cannot carry a Secure cookie, so the flag is set only for HTTPS.
  assert.doesNotMatch(sessionCookie, /Secure/);
  assert.doesNotMatch(csrfCookie, /HttpOnly/);
  assert.notEqual(browser.cookies.get("porvoz_csrf"), browser.cookies.get("porvoz_session"));

  const root = await browser.fetch("/", { headers: { accept: "text/html" } });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), "/settings.html#provider");

  assert.equal((await browser.fetch("/settings.html", { headers: { accept: "text/html" } })).status, 200);
  assert.equal((await browser.fetch("/settings.js")).status, 200);

  const runtime = await browser.fetch("/v1/porvoz/runtime");
  assert.equal(runtime.status, 200);
  assert.ok((await runtime.json()).activeProfileId);

  // The same cookies without the request token are refused, which is what a
  // forged cross-site request would look like if the cookie were ever sent.
  const forged = await browser.fetch("/v1/porvoz/runtime", { csrf: false });
  assert.equal(forged.status, 403);
  assert.equal((await forged.json()).error.code, "invalid_request_token");

  const wrongToken = await browser.fetch("/v1/porvoz/reset", {
    method: "POST",
    csrf: false,
    headers: { "x-porvoz-csrf": "not-the-token" }
  });
  assert.equal(wrongToken.status, 403);

  // Every friendly name leads somewhere the site actually serves.
  for (const [alias, target] of [["/test", "/index.html"], ["/capture", "/index.html"],
    ["/activity", "/logs.html"], ["/settings", "/settings.html"],
    ["/prefixes", "/settings.html#prefixes"], ["/provider", "/settings.html#provider"]]) {
    const response = await browser.fetch(alias, { headers: { accept: "text/html" } });
    assert.equal(response.status, 302, alias);
    assert.equal(response.headers.get("location"), target, alias);
  }

  // Ending a session is a state change and needs the same token as the rest.
  const forgedLogout = await browser.fetch("/api/web/logout", { method: "POST", csrf: false });
  assert.equal(forgedLogout.status, 403);
  assert.equal((await browser.fetch("/v1/porvoz/runtime")).status, 200, "the session survived the forged sign-out");

  const signedOut = await browser.fetch("/api/web/logout", { method: "POST" });
  assert.equal(signedOut.status, 200);
  assert.equal((await browser.fetch("/v1/porvoz/runtime")).status, 401);
  assert.equal((await browser.fetch("/settings.html", { headers: { accept: "text/html" } })).status, 302);
});

test("sessions expire on idle time and on total lifetime", async (context) => {
  let clock = 1_000_000;
  const sessions = createSessionStore({
    idleTimeoutMs: 60_000,
    maximumLifetimeMs: 300_000,
    now: () => clock
  });
  const { baseUrl } = await startServer(context, { webAdmin: { sessions } });
  const browser = createBrowser(baseUrl);
  await browser.signIn();
  assert.equal((await browser.fetch("/v1/porvoz/runtime")).status, 200);

  // Activity inside the idle window keeps the session alive.
  clock += 50_000;
  assert.equal((await browser.fetch("/v1/porvoz/runtime")).status, 200);
  clock += 50_000;
  assert.equal((await browser.fetch("/v1/porvoz/runtime")).status, 200);

  // Reaching the maximum lifetime ends it even while the browser stays busy.
  clock += 250_000;
  const expired = await browser.fetch("/v1/porvoz/runtime");
  assert.equal(expired.status, 401);
  const returned = await browser.fetch("/settings.html", { headers: { accept: "text/html" } });
  assert.equal(returned.headers.get("location"), "/?reason=expired&next=%2Fsettings.html");

  await browser.signIn();
  assert.equal((await browser.fetch("/v1/porvoz/runtime")).status, 200);
  clock += 60_001;
  assert.equal((await browser.fetch("/v1/porvoz/runtime")).status, 401);
});

test("repeated sign-in failures are rate limited, and success clears the count", async (context) => {
  let clock = 0;
  const rateLimiter = createLoginRateLimiter({ maximumAttempts: 3, windowMs: 10_000, now: () => clock });
  const { baseUrl } = await startServer(context, { webAdmin: { rateLimiter } });
  const browser = createBrowser(baseUrl);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal((await browser.signIn("wrong-key")).status, 401);
  }
  const limited = await browser.signIn("wrong-key");
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  // The correct key is refused too while the window is open.
  assert.equal((await browser.signIn()).status, 429);

  clock += 10_001;
  assert.equal((await browser.signIn()).status, 200);
  assert.equal((await browser.signIn("wrong-key")).status, 401);
});

test("a shared reverse proxy does not put every administrator in one bucket", async (context) => {
  let clock = 0;
  const rateLimiter = createLoginRateLimiter({ maximumAttempts: 2, windowMs: 10_000, now: () => clock });
  const { baseUrl } = await startServer(context, {
    webAdmin: { rateLimiter, trustedProxies: "loopback", allowInsecure: true }
  });
  const attempt = (client, adminKey) => signInRequest(baseUrl, {
    host: "porvoz.example",
    "x-forwarded-for": client,
    "x-forwarded-proto": "https"
  }, adminKey);

  // Every request arrives from the proxy's own address, so without the
  // forwarded client one visitor's guessing would lock out the rest.
  assert.equal((await attempt("203.0.113.5", "wrong-key")).status, 401);
  assert.equal((await attempt("203.0.113.5", "wrong-key")).status, 401);
  assert.equal((await attempt("203.0.113.5", "wrong-key")).status, 429);

  const other = await attempt("198.51.100.9", ADMIN_KEY);
  assert.equal(other.status, 200);

  // A forwarded address is only believed from a proxy on the list.
  const untrusting = await startServer(context, { webAdmin: { rateLimiter: createLoginRateLimiter({ maximumAttempts: 1, windowMs: 10_000, now: () => clock }) } });
  assert.equal((await signInRequest(untrusting.baseUrl, { "x-forwarded-for": "203.0.113.5" }, "wrong-key")).status, 401);
  assert.equal((await signInRequest(untrusting.baseUrl, { "x-forwarded-for": "198.51.100.9" }, "wrong-key")).status, 429);
});

test("inference keys never reach administration, and browser sessions never bypass profile routing", async (context) => {
  let transcriptionModel = "";
  const upstream = http.createServer(async (request, response) => {
    if (request.url === "/v1/audio/transcriptions") {
      for await (const _chunk of request) { /* consume the multipart body */ }
      return json(response, 200, { text: "browser dictation" });
    }
    if (request.url === "/v1/responses") {
      for await (const _chunk of request) { /* consume the request body */ }
      return json(response, 200, { output_text: "instruction result", output: [] });
    }
    json(response, 404, { error: { message: "not found" } });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;

  const { baseUrl } = await startServer(context, { upstream });
  const browser = createBrowser(baseUrl);
  await browser.signIn();

  const runtime = await (await browser.fetch("/v1/porvoz/runtime")).json();
  const profileId = runtime.activeProfileId;
  await browser.fetch(`/v1/porvoz/profiles/${profileId}/connection`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseUrl: upstreamUrl, apiKey: "upstream-secret", verifyCertificate: true })
  });
  await browser.fetch(`/v1/porvoz/profiles/${profileId}/models`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transcription: "transcribe-model", instruction: "instruction-model" })
  });

  const inferenceKey = (await (await browser.fetch(`/v1/porvoz/profiles/${profileId}/inference-key`)).json()).apiKey;
  assert.ok(inferenceKey);

  // An inference key is for transcription only: it cannot administer the
  // server and it cannot be exchanged for a browser session.
  const adminAttempt = await fetch(`${baseUrl}/v1/porvoz/runtime`, {
    headers: { authorization: `Bearer ${inferenceKey}` }
  });
  assert.equal(adminAttempt.status, 403);
  const loginAttempt = await fetch(`${baseUrl}/api/web/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminKey: inferenceKey })
  });
  assert.equal(loginAttempt.status, 401);
  const pageAttempt = await fetch(`${baseUrl}/settings.html`, {
    headers: { authorization: `Bearer ${inferenceKey}`, accept: "text/html" },
    redirect: "manual"
  });
  assert.equal(pageAttempt.status, 302);

  // The authenticated browser transcribes with the profile it selected.
  const form = new FormData();
  form.set("model", profileId);
  form.set("response_format", "json");
  form.set("file", new Blob([Buffer.from("audio")], { type: "audio/webm" }), "transcription.webm");
  const transcription = await browser.fetch("/v1/audio/transcriptions", { method: "POST", body: form });
  assert.equal(transcription.status, 200);
  const result = await transcription.json();
  assert.equal(result.porvoz.raw_transcript, "browser dictation");
  transcriptionModel = result.text;
  assert.ok(transcriptionModel);

  // Without the request token the same upload is refused.
  const forgedForm = new FormData();
  forgedForm.set("model", profileId);
  forgedForm.set("file", new Blob([Buffer.from("audio")], { type: "audio/webm" }), "transcription.webm");
  const forged = await browser.fetch("/v1/audio/transcriptions", {
    method: "POST",
    body: forgedForm,
    csrf: false
  });
  assert.equal(forged.status, 403);
});

test("plain HTTP administration is refused unless it is explicitly configured", async (context) => {
  const strict = await startServer(context);
  const remote = await signInRequest(strict.baseUrl, { host: "porvoz.example" });
  assert.equal(remote.status, 403);
  assert.match(remote.json().error.message, /refuses administration sign-in over plain HTTP/);

  // The same server still admits a browser reaching it at a localhost address,
  // which is the browser's own secure-context exception.
  const localhost = await signInRequest(strict.baseUrl, { host: "localhost:1" });
  assert.equal(localhost.status, 200);
  assert.equal(localhost.json().secureContext, true);

  const permissive = await startServer(context, { webAdmin: { allowInsecure: true } });
  const trustedLan = await signInRequest(permissive.baseUrl, { host: "porvoz.example" });
  assert.equal(trustedLan.status, 200);
  const details = trustedLan.json();
  // Administration is permitted; the page still reports an insecure context so
  // recording stays unavailable and explains itself.
  assert.equal(details.authenticated, true);
  assert.equal(details.secureContext, false);
  assert.equal(details.insecureAdministrationAllowed, true);
});

test("forwarded connection details are believed only from a trusted proxy", async (context) => {
  const untrusting = await startServer(context);
  const spoofed = await rawRequest(untrusting.baseUrl, "/api/web/session", {
    headers: { host: "porvoz.example", "x-forwarded-proto": "https" }
  });
  assert.equal(spoofed.json().secureContext, false);

  const trusting = await startServer(context, { webAdmin: { trustedProxies: "127.0.0.1, 10.0.0.0/8" } });
  const proxied = await rawRequest(trusting.baseUrl, "/api/web/session", {
    headers: { host: "porvoz.example", "x-forwarded-proto": "https" }
  });
  assert.equal(proxied.json().secureContext, true);
  const proxiedLogin = await signInRequest(trusting.baseUrl, {
    host: "porvoz.example",
    "x-forwarded-proto": "https"
  });
  assert.equal(proxiedLogin.status, 200);
  // An HTTPS origin gets a Secure session cookie.
  assert.match(proxiedLogin.headers["set-cookie"].find((cookie) => cookie.startsWith("porvoz_session=")), /Secure/);
});

test("the desktop's private child server publishes no website", async (context) => {
  const { baseUrl } = await startServer(context, { webAdmin: { enabled: false } });

  const root = await fetch(`${baseUrl}/`, { headers: { accept: "text/html" }, redirect: "manual" });
  assert.equal(root.status, 401);
  assert.equal((await fetch(`${baseUrl}/settings.html`, { headers: { accept: "text/html" } })).status, 401);
  assert.equal((await fetch(`${baseUrl}/styles.css`)).status, 401);
  const login = await fetch(`${baseUrl}/api/web/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminKey: ADMIN_KEY })
  });
  assert.equal(login.status, 401);

  // The API the desktop actually uses is untouched.
  const runtime = await fetch(`${baseUrl}/v1/porvoz/runtime`, {
    headers: { authorization: `Bearer ${ADMIN_KEY}` }
  });
  assert.equal(runtime.status, 200);
  assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
});

test("request origins read the host the browser used and trust only listed proxies", () => {
  const request = (headers, { remoteAddress = "203.0.113.9", encrypted = false } = {}) =>
    ({ headers, socket: { remoteAddress, encrypted } });

  // A container publishing its port is reached at localhost even though the
  // connection arrives from the Docker bridge.
  const published = getRequestOrigin(request({ host: "localhost:8090" }, { remoteAddress: "172.17.0.1" }));
  assert.equal(published.hostname, "localhost");
  assert.equal(published.secureContext, true);

  assert.equal(getRequestOrigin(request({ host: "porvoz.example" })).secureContext, false);
  assert.equal(getRequestOrigin(request({ host: "[::1]:8080" })).secureContext, true);
  assert.equal(getRequestOrigin(request({ host: "porvoz.example" }, { encrypted: true })).secureContext, true);
  // Node reports IPv4 peers on a dual-stack listener in mapped form.
  assert.equal(getRequestOrigin(request({ host: "a" }, { remoteAddress: "::ffff:127.0.0.1" })).remoteAddress,
    "127.0.0.1");

  const proxies = parseTrustedProxies("loopback, 172.18.0.0/16, 198.51.100.7");
  assert.equal(getRequestOrigin(request({ host: "p", "x-forwarded-proto": "https" },
    { remoteAddress: "172.18.4.5" }), proxies).secureContext, true);
  assert.equal(getRequestOrigin(request({ host: "p", "x-forwarded-proto": "https" },
    { remoteAddress: "172.19.4.5" }), proxies).secureContext, false);
  assert.equal(getRequestOrigin(request({ host: "p", "x-forwarded-proto": "https" },
    { remoteAddress: "127.0.0.1" }), proxies).secureContext, true);
  assert.equal(getRequestOrigin(request({ host: "p", "x-forwarded-proto": "https" },
    { remoteAddress: "198.51.100.7" }), proxies).secureContext, true);
  // A malformed entry is discarded rather than matching everything.
  assert.deepEqual(parseTrustedProxies("172.18.0.0/99, , not-an-address/8").length, 0);
});

// fetch() will not send a caller-supplied Host header, so the tests that turn
// on the origin a browser used issue raw requests instead.
function rawRequest(baseUrl, requestPath, { method = "GET", headers = {}, body } = {}) {
  const target = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: target.hostname,
      port: target.port,
      path: requestPath,
      method,
      // setHost:false keeps Node from adding its own Host beside ours.
      setHost: false,
      headers: { host: target.host, ...headers }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
        json() {
          try {
            return JSON.parse(this.body);
          } catch {
            return {};
          }
        }
      }));
    });
    request.once("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

function signInRequest(baseUrl, headers = {}, adminKey = ADMIN_KEY) {
  return rawRequest(baseUrl, "/api/web/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ adminKey })
  });
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  response.end(body);
}
