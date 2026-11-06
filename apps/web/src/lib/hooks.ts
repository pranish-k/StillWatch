import { useEffect, useRef, useState, type RefObject } from 'react';
import { isAbortError } from '../api/errors';
import { hasNavigated } from '../router/router';

export type AsyncState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: null; error: unknown };

/**
 * Loads data for the given key and aborts stale requests. `reload` refetches
 * without showing a loading state when `quiet` is true.
 */
export function useAsync<T>(
  load: (signal: AbortSignal) => Promise<T>,
  key: string,
): AsyncState<T> & { reload: (quiet?: boolean) => void } {
  const [state, setState] = useState<AsyncState<T>>({
    status: 'loading',
    data: null,
    error: null,
  });
  const [nonce, setNonce] = useState(0);
  const quietRef = useRef(false);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    const controller = new AbortController();
    if (!quietRef.current) setState({ status: 'loading', data: null, error: null });
    quietRef.current = false;
    loadRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data, error: null });
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState({ status: 'error', data: null, error });
      },
    );
    return () => controller.abort();
  }, [key, nonce]);

  return {
    ...state,
    reload: (quiet = false) => {
      quietRef.current = quiet;
      setNonce((n) => n + 1);
    },
  };
}

export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Moves focus to a page heading after navigation, for screen reader and keyboard users. */
export function useFocusOnNavigate(ref: RefObject<HTMLElement | null>, key: string): void {
  useEffect(() => {
    if (hasNavigated()) ref.current?.focus({ preventScroll: false });
  }, [ref, key]);
}

/** Current time, refreshed every `intervalMs`, for relative times. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
