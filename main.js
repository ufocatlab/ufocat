const { app, BrowserWindow, ipcMain, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
let mainWindow;
let streamServer;
let streamPort;
let stateFile;
const streamJobs = new Map();
const state = {
  cameras: [],
  workspaces: [],
  activeWorkspaceId: null,
  settings: {
    ffmpegPath: "ffmpeg",
    streamQuality: "balanced",
    autoReconnect: true,
  },
};
const defaultWorkspace = { id: "workspace-main", name: "My workspace" };


function persist() {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
}
function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (Array.isArray(saved.cameras)) state.cameras = saved.cameras;
    if (Array.isArray(saved.workspaces) && saved.workspaces.length)
      state.workspaces = saved.workspaces;
    if (saved.activeWorkspaceId)
      state.activeWorkspaceId = saved.activeWorkspaceId;
    if (saved.settings && typeof saved.settings === "object")
      state.settings = { ...state.settings, ...saved.settings };
  } catch {
    persist();
  }
  if (!state.workspaces.length) state.workspaces = [{ ...defaultWorkspace }];
  if (
    !state.workspaces.some(
      (workspace) => workspace.id === state.activeWorkspaceId,
    )
  )
    state.activeWorkspaceId = state.workspaces[0].id;
  const workspaceIds = new Set(
    state.workspaces.map((workspace) => workspace.id),
  );
  state.cameras = state.cameras
    .filter((camera) => camera && camera.id && camera.name)
    .map((camera) => ({
      ...camera,
      workspaceId: workspaceIds.has(camera.workspaceId)
        ? camera.workspaceId
        : state.activeWorkspaceId,
    }));
  persist();
}
function safeCamera(camera) {
  return {
    id: camera.id,
    name: camera.name,
    type: camera.type,
    url: camera.url || "",
    deviceId: camera.deviceId || "",
    workspaceId: camera.workspaceId || state.activeWorkspaceId,
    sortOrder: camera.sortOrder || 0,
  };
}
function makeWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1080,
    minHeight: 700,
    fullscreenable: true,
    backgroundColor: "#08121d",
    title: "UFO.Cat Security",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) =>
    console.error("[UFO.Cat] page failed to load", code, description, url),
  );
  mainWindow.webContents.on("did-finish-load", async () => {
    try {
      const hasBridge = await mainWindow.webContents.executeJavaScript(
        "Boolean(window.surveillance && window.surveillance.saveCameras)",
      );
      if (!hasBridge)
        console.error(
          `[UFO.Cat] preload bridge missing. Expected ${path.join(__dirname, "preload.js")}`,
        );
    } catch (error) {
      console.error("[UFO.Cat] preload check failed", error);
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    for (const id of [...streamJobs.keys()]) stopRtsp(id);
  });


    // Windows
    if (process.platform === 'win32') {
        mainWindow.setIcon(path.join(__dirname, 'assets/windows/icon.ico'));
    }

    // Linux
    if (process.platform === 'linux') {
        mainWindow.setIcon(path.join(__dirname, 'assets/linux/icons/512x512.png'));
    }
}

