declare const __STILLWATCH_VERSION__: string | undefined;

/** Package version, injected by build.mjs; "0.0.0-dev" when running from source. */
export const VERSION: string =
  typeof __STILLWATCH_VERSION__ === 'string' ? __STILLWATCH_VERSION__ : '0.0.0-dev';
