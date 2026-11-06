/**
 * Sign-in state, kept outside React so the API client and the UI share it.
 *
 * `stillwatch open` adds a single-use `?login=` value to the dashboard URL.
 * `start` exchanges it for a bearer token exactly once (also under React
 * StrictMode), stores the token, and removes the value from the address bar.
 */
import { LOGIN_QUERY_PARAM, type AuthExchangeResponse } from '@stillwatch/schema';
import { UnreachableError } from '../api/errors';
import { readStorage, writeStorage } from '../lib/storage';

export const TOKEN_STORAGE_KEY = 'stillwatch.token';

export type SignedOutReason = 'none' | 'expired' | 'link_failed';

export type AuthState =
  | { kind: 'starting' }
  | { kind: 'signed_in' }
  | { kind: 'signed_out'; reason: SignedOutReason }
  | { kind: 'unreachable' };

export type AuthStore = {
  getState(): AuthState;
  subscribe(listener: () => void): () => void;
  token(): string | null;
  /** Consumes a login value in the URL, if any. Safe to call more than once. */
  start(exchange: (login: string) => Promise<AuthExchangeResponse>): Promise<void>;
  handleUnauthorized(): void;
  handleUnreachable(): void;
  /** Leaves the unreachable state so pages try again. */
  retry(): void;
};

export function createAuthStore(): AuthStore {
  let state: AuthState = { kind: 'starting' };
  let started: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function set(next: AuthState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  function initialState(): AuthState {
    return readStorage(TOKEN_STORAGE_KEY) === null
      ? { kind: 'signed_out', reason: 'none' }
      : { kind: 'signed_in' };
  }

  async function run(exchange: (login: string) => Promise<AuthExchangeResponse>): Promise<void> {
    const url = new URL(window.location.href);
    const login = url.searchParams.get(LOGIN_QUERY_PARAM);
    if (login === null) {
      set(initialState());
      return;
    }
    // Remove the single-use value first, so it never stays in history.
    url.searchParams.delete(LOGIN_QUERY_PARAM);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    try {
      const response = await exchange(login);
      writeStorage(TOKEN_STORAGE_KEY, response.token);
      set({ kind: 'signed_in' });
    } catch (error) {
      if (error instanceof UnreachableError) {
        set({ kind: 'unreachable' });
        return;
      }
      writeStorage(TOKEN_STORAGE_KEY, null);
      set({ kind: 'signed_out', reason: 'link_failed' });
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    token: () => readStorage(TOKEN_STORAGE_KEY),
    start(exchange) {
      started ??= run(exchange);
      return started;
    },
    handleUnauthorized() {
      writeStorage(TOKEN_STORAGE_KEY, null);
      if (state.kind !== 'signed_out') set({ kind: 'signed_out', reason: 'expired' });
    },
    handleUnreachable() {
      if (state.kind !== 'unreachable') set({ kind: 'unreachable' });
    },
    retry() {
      set(initialState());
    },
  };
}
