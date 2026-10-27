import { describe, expect, it } from "vitest";
import { createLogger } from "../src/log.ts";

describe("createLogger", () => {
  it("writes messages at or above the configured level", () => {
    const lines: string[] = [];
    const logger = createLogger("warn", (line) => lines.push(line));
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/WARN.*w$/);
    expect(lines[1]).toMatch(/ERROR.*e$/);
  });
});
