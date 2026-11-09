import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useServices } from './api/context';
import type { AuthState } from './auth/auth';
import { NotFoundPage } from './pages/NotFoundPage';
import { QueuePage } from './pages/QueuePage';
import { SessionPage } from './pages/SessionPage';
import { SignedOutPage, UnreachablePage } from './pages/GatePages';
import { StatusPage } from './pages/StatusPage';
import { Link } from './router/Link';
import { paths, useRoute, type Route } from './router/router';
import { THEME_CHOICES, setTheme, useTheme, type ThemeChoice } from './theme/theme';
import { Icon, type IconName } from './ui/Icon';

function useAuthState(): AuthState {
  const { auth } = useServices();
  const subscribe = useCallback((listener: () => void) => auth.subscribe(listener), [auth]);
  const getState = useCallback(() => auth.getState(), [auth]);
  return useSyncExternalStore(subscribe, getState, getState);
}

const THEME_META: Record<ThemeChoice, { icon: IconName; label: string }> = {
  system: { icon: 'monitor', label: 'Match system theme' },
  light: { icon: 'sun', label: 'Light theme' },
  dark: { icon: 'moon', label: 'Dark theme' },
};

function ThemeToggle() {
  const theme = useTheme();
  const next = THEME_CHOICES[(THEME_CHOICES.indexOf(theme) + 1) % THEME_CHOICES.length] ?? 'system';
  const meta = THEME_META[theme];
  return (
    <button
      type="button"
      className="icon-button"
      onClick={() => setTheme(next)}
      title={`${meta.label}. Switch to ${THEME_META[next].label.toLowerCase()}.`}
      aria-label={`${meta.label}. Switch to ${THEME_META[next].label.toLowerCase()}.`}
    >
      <Icon name={meta.icon} />
    </button>
  );
}

function Logo() {
  return (
    <svg className="logo" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3.5 10h3l1.5-3.5 2.5 7 1.5-3.5h4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TopBar({ route, signedIn }: { route: Route; signedIn: boolean }) {
  const section = route.name === 'status' ? 'status' : 'sessions';
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to={paths.queue()} className="brand">
          <Logo />
          <span>Stillwatch</span>
        </Link>
        {signedIn ? (
          <nav className="topnav" aria-label="Main">
            <Link
              to={paths.queue()}
              className="topnav-link"
              aria-current={section === 'sessions' ? 'page' : undefined}
            >
              Sessions
            </Link>
            <Link
              to={paths.status()}
              className="topnav-link"
              aria-current={section === 'status' ? 'page' : undefined}
            >
              Status
            </Link>
          </nav>
        ) : null}
        <div className="topbar-end">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'queue':
      return <QueuePage />;
    case 'session':
      return <SessionPage id={route.id} eventId={route.eventId} />;
    case 'status':
      return <StatusPage />;
    case 'not_found':
      return <NotFoundPage />;
  }
}

export function App() {
  const { auth, api } = useServices();
  const state = useAuthState();
  const route = useRoute();

  useEffect(() => {
    void auth.start((login) => api.exchange(login));
  }, [auth, api]);

  useEffect(() => {
    const titles: Record<Route['name'], string> = {
      queue: 'Sessions',
      session: 'Session',
      status: 'Status',
      not_found: 'Not found',
    };
    document.title = `${titles[route.name]} - Stillwatch`;
  }, [route.name]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <TopBar route={route} signedIn={state.kind === 'signed_in'} />
      <main id="main" className="main" tabIndex={-1}>
        {state.kind === 'starting' ? null : state.kind === 'signed_out' ? (
          <SignedOutPage reason={state.reason} />
        ) : state.kind === 'unreachable' ? (
          <UnreachablePage onRetry={() => auth.retry()} />
        ) : (
          <Page route={route} />
        )}
      </main>
    </>
  );
}
