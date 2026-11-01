import { request, type IncomingHttpHeaders } from "node:http";

export interface Sent {
  status: number;
  headers: IncomingHttpHeaders;
  /** Every Set-Cookie value, in order. */
  cookies: string[];
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface SendOptions {
  host: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** fetch cannot set Host, so requests that need one go through node:http to the server at `base`. */
export function hostRequest(base: string, path: string, options: SendOptions): Promise<Sent> {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: hostname,
        port,
        path,
        method: options.method ?? "GET",
        headers: { ...options.headers, host: options.host },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString();
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            cookies: res.headers["set-cookie"] ?? [],
            text: async () => body,
            json: async () => JSON.parse(body) as unknown,
          });
        });
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}
