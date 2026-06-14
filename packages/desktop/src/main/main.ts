/**
 * Electron main process: window lifecycle + the IPC bridge to the AgentService.
 * Hardened by default — contextIsolation on, nodeIntegration off, sandbox on, every
 * handler validates its payload before the service sees it, and the only outward action
 * (openExternal) is restricted to http/https.
 */

import { dirname, join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { AgentService } from "./agentService";
import { IPC } from "../shared/ipc";
import {
  validateCwd,
  validateOptionalSessionId,
  validatePermissionDecision,
  validateRunRequest,
  validateSessionId,
  validateUrl,
} from "./validate";
import type { OpenDialogOptions } from "electron";

const runtimeDir = dirname(__filename);

let mainWindow: BrowserWindow | undefined;
let agentService: AgentService | undefined;

/** Open a url externally — http/https ONLY. No file:/openPath fallback (it would open
 *  arbitrary local paths derived from model output). Used by both the IPC handler and the
 *  window-open handler so model-injected window.open is checked the same way. */
async function openExternalSafely(rawUrl: string): Promise<boolean> {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    await shell.openExternal(parsed.toString());
    return true;
  } catch {
    return false;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    title: "blazecoder",
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: join(runtimeDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  agentService = new AgentService((event) => {
    mainWindow?.webContents.send(IPC.agentEvent, event);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalSafely(url);
    return { action: "deny" };
  });

  // Block top-level navigation away from the app (location.href, anchors, form posts) — only
  // the Vite dev server's own reloads are allowed. setWindowOpenHandler covers window.open but
  // not same-frame navigation, so model-injected navigation could otherwise replace the app.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const dev = process.env.BLAZECODER_DESKTOP_DEV_SERVER;
    if (dev && url.startsWith(dev)) return;
    event.preventDefault();
  });

  const devServer = process.env.BLAZECODER_DESKTOP_DEV_SERVER;
  if (devServer) {
    void mainWindow.loadURL(devServer);
  } else {
    void mainWindow.loadFile(join(runtimeDir, "../renderer/index.html"));
  }
}

function service(): AgentService {
  if (!agentService) throw new Error("Desktop service is not ready.");
  return agentService;
}

function registerIpc(): void {
  ipcMain.handle(IPC.openProjectDialog, async () => {
    const options: OpenDialogOptions = { title: "Open a blazecoder workspace", properties: ["openDirectory"] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return undefined;
    return service().openProject(result.filePaths[0]);
  });
  ipcMain.handle(IPC.openProjectPath, (_e, cwd: unknown) => service().openProject(validateCwd(cwd)));
  ipcMain.handle(IPC.getProject, () => service().getProject());
  ipcMain.handle(IPC.runAgent, (_e, request: unknown) => service().run(validateRunRequest(request)));
  ipcMain.handle(IPC.abortAgent, () => service().abort());
  ipcMain.handle(IPC.resolvePermission, (_e, request: unknown) => service().resolvePermission(validatePermissionDecision(request)));
  ipcMain.handle(IPC.listSessions, () => service().listSessions());
  ipcMain.handle(IPC.getSession, (_e, id: unknown) => service().getSession(validateSessionId(id)));
  ipcMain.handle(IPC.compactSession, (_e, sessionId: unknown) => service().compact(validateOptionalSessionId(sessionId)));
  ipcMain.handle(IPC.openExternal, (_e, url: unknown) => openExternalSafely(validateUrl(url)));
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
