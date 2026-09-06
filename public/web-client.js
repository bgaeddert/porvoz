// Same-origin HTTP client for the browser administration site. It carries the
// HttpOnly session cookie the browser already holds and echoes the readable
// CSRF cookie in a header, which a cross-site request cannot set.

const CSRF_COOKIE = "porvoz_csrf";
const CSRF_HEADER = "x-porvoz-csrf";

let sessionExpiryHandled = false;

export function readCsrfToken() {
  for (const part of document.cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== CSRF_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return part.slice(separator + 1).trim();
    }
  }
  return "";
}

export async function request(path, { method = "GET", json, body, signal, expectJson = true } = {}) {
  const headers = { [CSRF_HEADER]: readCsrfToken() };
  if (json !== undefined) headers["content-type"] = "application/json";
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: json !== undefined ? JSON.stringify(json) : body,
      signal
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error("Could not reach the Porvoz server. Check that it is still running, then retry.");
  }

  const payload = expectJson ? await response.json().catch(() => ({})) : {};
  if (response.ok) return payload;

  if (response.status === 401 || response.status === 403) {
    // A signed-out or forged-looking request means this page can no longer act
    // for the administrator, so send them back to sign in with an explanation.
    handleSessionExpiry();
  }
  const error = new Error(payload?.error?.message || `The Porvoz server returned HTTP ${response.status}.`);
  error.status = response.status;
  error.code = payload?.error?.code;
  throw error;
}

export function handleSessionExpiry() {
  if (sessionExpiryHandled) return;
  sessionExpiryHandled = true;
  const query = new URLSearchParams({ reason: "expired" });
  const current = window.location.pathname;
  if (["/index.html", "/settings.html", "/logs.html"].includes(current)) query.set("next", current);
  window.location.assign(`/?${query}`);
}

export async function signOut() {
  try {
    await request("/api/web/logout", { method: "POST" });
  } catch (error) {
    console.warn("Could not sign out cleanly:", error);
  }
  window.location.assign("/?reason=signed-out");
}
