/**
 * Default impls of the cross-cutting ports. The pure loop uses the injected
 * Clock/Logger; tests pass a FixedClock + silentLogger, the server passes
 * systemClock + a console logger.
 */

import type { Clock, Logger } from "./ports";

export const systemClock: Clock = { now: () => Date.now() };

export class FixedClock implements Clock {
  constructor(private t = 0) {}
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  set(t: number): void {
    this.t = t;
  }
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export function consoleLogger(prefix = "agent"): Logger {
  const fmt = (level: string, msg: string, meta?: Record<string, unknown>) =>
    `[${prefix}] ${level} ${msg}${meta ? ` ${JSON.stringify(meta)}` : ""}`;
  return {
    debug: (msg, meta) => console.debug(fmt("debug", msg, meta)),
    info: (msg, meta) => console.info(fmt("info", msg, meta)),
    warn: (msg, meta) => console.warn(fmt("warn", msg, meta)),
    error: (msg, meta) => console.error(fmt("error", msg, meta)),
  };
}
