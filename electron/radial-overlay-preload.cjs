const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("porvozRadial", {
  onOpen(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("porvoz:radial-open", listener);
    return () => ipcRenderer.removeListener("porvoz:radial-open", listener);
  },
  onSelection(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("porvoz:radial-selection", listener);
    return () => ipcRenderer.removeListener("porvoz:radial-selection", listener);
  },
  onClose(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("porvoz:radial-close", listener);
    return () => ipcRenderer.removeListener("porvoz:radial-close", listener);
  },
  select(slotId) {
    ipcRenderer.send("porvoz:radial-selection", slotId);
  }
});
