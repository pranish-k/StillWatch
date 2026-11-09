import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createApiClient, type FetchLike } from './api/client';
import { ServicesProvider } from './api/context';
import { App } from './App';
import { TOKEN_STORAGE_KEY, createAuthStore } from './auth/auth';
import { writeStorage } from './lib/storage';
import './styles.css';
import { applyTheme } from './theme/theme';

async function pickFetch(): Promise<FetchLike> {
  // The mock collector exists only in `vite` dev mode with VITE_STILLWATCH_MOCK=1;
  // the production build drops this branch and the mock modules entirely.
  if (import.meta.env.DEV && import.meta.env.VITE_STILLWATCH_MOCK === '1') {
    const { createMockServer, MOCK_TOKEN } = await import('./mocks/mockFetch');
    const params = new URLSearchParams(window.location.search);
    const scenario = params.get('mock');
    writeStorage(TOKEN_STORAGE_KEY, scenario === 'signed-out' ? null : MOCK_TOKEN);
    return createMockServer({
      latencyMs: 150,
      scenario: scenario === 'empty' || scenario === 'offline' ? scenario : 'default',
    }).fetch;
  }
  return (input, init) => window.fetch(input, init);
}

async function main(): Promise<void> {
  applyTheme();
  const root = document.getElementById('root');
  if (root === null) return;
  const auth = createAuthStore();
  const api = createApiClient({ fetch: await pickFetch(), auth });
  createRoot(root).render(
    <StrictMode>
      <ServicesProvider value={{ api, auth }}>
        <App />
      </ServicesProvider>
    </StrictMode>,
  );
}

void main();
