import { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { ByteCounter, observeAll, type RelayObserver } from "../src/http/relay-observer.ts";

function recorder(name: string, into: string[]): RelayObserver {
  return {
    bytes: (key, count, direction) => into.push(`${name} bytes ${key} ${count} ${direction}`),
    answered: (kind, code) => into.push(`${name} answered ${kind} ${code}`),
    socketClosed: () => into.push(`${name} closed`),
  };
}

describe("observeAll", () => {
  it("tells every observer what happened, in order", () => {
    const heard: string[] = [];
    const both = observeAll([recorder("a", heard), recorder("b", heard)]);
    both.bytes("k", 3, "up");
    both.answered("ws", null);
    both.socketClosed();
    expect(heard).toEqual([
      "a bytes k 3 up",
      "b bytes k 3 up",
      "a answered ws null",
      "b answered ws null",
      "a closed",
      "b closed",
    ]);
  });
});

describe("ByteCounter", () => {
  it("passes chunks through unchanged and counts their bytes", async () => {
    const counts: number[] = [];
    const out = Readable.from([Buffer.from("hello "), Buffer.from("world")]).pipe(
      new ByteCounter((bytes) => counts.push(bytes)),
    );
    expect(await text(out)).toBe("hello world");
    expect(counts).toEqual([6, 5]);
  });
});
