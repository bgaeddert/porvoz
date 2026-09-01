const desktopBridge = window.porvozDesktop;
const versionTargets = document.querySelectorAll("[data-app-version]");

if (desktopBridge?.isElectron && versionTargets.length) {
  try {
    const version = await desktopBridge.getAppVersion();
    if (typeof version === "string" && version.trim()) {
      versionTargets.forEach((target) => {
        target.textContent = `v${version.trim()}`;
      });
    }
  } catch (error) {
    console.error("Could not load the application version:", error);
  }
}
