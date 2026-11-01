import { Transform, type TransformCallback } from "node:stream";
import { HEADER, type RelayErrorCode } from "@girici/engine/shared";
import type { RequestHandler } from "express";

export type RelayKind = "http" | "ws";
export type Direction = "down" | "up";

/** Hears every relay answer and every relayed byte, so the server tools need no hooks in the relays. */
export interface RelayObserver {
  bytes(key: string, count: number, direction: Direction): void;
  /** Once per request: null when it went upstream or the socket's upstream opened, else the refusal or failure. */
  answered(kind: RelayKind, code: RelayErrorCode | null): void;
  /** Only for sockets whose upstream opened. */
  socketClosed(): void;
}

export const NO_OBSERVER: RelayObserver = {
  bytes: () => {},
  answered: () => {},
  socketClosed: () => {},
};

export function observeAll(observers: readonly RelayObserver[]): RelayObserver {
  return {
    bytes: (key, count, direction) => {
      for (const observer of observers) observer.bytes(key, count, direction);
    },
    answered: (kind, code) => {
      for (const observer of observers) observer.answered(kind, code);
    },
    socketClosed: () => {
      for (const observer of observers) observer.socketClosed();
    },
  };
}

/** Every gate refuses through sendRelayError, so the error header at close names whichever one answered. */
export function relayAnswers(observer: RelayObserver): RequestHandler {
  return (_req, res, next) => {
    res.once("close", () => {
      const code = res.getHeader(HEADER.error);
      observer.answered("http", typeof code === "string" ? (code as RelayErrorCode) : null);
    });
    next();
  };
}

export class ByteCounter extends Transform {
  readonly #count: (bytes: number) => void;

  constructor(count: (bytes: number) => void) {
    super();
    this.#count = count;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.#count(chunk.length);
    callback(null, chunk);
  }
}
