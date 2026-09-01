const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("porvozDesktop", {
  isElectron: true,
  getAppVersion() {
    return ipcRenderer.invoke("porvoz:get-app-version");
  },
  getRuntimeConfig() {
    return ipcRenderer.invoke("porvoz:get-runtime-config");
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
  savePrompt(value) {
    return ipcRenderer.invoke("porvoz:save-prompt", value);
  },
  resetPrompt() {
    return ipcRenderer.invoke("porvoz:reset-prompt");
  },
  savePrefixes(value) {
    return ipcRenderer.invoke("porvoz:save-prefixes", value);
  },
  resetPrefix(id) {
    return ipcRenderer.invoke("porvoz:reset-prefix", id);
  },
  getLogs() {
    return ipcRenderer.invoke("porvoz:get-logs");
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
  instruct(value) {
    return ipcRenderer.invoke("porvoz:instruct", value);
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
  openSettings() {
    ipcRenderer.send("porvoz:open-settings");
  },
  typeText(value) {
    return ipcRenderer.invoke("porvoz:type-text", value);
  }
});
