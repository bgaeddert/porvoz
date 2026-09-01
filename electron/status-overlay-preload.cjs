const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("porvozOverlay", {
  onStatus(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("porvoz:overlay-status", listener);
    return () => ipcRenderer.removeListener("porvoz:overlay-status", listener);
  }
});
