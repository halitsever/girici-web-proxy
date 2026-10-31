import type { Logger } from "../log.ts";
import { relayErrorFor } from "./errors.ts";

const WARNING_MS = 60_000;

/** A dead upstream proxy fails every request; one line a minute tells the operator without flooding the log. */
export function proxyFailureLog(logger: Logger, now: () => number = Date.now): (error: unknown) => void {
  let last = -Infinity;
  return (error) => {
    if (relayErrorFor(error).code !== "proxy") return;
    const time = now();
    if (time - last < WARNING_MS) return;
    last = time;
    // The message names the variable, never its value, which can carry credentials.
    logger.warn("Upstream proxy failed; check GIRICI_UPSTREAM_PROXY");
  };
}
