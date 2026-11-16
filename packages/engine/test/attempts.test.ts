import { describe, expect, it } from "vitest";
import { nextBootAttempt, nextStep, replayForm, type BootState } from "../src/boot/attempts.ts";

describe("replayForm", () => {
  it("submits through the form's own method even when a field is named submit", () => {
    const submitted: unknown[] = [];
    const proto = {
      submit(this: unknown) {
        submitted.push(this);
      },
    };
    const form = Object.assign(Object.create(proto) as object, { submit: { name: "submit", value: "1" } });
    expect(() => (form as { submit(): void }).submit()).toThrow(TypeError);
    replayForm(form, proto.submit);
    expect(submitted).toEqual([form]);
  });
});

describe("nextStep", () => {
  it("replays a form the server kept, else reloads", () => {
    const ids: string[] = [];
    const page = (form: unknown) => ({
      getElementById(id: string): unknown {
        ids.push(id);
        return form;
      },
    });
    expect(nextStep(page({}))).toBe("replay");
    expect(nextStep(page(null))).toBe("reload");
    expect(ids).toEqual(["girici-replay", "girici-replay"]);
  });
});

describe("nextBootAttempt", () => {
  it("allows three boots within 30 seconds, then stops", () => {
    let state: BootState | null = null;
    for (let i = 1; i <= 3; i++) {
      const next = nextBootAttempt(state, 1_000 + i);
      expect(next.allowed).toBe(true);
      state = next.state;
    }
    expect(nextBootAttempt(state, 1_010).allowed).toBe(false);
  });

  it("starts over after the window", () => {
    expect(nextBootAttempt({ count: 3, firstAt: 0 }, 30_001)).toEqual({
      allowed: true,
      state: { count: 1, firstAt: 30_001 },
    });
  });
});
