const pill = document.querySelector("#status-pill");
const indicator = document.querySelector("#status-indicator");
const message = document.querySelector("#status-message");

window.porvozOverlay?.onStatus(renderStatus);

function renderStatus(value = {}) {
  const state = typeof value.state === "string" ? value.state : "idle";
  const text = typeof value.message === "string" ? value.message : "";
  pill.dataset.state = state;
  message.textContent = text;
  indicator.setAttribute("aria-label", state);
  pill.classList.toggle("visible", Boolean(text) && state !== "idle");
}
