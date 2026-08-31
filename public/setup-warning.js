const desktopBridge = window.porvozDesktop;
const warning = document.querySelector("#setup-warning");
const warningMessage = document.querySelector("#setup-warning-message");
const settingsLink = warning?.querySelector('a[href="settings.html"]');

if (desktopBridge?.isElectron) {
  settingsLink?.addEventListener("click", (event) => {
    event.preventDefault();
    desktopBridge.openSettings();
  });
  desktopBridge.onSetupUpdated(() => {
    void refreshSetupWarning();
  });
}

export async function refreshSetupWarning() {
  if (!warning) return null;
  if (!desktopBridge?.isElectron) {
    warning.hidden = true;
    return null;
  }

  try {
    const setupStatus = await desktopBridge.getSetupStatus();
    renderSetupWarning(setupStatus);
    return setupStatus;
  } catch (error) {
    console.error("Could not check Porvoz setup:", error);
    renderSetupWarning({
      ready: false,
      warningMessage: "Open Settings to check the API credentials and selected models before recording."
    });
    return null;
  }
}

function renderSetupWarning(setupStatus) {
  const isReady = setupStatus?.ready === true;
  warning.hidden = isReady;
  if (!isReady) {
    warningMessage.textContent = setupStatus?.warningMessage
      || "Open Settings to finish configuring Porvoz before recording.";
  }
}

void refreshSetupWarning();
