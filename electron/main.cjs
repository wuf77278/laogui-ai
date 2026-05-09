const { app, BrowserWindow, dialog, shell } = require("electron");
const path = require("node:path");
const net = require("node:net");
const { pathToFileURL } = require("node:url");

const ROOT_DIR = path.join(__dirname, "..");
const SERVER_ENTRY = path.join(ROOT_DIR, "server.mjs");
const DEFAULT_PORT = Number(process.env.PORT || 4177);

let serverPort = DEFAULT_PORT;
let serverReadyPromise = null;
let serverModule = null;
let mainWindow = null;
let shutdownStarted = false;

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
    backgroundColor: "#11100d",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.setZoomFactor(1);
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.setZoomFactor(1);
  });

  await mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
}

async function shutdownLocalService() {
  if (serverModule?.closeLaoguiServer) {
    await serverModule.closeLaoguiServer({ timeoutMs: 2500 }).catch(() => {});
  }
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(createWindow).catch((error) => {
  dialog.showErrorBox("老鬼AI 启动失败", error.message || String(error));
  app.quit();
});

app.on("before-quit", (event) => {
  if (shutdownStarted) return;
  event.preventDefault();
  shutdownStarted = true;
  app.isQuitting = true;
  shutdownLocalService().finally(() => {
    app.exit(0);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
