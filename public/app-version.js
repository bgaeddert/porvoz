const desktopBridge = window.porvozDesktop;
const versionTargets = document.querySelectorAll("[data-app-version]");
const brand = document.querySelector(".brand");

if (desktopBridge?.isElectron && versionTargets.length) {
  try {
    const version = await desktopBridge.getAppVersion();
    if (typeof version === "string" && version.trim()) {
      versionTargets.forEach((target) => {
        target.textContent = `v${version.trim()}`;
      });
      // The sidebar footer is hidden once the rail collapses, so the brand mark
      // carries the version too and it stays reachable at every window width.
      if (brand) brand.title = `Porvoz v${version.trim()}`;
    }
  } catch (error) {
    console.error("Could not load the application version:", error);
  }
}
