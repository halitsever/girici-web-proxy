import { describe, expect, it } from "vitest";
import { sharedInput } from "../shared";

const params = (query: string) => new URLSearchParams(query);

describe("sharedInput", () => {
  it("takes the shared link first", () => {
    expect(sharedInput(params("url=https://example.com/a&text=Read+this&title=A"))).toBe("https://example.com/a");
  });

  it("finds the link that apps put inside the shared text", () => {
    expect(sharedInput(params("text=Read this: https://example.com/a?b=1 via app"))).toBe("https://example.com/a?b=1");
  });

  it("falls back to the text, then to a typed query", () => {
    expect(sharedInput(params("text=  bosphorus bridge  "))).toBe("bosphorus bridge");
    expect(sharedInput(params("q=cats"))).toBe("cats");
  });

  it("returns nothing for a plain visit", () => {
    expect(sharedInput(params(""))).toBeNull();
    expect(sharedInput(params("url=&text="))).toBeNull();
  });

  it("caps what it copies into the box", () => {
    expect(sharedInput(params(`q=${"a".repeat(5000)}`))?.length).toBe(2048);
  });
});
