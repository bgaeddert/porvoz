const form = document.querySelector("#login-form");
const adminKeyInput = document.querySelector("#admin-key");
const submitButton = document.querySelector("#sign-in");
const status = document.querySelector("#login-status");
const notice = document.querySelector("#login-notice");
const versionTargets = document.querySelectorAll("[data-app-version]");

const SIGNED_IN_PAGES = new Set([
  "/index.html", "/settings.html", "/logs.html",
  "/test", "/capture", "/activity", "/settings", "/prefixes", "/provider"
]);
const DEFAULT_DESTINATION = "/settings.html#provider";

const parameters = new URLSearchParams(window.location.search);

const NOTICES = {
  expired: "Your session ended. Sign in again.",
  required: "Sign in to open that page.",
  "signed-out": "You are signed out."
};

const noticeMessage = NOTICES[parameters.get("reason")];
if (noticeMessage) {
  notice.textContent = noticeMessage;
  notice.hidden = false;
}

form.addEventListener("submit", signIn);
adminKeyInput.focus();
void loadSessionDetails();

async function loadSessionDetails() {
  try {
    const response = await fetch("/api/web/session", { credentials: "same-origin" });
    if (!response.ok) return;
    const details = await response.json();
    if (typeof details.version === "string" && details.version) {
      versionTargets.forEach((target) => { target.textContent = `v${details.version}`; });
    }
    if (details.authenticated) {
      window.location.replace(destination());
      return;
    }
    if (!details.secureContext && !details.insecureAdministrationAllowed) {
      setStatus(
        "This server refuses administration sign-in over plain HTTP. Reach it over HTTPS or at a localhost address.",
        "error"
      );
      submitButton.disabled = true;
      adminKeyInput.disabled = true;
    } else if (!details.secureContext) {
      setStatus(
        "This connection is not secure, so recording stays unavailable. Other administration works.",
        "loading"
      );
    }
  } catch (error) {
    console.error("Could not read the session details:", error);
  }
}

async function signIn(event) {
  event.preventDefault();
  const adminKey = adminKeyInput.value;
  if (!adminKey) {
    setStatus("Enter the server admin key.", "error");
    adminKeyInput.focus();
    return;
  }

  submitButton.disabled = true;
  setStatus("Signing in…", "saving");
  try {
    const response = await fetch("/api/web/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ adminKey })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(payload?.error?.message || `Could not sign in (HTTP ${response.status}).`, "error");
      adminKeyInput.select();
      return;
    }
    // Nothing keeps the key in this page once the session cookie exists.
    adminKeyInput.value = "";
    window.location.replace(destination(payload.next));
  } catch (error) {
    console.error("Could not sign in:", error);
    setStatus("Could not reach the Porvoz server. Check that it is still running, then retry.", "error");
  } finally {
    submitButton.disabled = false;
  }
}

// Only paths this site actually serves are accepted, so a crafted link cannot
// turn the sign-in page into a redirector to somewhere else.
function destination(serverSuggestion) {
  const requested = parameters.get("next") || "";
  if (SIGNED_IN_PAGES.has(requested)) return requested;
  if (typeof serverSuggestion === "string" && serverSuggestion.startsWith("/")) return serverSuggestion;
  return DEFAULT_DESTINATION;
}

function setStatus(message, state) {
  status.textContent = message;
  status.dataset.state = state;
}
