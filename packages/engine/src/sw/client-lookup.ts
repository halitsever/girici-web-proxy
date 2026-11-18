/** Firefox never settles clients.get() for a worker blocked in a synchronous importScripts, so a script load gives up. */
export const SCRIPT_LOOKUP_WAIT = 200;
/** For endpoints the runtime calls with fetch(), since a busy WebKit can take longer than that to find a page that just loaded. */
export const CALLER_LOOKUP_WAIT = 2000;

export function lookupClient<C>(
  clients: { get(id: string): Promise<C | undefined> },
  id: string,
  wait: number,
): Promise<C | undefined> {
  if (!id) return Promise.resolve(undefined);
  let timer: number | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(resolve, wait);
  });
  return Promise.race([clients.get(id), timeout]).finally(() => clearTimeout(timer));
}
