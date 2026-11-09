/// <reference types="vite/client" />

// Declaration merging with vite/client needs interfaces.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface ImportMetaEnv {
  /** "1" serves the dashboard from the in-browser mock collector in `vite` dev mode. */
  readonly VITE_STILLWATCH_MOCK?: string;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
