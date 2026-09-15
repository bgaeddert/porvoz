const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("porvozOverlay", {
  onStatus(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("porvoz:overlay-status", listener);
    return () => ipcRenderer.removeListener("porvoz:overlay-status", listener);
  },
  onHide(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = () => callback();
    ipcRenderer.on("porvoz:overlay-hide", listener);
    return () => ipcRenderer.removeListener("porvoz:overlay-hide", listener);
  },
  onResponse(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("porvoz:overlay-response", listener);
    return () => ipcRenderer.removeListener("porvoz:overlay-response", listener);
  },
  onCaptureSettings(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("porvoz:overlay-capture-settings", listener);
    return () => ipcRenderer.removeListener("porvoz:overlay-capture-settings", listener);
  },
  getCaptureSettings() {
    return ipcRenderer.invoke("porvoz:overlay-get-capture-settings");
  },
  saveConsoleSelectionEnabled(value) {
    return ipcRenderer.invoke("porvoz:overlay-save-console-selection", value);
  },
  saveSelectionCaptureEnabled(value) {
    return ipcRenderer.invoke("porvoz:overlay-save-selection-capture", value);
  },
  copyResponse() {
    return ipcRenderer.invoke("porvoz:overlay-copy");
  },
  openExternal(url) {
    return ipcRenderer.invoke("porvoz:overlay-open-external", url);
  },
  dismiss() {
    ipcRenderer.send("porvoz:overlay-dismiss");
  },
  hover() {
    ipcRenderer.send("porvoz:overlay-hover");
  }
});
