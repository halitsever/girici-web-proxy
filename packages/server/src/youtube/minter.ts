import type { Logger } from "../log.ts";
import { proxyFailureLog } from "../upstream/proxy-failure.ts";
import type { FetchLike } from "./botguard-session.ts";
import { PoTokenMinter } from "./potoken.ts";

/** jsdom and BotGuard load on the first token request, so an instance that never plays YouTube never pays for them. */
export function createPoTokenMinter(fetchImpl: FetchLike, logger: Logger): PoTokenMinter {
  const onProxyFailure = proxyFailureLog(logger);
  return new PoTokenMinter(
    async () => {
      const { createBotGuardSession } = await import("./botguard-session.ts");
      return createBotGuardSession(fetchImpl);
    },
    Date.now,
    (error) => {
      logger.debug(`poToken minting failed: ${error instanceof Error ? error.message : String(error)}`);
      onProxyFailure(error);
    },
  );
}
