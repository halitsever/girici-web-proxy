import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { LANGUAGES } from "@girici/engine/shared";
import { requestLang, SERVER_TEXT, serverText } from "../src/http/page-text.ts";

function request(acceptLanguage?: string): Request {
  return { get: (name: string) => (name.toLowerCase() === "accept-language" ? acceptLanguage : undefined) } as Request;
}

describe("SERVER_TEXT", () => {
  it("covers every listed language", () => {
    expect(Object.keys(SERVER_TEXT).sort()).toEqual(LANGUAGES.map((info) => info.code).sort());
  });
});

describe("requestLang", () => {
  it("follows Accept-Language and falls back to English", () => {
    expect(requestLang(request("tr-TR,tr;q=0.9,en;q=0.8"))).toBe("tr");
    expect(requestLang(request("ja-JP,tr;q=0.5"))).toBe("tr");
    expect(requestLang(request("de-DE,tr;q=0.5"))).toBe("de");
    expect(requestLang(request("en-US,tr;q=0.5"))).toBe("en");
    expect(requestLang(request("*"))).toBe("en");
    expect(requestLang(request())).toBe("en");
  });

  it("lets the UI's own choice win when the caller has it", () => {
    expect(requestLang(request("en-US"), "tr")).toBe("tr");
    expect(requestLang(request("tr"), "auto")).toBe("tr");
  });

  it("reads Turkish, and English for a language not on the list", () => {
    expect(serverText("tr").notActive).toBe("Girici bu sekmede etkin değil. Sayfayı yenileyin.");
    expect(requestLang(request("ja"))).toBe("en");
  });
});
