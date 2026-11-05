/**
 * Public types of the collector's HTTP server, re-exported from ./index.
 */
import type { Server } from 'node:http';
import type { StatusResponse, StillwatchConfig } from '@stillwatch/schema';
import type { Store } from '@stillwatch/storage';
import type { Logger } from '../types';

export type ServerDeps = {
  store: Store;
  config: StillwatchConfig;
  version: string;
  /** Built dashboard directory, or null to serve a short "dashboard not built" page. */
  webRoot: string | null;
  /** 0 picks a free port (tests). Always binds 127.0.0.1. */
  port: number;
  logger: Logger;
  now: () => number;
  /** The user's home directory, for path display in reports. */
  userHome: string;
  /** Builds the /api/status payload. Implemented by the collector core. */
  getStatus: () => Promise<StatusResponse>;
  /** Asks the pipeline to re-analyze a session soon. */
  requestAnalysis: (sessionId: string) => void;
  /** Called after a session is deleted through the API. */
  onSessionDeleted: (sessionId: string) => void;
};

export type HttpServerHandle = {
  readonly port: number;
  readonly server: Server;
  close(): Promise<void>;
};
