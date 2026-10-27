import { describe, expect, it } from "vitest";
import { serviceWorkerSupport } from "../proxy";

describe("serviceWorkerSupport", () => {
  it.each([
    [{ isSecureContext: true, hasServiceWorker: true }, "ok"],
    [{ isSecureContext: false, hasServiceWorker: false }, "insecure"],
    [{ isSecureContext: true, hasServiceWorker: false }, "unsupported"],
  ])("serviceWorkerSupport(%o) is %s", (env, expected) => {
    expect(serviceWorkerSupport(env)).toBe(expected);
  });
});
