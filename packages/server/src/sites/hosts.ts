import { labelSiteOf } from "@girici/engine/label-site";
import { classifySiteHost, siteLabel, type HostKind, type SiteDomain } from "@girici/engine/shared";
import type { RequestHandler, Response } from "express";
import type { SiteSetup } from "./keys.ts";

/** `single` means no site domain is set, so every host gets every route as before subdomain mode. */
export type RequestHost = { kind: "single" } | HostKind;

const SINGLE: RequestHost = { kind: "single" };

/** Reads the raw Host header only: Express's hostname would take X-Forwarded-Host from a trusted proxy. */
export function hostKinds(domain: SiteDomain | undefined): RequestHandler {
  return (req, res, next) => {
    res.locals.host = domain ? classifySiteHost(req.headers.host, domain) : SINGLE;
    next();
  };
}

export function requestHost(res: Response): RequestHost {
  return (res.locals.host as RequestHost | undefined) ?? SINGLE;
}

/** Runs `handler` on the listed host kinds; elsewhere the request moves on as if the route did not exist. */
export function onHosts(kinds: ReadonlyArray<RequestHost["kind"]>, handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    if (kinds.includes(requestHost(res).kind)) return handler(req, res, next);
    next();
  };
}

/** The host, without scheme, that serves `target`'s site. */
export function siteHostFor(target: URL, setup: SiteSetup): string {
  return `${siteLabel(setup.keys.label, labelSiteOf(target))}.${setup.domain.value}`;
}