function broadcastFrame(job, jpeg) {
  if (!job.hasFrame) {
    job.hasFrame = true;
    notifyStream(job.id, "live", "Camera stream is receiving video.");
  }
  for (const client of job.clients) {
    if (client.destroyed) {
      job.clients.delete(client);
      continue;
    }
    client.write(
      `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`,
    );
    client.write(jpeg);
    client.write("\r\n");
  }
}
function createStreamServer() {
  streamServer = http.createServer((req, res) => {
    const match = /^\/stream\/([a-zA-Z0-9_-]+)$/.exec(
      new URL(req.url, "http://127.0.0.1").pathname,
    );
    if (!match) {
      res.writeHead(404).end();
      return;
    }
    const job = streamJobs.get(match[1]);
    if (!job) {
      res
        .writeHead(503, { "Cache-Control": "no-store" })
        .end("Stream is not running");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "multipart/x-mixed-replace; boundary=frame",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Connection: "keep-alive",
    });
    job.clients.add(res);
    res.on("close", () => job.clients.delete(res));
  });
  return new Promise((resolve) =>
    streamServer.listen(0, "127.0.0.1", () => {
      streamPort = streamServer.address().port;
      resolve();
    }),
  );
}
function startRtsp(id) {
  const camera = state.cameras.find((item) => item.id === id);
  if (!camera || camera.type !== "rtsp" || !camera.url)
    throw new Error("Camera has no RTSP URL.");
  stopRtsp(id);
  const quality = state.settings.streamQuality;
  const target =
    quality === "high" ? "1280" : quality === "low" ? "640" : "960";
  const fps = quality === "high" ? "12" : quality === "low" ? "5" : "8";
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-rtsp_transport",
    "tcp",
    "-timeout",
    "8000000",
    "-i",
    camera.url,
    "-an",
    "-vf",
    `fps=${fps},scale=${target}:-2:force_original_aspect_ratio=decrease`,
    "-f",
    "image2pipe",
    "-vcodec",
    "mjpeg",
    "-q:v",
    quality === "high" ? "4" : "6",
    "pipe:1",
  ];
  const child = spawn(state.settings.ffmpegPath || "ffmpeg", args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const job = {
    id,
    child,
    clients: new Set(),
    buffer: Buffer.alloc(0),
    stderr: "",
    hasFrame: false,
  };
  streamJobs.set(id, job);
  child.stdout.on("data", (chunk) => {
    job.buffer = Buffer.concat([job.buffer, chunk]);
    while (true) {
      const start = job.buffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (start < 0) {
        job.buffer = job.buffer.subarray(Math.max(0, job.buffer.length - 1));
        break;
      }
      const end = job.buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
      if (end < 0) {
        if (start > 0) job.buffer = job.buffer.subarray(start);
        break;
      }
      const jpeg = job.buffer.subarray(start, end + 2);
      job.buffer = job.buffer.subarray(end + 2);
      broadcastFrame(job, jpeg);
    }
    if (job.buffer.length > 8 * 1024 * 1024)
      job.buffer = job.buffer.subarray(-1024 * 1024);
  });
  child.stderr.on("data", (chunk) => {
    job.stderr = (job.stderr + chunk.toString()).slice(-2000);
  });
  child.on("error", (error) => notifyStream(id, "error", error.message));
  child.on("close", (code) => {
    if (streamJobs.get(id) !== job) return;
    streamJobs.delete(id);
    for (const client of job.clients) client.end();
    notifyStream(
      id,
      code === 0 ? "stopped" : "error",
      job.stderr.trim() || `FFmpeg exited with code ${code}.`,
    );
    if (
      state.settings.autoReconnect &&
      state.cameras.some((item) => item.id === id && item.type === "rtsp")
    ) {
      setTimeout(() => {
        if (!streamJobs.has(id)) {
          try {
            startRtsp(id);
          } catch (error) {
            notifyStream(id, "error", error.message);
          }
        }
      }, 2500);
    }
  });
  notifyStream(id, "connecting", "Connecting to camera…");
  return `http://127.0.0.1:${streamPort}/stream/${id}`;
}
function notifyStream(id, status, message) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("stream:status", { id, status, message });
}
function stopRtsp(id) {
  const job = streamJobs.get(id);
  if (!job) return;
  streamJobs.delete(id);
  job.child.kill("SIGTERM");
  for (const client of job.clients) client.end();
}

