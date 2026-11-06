/**
 * A tiny router on the History API. Pages are real URLs, anchors are real
 * anchors, and back and forward work.
 */
import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'queue' }
  | { name: 'session'; id: string; eventId: string | null }
  | { name: 'status' }
  | { name: 'not_found' };

const NAVIGATE_EVENT = 'stillwatch:navigate';

function decode(segment: string): string | null {
  try {
    const value = decodeURIComponent(segment);
    return value === '' ? null : value;
  } catch {
    return null;
  }
}

export function matchRoute(pathname: string): Route {
  const parts = pathname.split('/').filter((p) => p !== '');
  if (parts.length === 0) return { name: 'queue' };
  if (parts.length === 1 && parts[0] === 'status') return { name: 'status' };
  if (parts[0] === 'sessions' && parts[1] !== undefined) {
    const id = decode(parts[1]);
    if (id === null) return { name: 'not_found' };
    if (parts.length === 2) return { name: 'session', id, eventId: null };
    if (parts.length === 4 && parts[2] === 'events' && parts[3] !== undefined) {
      const eventId = decode(parts[3]);
      if (eventId !== null) return { name: 'session', id, eventId };
    }
  }
  return { name: 'not_found' };
}

export const paths = {
  queue: (search = '') => `/${search}`,
  session: (id: string) => `/sessions/${encodeURIComponent(id)}`,
  event: (sessionId: string, eventId: string) =>
    `/sessions/${encodeURIComponent(sessionId)}/events/${encodeURIComponent(eventId)}`,
  status: () => '/status',
};

let navigated = false;

/** True once the user moved between pages in this tab (not on first load). */
export function hasNavigated(): boolean {
  return navigated;
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const current = window.location.pathname + window.location.search;
  if (to === current && options.replace !== true) return;
  if (options.replace === true) window.history.replaceState(null, '', to);
  else {
    window.history.pushState(null, '', to);
    navigated = true;
  }
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

function subscribe(listener: () => void): () => void {
  const onPop = () => {
    navigated = true;
    listener();
  };
  window.addEventListener('popstate', onPop);
  window.addEventListener(NAVIGATE_EVENT, listener);
  return () => {
    window.removeEventListener('popstate', onPop);
    window.removeEventListener(NAVIGATE_EVENT, listener);
  };
}

const getPath = () => window.location.pathname;
const getSearch = () => window.location.search;

export function usePathname(): string {
  return useSyncExternalStore(subscribe, getPath, getPath);
}

export function useSearch(): string {
  return useSyncExternalStore(subscribe, getSearch, getSearch);
}

export function useRoute(): Route {
  return matchRoute(usePathname());
}
