import { renderMarkdown } from "./markdown-renderer.js";

const pill = document.querySelector("#status-pill");
const indicator = document.querySelector("#status-indicator");
const message = document.querySelector("#status-message");
const panelWrapper = document.querySelector("#panel-wrapper");
const panel = document.querySelector("#response-panel");
const responseText = document.querySelector("#response-text");
const copyButton = document.querySelector("#copy-response");
const dismissButton = document.querySelector("#dismiss-response");
const consoleSelectionToggle = document.querySelector("#console-selection-toggle");
const selectionCaptureToggle = document.querySelector("#selection-capture-toggle");
let captureSettings = {
  consoleSelectionEnabled: false,
  selectionCaptureEnabled: true
};
let copyFeedbackTimer;

copyButton.addEventListener("click", async () => {
  const copied = await window.porvozOverlay?.copyResponse();
  if (!copied) return;
  clearTimeout(copyFeedbackTimer);
  copyButton.textContent = "Copied";
  copyFeedbackTimer = setTimeout(() => { copyButton.textContent = "Copy"; }, 1200);
});
dismissButton.addEventListener("click", () => window.porvozOverlay?.dismiss());
consoleSelectionToggle?.addEventListener("click", () => toggleCaptureSetting(
  "consoleSelectionEnabled",
  "saveConsoleSelectionEnabled",
  consoleSelectionToggle
));
selectionCaptureToggle?.addEventListener("click", () => toggleCaptureSetting(
  "selectionCaptureEnabled",
  "saveSelectionCaptureEnabled",
  selectionCaptureToggle
));
responseText.addEventListener("click", (event) => {
  const link = event.target.closest?.("a[data-external-url]");
  if (!link) return;
  event.preventDefault();
  window.porvozOverlay?.openExternal(link.dataset.externalUrl);
});

const reportHover = () => window.porvozOverlay?.hover();
panelWrapper?.addEventListener("mouseenter", reportHover);
panelWrapper?.addEventListener("mousemove", reportHover);

window.porvozOverlay?.onStatus(renderStatus);
window.porvozOverlay?.onResponse(renderResponse);
window.porvozOverlay?.onCaptureSettings?.(renderCaptureSettings);
const initialCaptureSettings = window.porvozOverlay?.getCaptureSettings?.();
if (initialCaptureSettings?.then) initialCaptureSettings.then(renderCaptureSettings).catch(() => {});
window.porvozOverlay?.onHide(() => {
  pill.classList.remove("visible");
  panelWrapper?.classList.remove("visible");
  panel.classList.remove("visible");
});

function renderCaptureSettings(value = {}) {
  captureSettings = {
    consoleSelectionEnabled: value.consoleSelectionEnabled === true,
    selectionCaptureEnabled: value.selectionCaptureEnabled !== false
  };
  renderCaptureToggle(consoleSelectionToggle, captureSettings.consoleSelectionEnabled);
  renderCaptureToggle(selectionCaptureToggle, captureSettings.selectionCaptureEnabled);
}

function renderCaptureToggle(toggle, enabled) {
  if (!toggle) return;
  toggle.dataset.enabled = String(enabled);
  toggle.setAttribute("aria-checked", String(enabled));
  toggle.dataset.saving = "false";
  const state = toggle.querySelector(".capture-toggle-state");
  if (state) state.textContent = enabled ? "On" : "Off";
}

async function toggleCaptureSetting(key, method, toggle) {
  if (!toggle || toggle.disabled) return;
  const nextValue = !captureSettings[key];
  const state = toggle.querySelector(".capture-toggle-state");
  toggle.disabled = true;
  toggle.dataset.saving = "true";
  if (state) state.textContent = "Saving…";
  try {
    const saved = await window.porvozOverlay?.[method]?.(nextValue);
    if (typeof saved !== "boolean") throw new Error("The setting could not be saved.");
    renderCaptureSettings({ ...captureSettings, [key]: saved });
  } catch {
    renderCaptureSettings(captureSettings);
    toggle.dataset.error = "true";
    if (state) state.textContent = "Unavailable";
    setTimeout(() => {
      delete toggle.dataset.error;
      renderCaptureToggle(toggle, captureSettings[key]);
    }, 1800);
  } finally {
    toggle.disabled = false;
  }
}

function renderStatus(value = {}) {
  const state = typeof value.state === "string" ? value.state : "idle";
  const text = typeof value.message === "string" ? value.message : "";
  pill.dataset.state = state;
  message.textContent = text;
  indicator.setAttribute("aria-label", state);
  pill.classList.toggle("visible", Boolean(text) && state !== "idle");
}

function renderResponse(value = {}) {
  const open = value.open === true;
  const text = typeof value.text === "string" ? value.text : "";
  if (panelWrapper) {
    panelWrapper.hidden = !open;
    panelWrapper.classList.toggle("visible", open);
  }
  panel.hidden = !open;
  panel.classList.toggle("visible", open);
  if (text) renderMarkdown(responseText, text);
  else responseText.textContent = "No previous output yet.";
  responseText.classList.toggle("empty", !text);
  copyButton.disabled = !text;
  if (!open) {
    clearTimeout(copyFeedbackTimer);
    copyButton.textContent = "Copy";
  }
}
