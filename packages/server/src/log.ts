import { styleText } from "node:util";
import type { LogLevel } from "./config.ts";

export interface Logger {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
}

const SEVERITY: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const COLOR: Record<LogLevel, "red" | "yellow" | "green" | "gray"> = {
  error: "red",
  warn: "yellow",
  info: "green",
  debug: "gray",
};

/** Writes plain lines to `write` when given; otherwise colored lines to stdout, plain when it is not a TTY. */
export function createLogger(level: LogLevel, write?: (line: string) => void): Logger {
  const log = (messageLevel: LogLevel, message: string) => {
    if (SEVERITY[messageLevel] > SEVERITY[level]) return;
    const time = new Date().toISOString();
    const tag = messageLevel.toUpperCase().padEnd(5);
    if (write) {
      write(`${time} ${tag} ${message}`);
    } else {
      process.stdout.write(`${time} ${styleText(COLOR[messageLevel], tag)} ${message}\n`);
    }
  };
  return {
    error: (message) => log("error", message),
    warn: (message) => log("warn", message),
    info: (message) => log("info", message),
    debug: (message) => log("debug", message),
  };
}
