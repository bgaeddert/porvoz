import { bridge } from "./app-bridge.js";

export async function loadRuntimeConfig() {
  if (!bridge.isAvailable) {
    throw new Error("Porvoz must be running as the Electron app or served by a Porvoz server.");
  }
  const result = await bridge.getRuntimeConfig();
  if (!Array.isArray(result?.profiles)
    || !result.profiles.length
    || typeof result.activeProfileId !== "string"
    || !result.profiles.some((profile) => profile.id === result.activeProfileId)
    || !result?.models
    || !Array.isArray(result.models.available)
    || !result.models.selected
    || !["low", "medium", "high"].includes(result.models.selected.instructionReasoning)
    || !result.limits
    || !Number.isFinite(result.limits.maxPrefixes)
    || !Number.isFinite(result.limits.maxPrefixNameCharacters)
    || !Number.isFinite(result.limits.maxPrefixInstructionCharacters)
    || !Number.isFinite(result.limits.maxPrefixTotalCharacters)
    || !Array.isArray(result.prefixes)) {
    throw new Error("Could not load the app settings.");
  }
  // Cue volume is a desktop preference the shared server never stores, so it
  // is only required where the sound settings actually exist.
  if (bridge.features.sounds
    && (!Number.isFinite(result.soundVolume) || result.soundVolume < 0 || result.soundVolume > 1)) {
    throw new Error("Could not load the app settings.");
  }
  return result;
}
