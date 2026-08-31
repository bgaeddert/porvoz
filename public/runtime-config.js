export async function loadRuntimeConfig() {
  const desktopBridge = window.porvozDesktop;
  if (!desktopBridge?.isElectron) {
    throw new Error("Porvoz must be running as the Electron app.");
  }
  const result = await desktopBridge.getRuntimeConfig();
  if (!result?.models
    || !Array.isArray(result.models.available)
    || !result.models.selected
    || !result.limits
    || !Number.isFinite(result.limits.maxInstructionPromptCharacters)
    || !Number.isFinite(result.limits.maxPrefixes)
    || !Number.isFinite(result.limits.maxPrefixNameCharacters)
    || !Number.isFinite(result.limits.maxPrefixInstructionCharacters)
    || !Number.isFinite(result.limits.maxPrefixTotalCharacters)
    || !Number.isFinite(result.soundVolume)
    || result.soundVolume < 0
    || result.soundVolume > 1
    || typeof result.prompt !== "string"
    || !Array.isArray(result.prefixes)) {
    throw new Error("Could not load the app settings.");
  }
  return result;
}
