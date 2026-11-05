/**
 * @stillwatch/collector public API. File ownership:
 * types.ts, index.ts: fixed contracts.
 * config.ts, hook-script.ts, pipeline.ts, process.ts, collector.ts and their
 * helpers: collector core. server/: HTTP server, API, auth, static files.
 */
export type { LogFields, Logger } from './types';
export * from './config';
export * from './hook-script';
export * from './pipeline';
export * from './process';
export * from './collector';
export { createLoginUrl, startHttpServer } from './server';
export type { HttpServerHandle, ServerDeps } from './server';
