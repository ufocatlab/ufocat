const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("surveillance", {
  load: () => ipcRenderer.invoke("app:load"),
  saveCameras: (cameras) => ipcRenderer.invoke("camera:save", cameras),
  saveWorkspaces: (workspaces, activeWorkspaceId) =>
    ipcRenderer.invoke("workspace:save", workspaces, activeWorkspaceId),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  startStream: (id) => ipcRenderer.invoke("stream:start", id),
  stopStream: (id) => ipcRenderer.invoke("stream:stop", id),
  checkFfmpeg: (binary) => ipcRenderer.invoke("system:ffmpeg", binary),
  onStreamStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("stream:status", listener);
    return () => ipcRenderer.removeListener("stream:status", listener);
  },
});
