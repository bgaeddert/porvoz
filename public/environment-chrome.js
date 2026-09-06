import { bridge, isBrowserAdministration } from "./app-bridge.js";

// Adapts the shared pages to the environment they are running in. Desktop-only
// surfaces are removed from the browser document rather than hidden, so nothing
// on the website can reach a control whose behavior only exists in Electron.
// This runs before the page modules so they never see the removed elements.

document.documentElement.dataset.environment = bridge.environment;

if (isBrowserAdministration) {
  document.querySelectorAll("[data-desktop-only]").forEach((element) => element.remove());
  document.querySelectorAll("[data-web-only]").forEach((element) => { element.hidden = false; });
  // Destructive controls act on the shared server, not on one computer, so the
  // browser states that plainly before anyone confirms.
  document.querySelectorAll("[data-shared-server-text]").forEach((element) => {
    element.textContent = element.dataset.sharedServerText;
  });
  wireSignOut();
} else {
  document.querySelectorAll("[data-web-only]").forEach((element) => element.remove());
}

// Signing out is one click away from losing an admin-key session, so it asks
// first. Without the dialog the button still works rather than doing nothing.
function wireSignOut() {
  const signOutButton = document.querySelector("#sign-out");
  if (!signOutButton) return;
  const dialog = document.querySelector("#sign-out-dialog");
  const confirmButton = document.querySelector("#confirm-sign-out");
  const cancelButton = document.querySelector("#cancel-sign-out");

  signOutButton.addEventListener("click", (event) => {
    event.preventDefault();
    if (dialog && confirmButton) dialog.showModal();
    else void bridge.signOut();
  });

  confirmButton?.addEventListener("click", () => {
    confirmButton.disabled = true;
    if (cancelButton) cancelButton.disabled = true;
    void bridge.signOut();
  });
}
