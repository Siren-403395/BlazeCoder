/**
 * Server entrypoint. Loads .env from the repo root, builds the runtime, and
 * serves it over HTTP.
 */

import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(import.meta.dirname, "../../../.env") });

const { buildRuntimeFromEnv } = await import("./runtimeFactory");
const { createServer } = await import("./server");

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

const runtime = buildRuntimeFromEnv();
const app = await createServer(runtime, { corsOrigin: process.env.CORS_ORIGIN ?? true });

await app.listen({ port, host });
console.log(`[agent] server listening on http://${host}:${port}`);
