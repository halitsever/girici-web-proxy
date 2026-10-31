import { describe, expect, it } from "vitest";
import { locationCheck } from "../src/client/runtime.ts";

describe("locationCheck", () => {
  it("knows a Location by its own href getter, not by a tag the page can change", () => {
    const real = {};
    Object.defineProperty(real, "href", {
      get(this: unknown) {
        if (this !== real && this !== other) throw new TypeError("Illegal invocation");
        return "http://proxy.test/";
      },
    });
    const other = Object.create(null) as object;
    const isLocation = locationCheck(real);
    expect(isLocation(real)).toBe(true);
    expect(isLocation(other)).toBe(true);
    expect(isLocation({ [Symbol.toStringTag]: "Location" })).toBe(false);
    expect(isLocation("http://proxy.test/")).toBe(false);
  });
});
