import { LOGIN_QUERY_PARAM } from '@stillwatch/schema';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient } from './api/client';
import { ServicesProvider } from './api/context';
import { App } from './App';
import { TOKEN_STORAGE_KEY, createAuthStore } from './auth/auth';
import { HIGH_ID } from './mocks/highRisk';
import { MOCK_TOKEN, createMockServer, type MockOptions } from './mocks/mockFetch';
import { HOSTILE_ID } from './mocks/sessions';
import { filtersSearch, parseFilters } from './pages/QueuePage';

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);

function renderApp(
  path: string,
  options: { signedIn?: boolean } & MockOptions = {},
): ReturnType<typeof createMockServer> {
  window.history.replaceState(null, '', path);
  if (options.signedIn !== false) window.localStorage.setItem(TOKEN_STORAGE_KEY, MOCK_TOKEN);
  const server = createMockServer({ now: NOW, ...options });
  const auth = createAuthStore();
  const api = createApiClient({ fetch: server.fetch, auth });
  render(
    <ServicesProvider value={{ api, auth }}>
      <App />
    </ServicesProvider>,
  );
  return server;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('sign-in', () => {
  it('asks to open the dashboard from the terminal without a token', async () => {
    const server = renderApp('/', { signedIn: false });
    expect(await screen.findByText('Open Stillwatch from your terminal')).toBeTruthy();
    expect(screen.getByText('stillwatch open')).toBeTruthy();
    expect(server.requests).toHaveLength(0);
  });

  it('exchanges a login link once, stores the token, and removes it from the URL', async () => {
    const server = renderApp(`/?${LOGIN_QUERY_PARAM}=single-use`, { signedIn: false });
    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeTruthy();
    expect(window.location.search).toBe('');
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBe(MOCK_TOKEN);
    expect(server.requests.filter((r) => r.url === '/api/auth/exchange')).toHaveLength(1);
  });

  it('signs out with an explanation when the collector rejects the token', async () => {
    renderApp('/', { validToken: () => false });
    expect(await screen.findByText('Sign in again')).toBeTruthy();
    expect(screen.getByText(/Your sign-in expired/)).toBeTruthy();
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('explains how to start the collector when it is unreachable', async () => {
    renderApp('/', { scenario: 'offline' });
    expect(await screen.findByText('The collector is not running')).toBeTruthy();
    expect(screen.getByText('stillwatch start')).toBeTruthy();
  });
});

describe('session queue', () => {
  it('lists the riskiest sessions first', async () => {
    renderApp('/');
    const list = await screen.findByRole('list', { name: 'Sessions' });
    const rows = within(list).getAllByRole('link');
    expect(rows[0]?.textContent).toBe('Fix login timeout');
    expect(rows[1]?.textContent).toBe('Add rate limiting to the public API');
    expect(screen.getByText('30 sessions')).toBeTruthy();
  });

  it('filters by risk through the URL', async () => {
    const user = userEvent.setup();
    const server = renderApp('/');
    await screen.findByRole('list', { name: 'Sessions' });
    await user.click(screen.getByRole('button', { name: 'High' }));
    expect(window.location.search).toBe('?risk=high');
    await waitFor(() => expect(screen.getByText('1 session')).toBeTruthy());
    expect(server.requests.at(-1)?.url).toContain('risk=high');
    expect(screen.getByRole('button', { name: 'High' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('searches after typing pauses and offers to clear an empty result', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('list', { name: 'Sessions' });
    await user.type(screen.getByRole('searchbox'), 'zzz-nothing');
    await waitFor(() => expect(window.location.search).toBe('?q=zzz-nothing'));
    expect(await screen.findByText('No sessions match these filters.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('');
  });

  it('shows a first-run hint when nothing is recorded', async () => {
    renderApp('/', { scenario: 'empty' });
    expect(await screen.findByText('No sessions recorded yet.')).toBeTruthy();
  });

  it('keeps filters in a round trip through the URL', () => {
    const filters = {
      risk: ['high' as const, 'unknown' as const],
      status: [],
      q: 'a b',
      sort: 'recent' as const,
    };
    expect(parseFilters(filtersSearch(filters))).toEqual(filters);
    expect(parseFilters('?risk=high,bogus&sort=weird')).toEqual({
      risk: ['high'],
      status: [],
      q: '',
      sort: 'review',
    });
  });
});

describe('session page', () => {
  it('explains a high-risk session and links each finding to its event', async () => {
    const user = userEvent.setup();
    renderApp(`/sessions/${HIGH_ID}`);
    const why = await screen.findByRole('region', { name: /Why this is high risk/ });
    expect(within(why).getByText('Git hook added')).toBeTruthy();
    expect(screen.getByRole('region', { name: /What remains/ })).toBeTruthy();

    const card = within(why).getByText('Git hook added').closest('li');
    if (card === null) throw new Error('finding card not found');
    // Paths inside the project are shown relative to it, with the full path on hover.
    const path = within(card).getByText('.git/hooks/pre-push');
    expect(path.closest('[title]')?.getAttribute('title')).toBe(
      '/Users/dev/code/acme-web/.git/hooks/pre-push',
    );
    await user.click(within(card).getByRole('link', { name: /Show in timeline/ }));

    expect(window.location.pathname).toMatch(new RegExp(`^/sessions/${HIGH_ID}/events/`));
    const detail = await screen.findByRole('complementary', { name: /pre-push|hook/i });
    expect(within(detail).getByText('Evidence for')).toBeTruthy();
    expect(within(detail).getAllByText('Git hook added').length).toBeGreaterThan(0);
  });

  it('opens an event beyond the first page of the timeline', async () => {
    renderApp(`/sessions/${HIGH_ID}/events/ev-hi-0300`);
    const list = await screen.findByRole('list', { name: 'Events, oldest first' });
    await waitFor(() => expect(list.querySelector('[aria-current="true"]')).not.toBeNull());
    expect(screen.getByText(/400 of 419 events/)).toBeTruthy();
  });

  it('renders hostile session data as text, never as markup', async () => {
    renderApp(`/sessions/${HOSTILE_ID}`);
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading.textContent).toContain('<script>alert("stillwatch")</script>');
    expect(document.querySelectorAll('script, img, iframe')).toHaveLength(0);
    for (const a of document.querySelectorAll('a')) {
      expect(a.getAttribute('href')?.startsWith('javascript:')).not.toBe(true);
    }
  });

  it('deletes a session after confirmation and returns to the queue', async () => {
    const user = userEvent.setup();
    const server = renderApp(`/sessions/${HIGH_ID}`);
    await screen.findByRole('region', { name: /Why this is high risk/ });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this session?' });
    expect(document.activeElement?.textContent).toBe('Cancel');
    await user.click(within(dialog).getByRole('button', { name: 'Delete session' }));
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(server.requests.some((r) => r.method === 'DELETE')).toBe(true);
    const list = await screen.findByRole('list', { name: 'Sessions' });
    expect(within(list).queryByText('Fix login timeout')).toBeNull();
  });

  it('shows a clear message for a session that does not exist', async () => {
    renderApp('/sessions/missing');
    expect(await screen.findByText(/no longer exists/)).toBeTruthy();
  });
});

describe('status page', () => {
  it('shows hook health and collector warnings with commands as code', async () => {
    renderApp('/status');
    const hooks = await screen.findByRole('region', { name: 'Capture hooks' });
    expect(within(hooks).getByText('Needs attention')).toBeTruthy();
    const code = document.querySelector('.warnings code');
    expect(code?.textContent).toBe('stillwatch install');
  });
});

it('shows a not-found page for unknown addresses', async () => {
  renderApp('/nope/nope');
  expect(await screen.findByText('Page not found')).toBeTruthy();
});
