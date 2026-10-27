import type { RelayErrorCode } from "@girici/engine/shared";
import { SsrfBlockedError } from "./ssrf.ts";

export class RelayRequestError extends Error {
  readonly code: RelayErrorCode;
  readonly status: number;

  constructor(code: RelayErrorCode, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NONAME", "EAI_FAIL", "EAI_NODATA"]);
const TIMEOUT_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "ETIMEDOUT",
]);
const TLS_CODE = /^ERR_TLS_|CERT|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO/;

/** undici wraps socket and TLS failures, so the cause chain is searched for the first code we recognise. */
export function relayErrorFor(error: unknown): { code: RelayErrorCode; status: number } {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++, current = (current as { cause?: unknown }).cause) {
    if (current instanceof SsrfBlockedError) return { code: "ssrf_blocked", status: 403 };
    if (current instanceof RelayRequestError) return { code: current.code, status: current.status };
    const code = (current as { code?: unknown }).code;
    if (typeof code !== "string") continue;
    if (DNS_CODES.has(code)) return { code: "dns", status: 502 };
    if (TIMEOUT_CODES.has(code)) return { code: "timeout", status: 504 };
    if (code === "UND_ERR_HEADERS_OVERFLOW") return { code: "header_overflow", status: 502 };
    if (TLS_CODE.test(code)) return { code: "tls", status: 502 };
  }
  return { code: "connect", status: 502 };
}