ipcMain.handle("app:load", () => ({
  cameras: state.cameras
    .map(safeCamera)
    .sort((a, b) => a.sortOrder - b.sortOrder),
  workspaces: state.workspaces,
  activeWorkspaceId: state.activeWorkspaceId,
  settings: state.settings,
  streamPort,
}));
ipcMain.handle("camera:save", (_event, next) => {
  if (!Array.isArray(next) || next.length > 128)
    throw new Error("Invalid camera list.");
  const ids = new Set();
  const cameras = next.map((item, index) => {
    const id = String(item.id || "");
    const name = String(item.name || "")
      .trim()
      .slice(0, 80);
    const type = item.type === "webcam" ? "webcam" : "rtsp";
    const url = String(item.url || "")
      .trim()
      .slice(0, 2048);
    const workspaceId = String(item.workspaceId || "");
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ids.has(id) || !name)
      throw new Error("Camera name or ID is invalid.");
    if (!state.workspaces.some((workspace) => workspace.id === workspaceId))
      throw new Error("Choose a valid workplace for this camera.");
    ids.add(id);
    if (type === "rtsp" && url && !/^rtsps?:\/\//i.test(url))
      throw new Error("Camera URL must use rtsp:// or rtsps://.");
    return {
      id,
      name,
      type,
      url,
      deviceId: String(item.deviceId || "").slice(0, 512),
      workspaceId,
      sortOrder: index,
    };
  });
  for (const [id] of streamJobs)
    if (!cameras.some((camera) => camera.id === id)) stopRtsp(id);
  state.cameras = cameras;
  persist();
  return state.cameras.map(safeCamera);
});
ipcMain.handle("workspace:save", (_event, next, activeWorkspaceId) => {
  if (!Array.isArray(next) || next.length < 1 || next.length > 50)
    throw new Error("Keep at least one workplace.");
  const ids = new Set();
  const workspaces = next.map((item) => {
    const id = String(item.id || "");
    const name = String(item.name || "")
      .trim()
      .slice(0, 60);
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ids.has(id) || !name)
      throw new Error("Workplace name or ID is invalid.");
    ids.add(id);
    return { id, name };
  });
  if (state.cameras.some((camera) => !ids.has(camera.workspaceId)))
    throw new Error("Move cameras before removing this workplace.");
  state.workspaces = workspaces;
  state.activeWorkspaceId = ids.has(activeWorkspaceId)
    ? activeWorkspaceId
    : workspaces[0].id;
  persist();
  return {
    workspaces: state.workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
  };
});
ipcMain.handle("settings:save", (_event, next) => {
  const quality = ["low", "balanced", "high"].includes(next.streamQuality)
    ? next.streamQuality
    : "balanced";
  const ffmpegPath =
    String(next.ffmpegPath || "ffmpeg")
      .trim()
      .slice(0, 512) || "ffmpeg";
  const needsRestart =
    quality !== state.settings.streamQuality ||
    ffmpegPath !== state.settings.ffmpegPath;
  state.settings = {
    ffmpegPath,
    streamQuality: quality,
    autoReconnect: next.autoReconnect !== false,
  };
  persist();
  if (needsRestart) for (const id of [...streamJobs.keys()]) startRtsp(id);
  return state.settings;
});
ipcMain.handle("stream:start", (_event, id) => startRtsp(String(id)));
ipcMain.handle("stream:stop", (_event, id) => {
  stopRtsp(String(id));
  return true;
});
ipcMain.handle("system:ffmpeg", async (_event, binary) => {
  try {
    const { stdout } = await execFileAsync(binary || "ffmpeg", ["-version"], {
      timeout: 4000,
    });
    return { ok: true, version: stdout.split("\n")[0] };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});
app.whenReady().then(async () => {
  stateFile = path.join(app.getPath("userData"), "surveillance-config.json");
  loadState();
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const trustedApp = webContents.getURL().startsWith("file://");
      if (!trustedApp) {
        callback(false);
        return;
      }

      if (permission === "fullscreen") {
        callback(true);
        return;
      }

      callback(
        permission === "media" &&
          (!details.mediaTypes || details.mediaTypes.includes("video")),
      );
    },
  );
  await createStreamServer();
  makeWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) makeWindow();
  });
});
app.on("before-quit", () => {
  for (const [id] of streamJobs) stopRtsp(id);
  if (streamServer) streamServer.close();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
