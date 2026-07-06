const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("laoguiDesktop", {
  selectDirectory: () => ipcRenderer.invoke("laogui:select-directory")
});
