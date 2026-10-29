import { describe, expect, it } from "vitest";
import { UpstreamProxyError } from "../src/upstream/tunnel.ts";
import { RelayRequestError, relayErrorFor } from "../src/upstream/errors.ts";
import { SsrfBlockedError } from "../src/upstream/ssrf.ts";

describe("relayErrorFor", () => {
  it.each([
    [{ code: "ENOTFOUND" }, "dns", 502],
    [{ code: "EAI_AGAIN" }, "dns", 502],
    [{ code: "ECONNREFUSED" }, "connect", 502],
    [{ code: "UND_ERR_SOCKET" }, "connect", 502],
    [{ code: "UND_ERR_CONNECT_TIMEOUT" }, "timeout", 504],
    [{ code: "UND_ERR_HEADERS_TIMEOUT" }, "timeout", 504],
    [{ code: "UND_ERR_BODY_TIMEOUT" }, "timeout", 504],
    [{ code: "DEPTH_ZERO_SELF_SIGNED_CERT" }, "tls", 502],
    [{ code: "ERR_TLS_CERT_ALTNAME_INVALID" }, "tls", 502],
    [{ code: "CERT_HAS_EXPIRED" }, "tls", 502],
    [{ code: "UND_ERR_HEADERS_OVERFLOW" }, "header_overflow", 502],
    [new SsrfBlockedError("x"), "ssrf_blocked", 403],
    [new RelayRequestError("too_large", 413), "too_large", 413],
    [{ cause: { code: "ENOTFOUND" } }, "dns", 502],
    [new Error("?"), "connect", 502],
  ])("maps %o to %s", (error, code, status) => {
    expect(relayErrorFor(error)).toEqual({ code, status });
  });

  it("maps upstream proxy failures by who failed", () => {
    expect(relayErrorFor(new UpstreamProxyError("proxy", "refused"))).toEqual({ code: "proxy", status: 502 });
    expect(relayErrorFor(new UpstreamProxyError("target", "unreachable"))).toEqual({ code: "connect", status: 502 });
    expect(relayErrorFor(new Error("wrapped", { cause: new UpstreamProxyError("proxy", "x") }))).toEqual({
      code: "proxy",
      status: 502,
    });
  });
});
