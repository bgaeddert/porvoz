const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("porvozDesktop", {
  isElectron: true,
  getAppVersion() {
    return ipcRenderer.invoke("porvoz:get-app-version");
  },
  getRuntimeConfig() {
    return ipcRenderer.invoke("porvoz:get-runtime-config");
  },
  getBackendSettings() {
    return ipcRenderer.invoke("porvoz:get-backend-settings");
  },
  saveBackendSettings(value) {
    return ipcRenderer.invoke("porvoz:save-backend-settings", value);
  },
  getConnectionSettings() {
    return ipcRenderer.invoke("porvoz:get-connection-settings");
  },
  getSetupStatus() {
    return ipcRenderer.invoke("porvoz:get-setup-status");
  },
  saveConnection(value) {
    return ipcRenderer.invoke("porvoz:save-connection", value);
  },
  populateModels() {
    return ipcRenderer.invoke("porvoz:populate-models");
  },
  saveModelSelections(value) {
    return ipcRenderer.invoke("porvoz:save-model-selections", value);
  },
  createProfile(value) {
    return ipcRenderer.invoke("porvoz:create-profile", value);
  },
  renameProfile(value) {
    return ipcRenderer.invoke("porvoz:rename-profile", value);
  },
  deleteProfile(value) {
    return ipcRenderer.invoke("porvoz:delete-profile", value);
  },
  setActiveProfile(value) {
    return ipcRenderer.invoke("porvoz:set-active-profile", value);
  },
  savePrompt(value) {
    return ipcRenderer.invoke("porvoz:save-prompt", value);
  },
  resetPrompt() {
    return ipcRenderer.invoke("porvoz:reset-prompt");
  },
  savePrefixSettings(value) {
    return ipcRenderer.invoke("porvoz:save-prefix-settings", value);
  },
  getInferenceKey() {
    return ipcRenderer.invoke("porvoz:get-inference-key");
  },
  rotateInferenceKey() {
    return ipcRenderer.invoke("porvoz:rotate-inference-key");
  },
  writeClipboardText(value) {
    return ipcRenderer.invoke("porvoz:write-clipboard-text", value);
  },
  readClipboardText() {
    return ipcRenderer.invoke("porvoz:read-clipboard-text");
  },
  getLogs() {
    return ipcRenderer.invoke("porvoz:get-logs");
  },
  logError(value) {
    return ipcRenderer.invoke("porvoz:log-error", value);
  },
  clearLogs() {
    return ipcRenderer.invoke("porvoz:clear-logs");
  },
  resetToDefaults() {
    return ipcRenderer.invoke("porvoz:reset-to-defaults");
  },
  transcribe(value) {
    return ipcRenderer.invoke("porvoz:transcribe", value);
  },
  createPrefixFromVoice(value) {
    return ipcRenderer.invoke("porvoz:create-prefix-from-voice", value);
  },
  getHotkey() {
    return ipcRenderer.invoke("porvoz:get-hotkey");
  },
  beginHotkeyCapture() {
    return ipcRenderer.invoke("porvoz:begin-hotkey-capture");
  },
  cancelHotkeyCapture() {
    return ipcRenderer.invoke("porvoz:cancel-hotkey-capture");
  },
  setHotkey(value) {
    return ipcRenderer.invoke("porvoz:set-hotkey", value);
  },
  saveSoundVolume(value) {
    return ipcRenderer.invoke("porvoz:save-sound-volume", value);
  },
  setStatus(value) {
    ipcRenderer.send("porvoz:status", value);
  },
  onHotkeyUpdated(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("porvoz:hotkey-updated", listener);
    return () => ipcRenderer.removeListener("porvoz:hotkey-updated", listener);
  },
  onSoundVolumeUpdated(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("porvoz:sound-volume-updated", listener);
    return () => ipcRenderer.removeListener("porvoz:sound-volume-updated", listener);
  },
  onHotkeyCaptureStatus(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("porvoz:hotkey-capture-status", listener);
    return () => ipcRenderer.removeListener("porvoz:hotkey-capture-status", listener);
  },
  onHotkey(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, action, value) => callback(action, value);
    ipcRenderer.on("porvoz:hotkey", listener);
    return () => ipcRenderer.removeListener("porvoz:hotkey", listener);
  },
  onActivityCanceled(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("porvoz:activity-canceled", listener);
    return () => ipcRenderer.removeListener("porvoz:activity-canceled", listener);
  },
  onSetupUpdated(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = () => callback();
    ipcRenderer.on("porvoz:setup-updated", listener);
    return () => ipcRenderer.removeListener("porvoz:setup-updated", listener);
  },
  onLogsUpdated(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("porvoz:logs-updated", listener);
    return () => ipcRenderer.removeListener("porvoz:logs-updated", listener);
  },
  typeText(value) {
    return ipcRenderer.invoke("porvoz:type-text", value);
  }
});
