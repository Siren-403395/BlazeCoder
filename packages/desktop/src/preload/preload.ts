/**
 * Preload: expose ONLY the whitelisted DesktopApi on window.blazecoder via contextBridge.
 * No fs/child_process/ipcRenderer leaks into the renderer global. Uses only Electron's
 * contextBridge + ipcRenderer and a bundled type-only IPC const map, so the window can run
 * with sandbox:true.
 */

import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc";
import type { AgentEvent } from "@blazecoder/shared";
import type { DesktopApi, DesktopRunRequest, PermissionDecisionRequest } from "../shared/ipc";

const api: DesktopApi = {
  openProjectDialog: () => ipcRenderer.invoke(IPC.openProjectDialog),
  openProjectPath: (cwd: string) => ipcRenderer.invoke(IPC.openProjectPath, cwd),
  getProject: () => ipcRenderer.invoke(IPC.getProject),
  runAgent: (request: DesktopRunRequest) => ipcRenderer.invoke(IPC.runAgent, request),
  abortAgent: () => ipcRenderer.invoke(IPC.abortAgent),
  resolvePermission: (request: PermissionDecisionRequest) => ipcRenderer.invoke(IPC.resolvePermission, request),
  listSessions: () => ipcRenderer.invoke(IPC.listSessions),
  getSession: (id: string) => ipcRenderer.invoke(IPC.getSession, id),
  compactSession: (sessionId?: string) => ipcRenderer.invoke(IPC.compactSession, sessionId),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.openExternal, url),
  onAgentEvent: (listener: (event: AgentEvent) => void) => {
    const wrapped = (_e: Electron.IpcRendererEvent, payload: AgentEvent) => listener(payload);
    ipcRenderer.on(IPC.agentEvent, wrapped);
    return () => ipcRenderer.off(IPC.agentEvent, wrapped);
  },
};

contextBridge.exposeInMainWorld("blazecoder", api);
