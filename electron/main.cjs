const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const net = require("node:net");
const { pathToFileURL } = require("node:url");

const ROOT_DIR = path.join(__dirname, "..");
const SERVER_ENTRY = path.join(ROOT_DIR, "server.mjs");
const DEFAULT_PORT = Number(process.env.PORT || 4177);
const PRELOAD_ENTRY = path.join(ROOT_DIR, "electron", "preload.cjs");
const APP_ICON_PATH = path.join(ROOT_DIR, "electron", "assets", "icon.png");
const SHUTDOWN_TIMEOUT_MS = 6000;
const SERVER_SHUTDOWN_TIMEOUT_MS = 3500;

let serverPort = DEFAULT_PORT;
let serverReadyPromise = null;
let serverModule = null;
let mainWindow = null;
let shutdownStarted = false;
let forceExitTimer = null;

if (process.platform === "win32") {
  app.setAppUserModelId("cn.laogui.ai");
  app.commandLine.appendSwitch("high-dpi-support", "1");
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

function waitForServer(port, timeoutMs = 30000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Local service did not start on port ${port}.`));
          return;
        }
        setTimeout(probe, 250);
      });
    };
    probe();
  });
}

function portAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once("error", () => resolve(false))
      .once("listening", () => {
        tester.close(() => resolve(true));
      })
      .listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 30; port += 1) {
    if (await portAvailable(port)) return port;
  }
  throw new Error(`No available local port found near ${startPort}.`);
}

function parseNavigationUrl(url) {
  try {
    return new URL(String(url || ""));
  } catch {
    return null;
  }
}

function isAppUrl(url) {
  const parsed = parseNavigationUrl(url);
  return Boolean(
    parsed
    && parsed.protocol === "http:"
    && parsed.hostname === "127.0.0.1"
    && Number(parsed.port || 80) === serverPort
  );
}

function isSafeExternalUrl(url) {
  const parsed = parseNavigationUrl(url);
  return Boolean(parsed && ["http:", "https:", "mailto:"].includes(parsed.protocol));
}

function openExternalSafely(url) {
  if (!isSafeExternalUrl(url)) return;
  shell.openExternal(url).catch(() => {});
}

function protectAppNavigation(webContents) {
  webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: "deny" };
  });

  webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternalSafely(url);
  });

  webContents.on("will-redirect", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternalSafely(url);
  });

  webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
}

async function startServer() {
  if (serverReadyPromise) return serverReadyPromise;

  const dataDir = path.join(app.getPath("userData"), "data");
  serverReadyPromise = (async () => {
    serverPort = await findAvailablePort(DEFAULT_PORT);
    process.env.PORT = String(serverPort);
    process.env.LAOGUI_DATA_DIR = dataDir;
    serverModule = await import(pathToFileURL(SERVER_ENTRY).href);
    await waitForServer(serverPort);
  })();
  return serverReadyPromise;
}

async function createWindow() {
  await startServer();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1120,
    minHeight: 760,
    title: "老鬼AI",
    icon: APP_ICON_PATH,
    backgroundColor: "#11100d",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: PRELOAD_ENTRY
    }
  });

  protectAppNavigation(mainWindow.webContents);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.on("unresponsive", () => {
    dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "老鬼AI 暂时无响应",
      message: "当前窗口暂时无响应，可以等待正在执行的任务完成，或关闭应用后重新打开。"
    }).catch(() => {});
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    if (shutdownStarted) return;
    dialog.showErrorBox("老鬼AI 窗口异常退出", `渲染进程已结束：${details.reason || "unknown"}。请重新打开应用。`);
    requestAppShutdown("render-process-gone");
  });
  mainWindow.webContents.setZoomFactor(1);
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.setZoomFactor(1);
  });

  await mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
}

async function shutdownLocalService() {
  if (serverModule?.closeLaoguiServer) {
    await serverModule.closeLaoguiServer({ timeoutMs: SERVER_SHUTDOWN_TIMEOUT_MS }).catch(() => {});
  }
}

function clearForceExitTimer() {
  if (!forceExitTimer) return;
  clearTimeout(forceExitTimer);
  forceExitTimer = null;
}

function requestAppShutdown(reason = "quit") {
  if (shutdownStarted) return;
  shutdownStarted = true;
  app.isQuitting = true;
  forceExitTimer = setTimeout(() => {
    app.exit(0);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref?.();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeAllListeners("close");
    mainWindow.close();
  }

  shutdownLocalService()
    .catch((error) => {
      console.warn(`[electron] shutdown after ${reason} failed: ${error.message || error}`);
    })
    .finally(() => {
      clearForceExitTimer();
      app.exit(0);
    });
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(createWindow).catch((error) => {
  dialog.showErrorBox("老鬼AI 启动失败", error.message || String(error));
  requestAppShutdown("startup-failed");
});

ipcMain.handle("laogui:select-directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择生成图片保存位置",
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths?.[0]) return null;
  return result.filePaths[0];
});

app.on("before-quit", (event) => {
  if (shutdownStarted) return;
  event.preventDefault();
  requestAppShutdown("before-quit");
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  requestAppShutdown("window-all-closed");
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

process.on("SIGTERM", () => requestAppShutdown("SIGTERM"));
process.on("SIGINT", () => requestAppShutdown("SIGINT"));
