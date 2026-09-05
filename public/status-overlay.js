import { renderMarkdown } from "./markdown-renderer.js";

const surface = document.querySelector("#overlay-surface");
const pill = document.querySelector("#status-pill");
const indicator = document.querySelector("#status-indicator");
const message = document.querySelector("#status-message");
const panel = document.querySelector("#response-panel");
const responseText = document.querySelector("#response-text");
const copyButton = document.querySelector("#copy-response");
const dismissButton = document.querySelector("#dismiss-response");
let copyFeedbackTimer;

pill.addEventListener("mouseenter", () => window.porvozOverlay?.setHovered(true));
surface.addEventListener("mouseleave", () => window.porvozOverlay?.setHovered(false));
copyButton.addEventListener("click", async () => {
  const copied = await window.porvozOverlay?.copyResponse();
  if (!copied) return;
  clearTimeout(copyFeedbackTimer);
  copyButton.textContent = "Copied";
  copyFeedbackTimer = setTimeout(() => { copyButton.textContent = "Copy"; }, 1200);
});
dismissButton.addEventListener("click", () => window.porvozOverlay?.dismiss());
responseText.addEventListener("click", (event) => {
  const link = event.target.closest?.("a[data-external-url]");
  if (!link) return;
  event.preventDefault();
  window.porvozOverlay?.openExternal(link.dataset.externalUrl);
});

window.porvozOverlay?.onStatus(renderStatus);
window.porvozOverlay?.onResponse(renderResponse);
window.porvozOverlay?.onHide(() => pill.classList.remove("visible"));

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
