import type { DesktopApi } from "../shared/ipc";

declare global {
  interface Window {
    zephyrcode: DesktopApi;
  }
}

export {};
