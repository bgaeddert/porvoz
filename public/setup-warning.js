import { bridge } from "./app-bridge.js";

const warning = document.querySelector("#setup-warning");
const warningMessage = document.querySelector("#setup-warning-message");

// Only the desktop pushes setup changes; the browser refreshes on navigation.
bridge.onSetupUpdated?.(() => {
  void refreshSetupWarning();
});

export async function refreshSetupWarning() {
  if (!warning) return null;
  if (!bridge.isAvailable) {
    warning.hidden = true;
    return null;
  }

  try {
    const setupStatus = await bridge.getSetupStatus();
    renderSetupWarning(setupStatus);
    return setupStatus;
  } catch (error) {
    console.error("Could not check Porvoz setup:", error);
    renderSetupWarning({
      ready: false,
      warningMessage: "Open Provider & models to check the API credentials and selected models before recording."
    });
    return null;
  }
}

function renderSetupWarning(setupStatus) {
  const isReady = setupStatus?.ready === true;
  warning.hidden = isReady;
  if (!isReady) {
    warningMessage.textContent = setupStatus?.warningMessage
      || "Open Provider & models to finish configuring Porvoz before using the recorder.";
  }
}

void refreshSetupWarning();
