import { describe, expect, it } from "vitest";
import { workerBootstrapCode } from "../src/client/worker-bootstrap.ts";

const boot = {
  runtimeUrl: "http://p.test/_g/worker.X.js",
  nonce: "0123456789abcdef0123456789abcdef",
  scriptUrl: "http://p.test/~/https/a.test/w.js",
  base: "https://a.test/w.js",
  partition: "__g|https://a.test|",
};

describe("workerBootstrapCode", () => {
  it("loads the runtime first with the worker's base, runtime URL and partition", () => {
    expect(workerBootstrapCode({ ...boot, module: false })).toBe(
      'self.__giriciBase="https://a.test/w.js";self.__giriciRuntime="http://p.test/_g/worker.X.js";' +
        'self.__giriciPartition="__g|https://a.test|";' +
        'importScripts("http://p.test/_g/worker.X.js?n=0123456789abcdef0123456789abcdef",' +
        '"http://p.test/~/https/a.test/w.js");',
    );
    expect(workerBootstrapCode({ ...boot, module: true })).toContain(
      'await import("http://p.test/_g/worker.X.js?n=0123456789abcdef0123456789abcdef");' +
        'await import("http://p.test/~/https/a.test/w.js");',
    );
  });
});
