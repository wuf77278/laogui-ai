const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("laoguiDesktop", {
  selectDirectory: () => ipcRenderer.invoke("laogui:select-directory"),
  getUpdateState: () => ipcRenderer.invoke("laogui:get-update-state"),
  checkForUpdates: () => ipcRenderer.invoke("laogui:check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("laogui:install-update"),
  onUpdateState: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("laogui:update-state", listener);
    return () => ipcRenderer.removeListener("laogui:update-state", listener);
  }
});
