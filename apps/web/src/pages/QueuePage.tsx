import {
  RISK_LEVELS,
  SESSION_STATUSES,
  type RiskLevel,
  type SessionListResponse,
  type SessionStatus,
  type SessionSummary,
} from '@stillwatch/schema';
import { useEffect, useRef, useState } from 'react';
import { type ListQuery } from '../api/client';
import { useApi } from '../api/context';
import { errorMessage } from '../api/errors';
import { count, duration } from '../lib/format';
import { useAsync, useDebounced, useFocusOnNavigate, useNow } from '../lib/hooks';
import { Link } from '../router/Link';
import { navigate, paths, useSearch } from '../router/router';
import { RiskShape, SeverityMark, StatusBadge } from '../ui/badges';
import { Icon } from '../ui/Icon';
import { MarkedText } from '../ui/MarkedText';
import { Command, ErrorNotice, Loading, RelTime } from '../ui/misc';

type Filters = {
  risk: RiskLevel[];
  status: SessionStatus[];
  q: string;
  sort: 'review' | 'recent';
};

const RISK_ORDER: RiskLevel[] = ['high', 'medium', 'unknown', 'low'];
const RISK_NAME: Record<RiskLevel, string> = {
  high: 'High',
  medium: 'Medium',
  unknown: 'Unknown',
  low: 'Low',
};
const STATUS_NAME: Record<SessionStatus, string> = {
  active: 'Live',
  finished: 'Finished',
  interrupted: 'Interrupted',
};

function pick<T extends string>(value: string | null, allowed: readonly T[]): T[] {
  if (value === null || value === '') return [];
  return value.split(',').filter((v): v is T => (allowed as readonly string[]).includes(v));
}

export function parseFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  return {
    risk: pick(params.get('risk'), RISK_LEVELS),
    status: pick(params.get('status'), SESSION_STATUSES),
    q: params.get('q') ?? '',
    sort: params.get('sort') === 'recent' ? 'recent' : 'review',
  };
}

export function filtersSearch(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.risk.length > 0) params.set('risk', filters.risk.join(','));
  if (filters.status.length > 0) params.set('status', filters.status.join(','));
  if (filters.q.trim() !== '') params.set('q', filters.q.trim());
  if (filters.sort === 'recent') params.set('sort', 'recent');
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function isFiltered(filters: Filters): boolean {
  return filters.risk.length > 0 || filters.status.length > 0 || filters.q.trim() !== '';
}

function SessionRow({ session, now }: { session: SessionSummary; now: number }) {
  const ended = session.endedAt ?? session.lastEventAt;
  const project = session.projectName ?? 'No project';
  const more = session.findingCount - session.topFindings.length;
  return (
    <li className={`session-row risk-edge-${session.risk}`}>
      <div className={`session-risk risk-${session.risk}`}>
        <RiskShape level={session.risk} size={12} />
        <span>{RISK_NAME[session.risk]}</span>
      </div>
      <div className="session-main">
        <div className="session-title-line">
          <Link to={paths.session(session.id)} className="session-title row-link">
            <MarkedText text={session.title ?? 'Untitled session'} />
          </Link>
          {session.status === 'finished' ? null : <StatusBadge status={session.status} />}
        </div>
        <div className="session-meta">
          <span className="truncate">
            <MarkedText text={project} />
          </span>
          <span aria-hidden="true">·</span>
          <RelTime ts={session.startedAt} now={now} />
          <span aria-hidden="true">·</span>
          <span className="num">
            {session.status === 'active' ? 'running' : duration(ended - session.startedAt)}
          </span>
          {session.subagentCount > 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{count(session.subagentCount, 'subagent')}</span>
            </>
          ) : null}
        </div>
        {session.topFindings.length > 0 ? (
          <ul className="session-findings" aria-label="Top findings">
            {session.topFindings.map((finding, i) => (
              <li key={i}>
                <SeverityMark severity={finding.severity} />
                <span className="truncate">
                  <MarkedText text={finding.title} />
                </span>
              </li>
            ))}
            {more > 0 ? <li className="muted">and {count(more, 'more finding')}</li> : null}
          </ul>
        ) : session.gapCount > 0 ? (
          <p className="session-note">
            <Icon name="alert" size={14} />
            {count(session.gapCount, 'capture gap')}; some activity may be missing.
          </p>
        ) : null}
      </div>
      <dl className="session-counts">
        <div>
          <dt>Events</dt>
          <dd className="num">{session.eventCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Files</dt>
          <dd className="num">{session.fileChangeCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Findings</dt>
          <dd className="num">{session.findingCount.toLocaleString()}</dd>
        </div>
      </dl>
    </li>
  );
}

function FilterBar({
  filters,
  query,
  onQuery,
  onChange,
}: {
  filters: Filters;
  query: string;
  onQuery: (q: string) => void;
  onChange: (next: Filters) => void;
}) {
  return (
    <div className="filters" role="search">
      <label className="search-field">
        <Icon name="search" size={14} />
        <span className="visually-hidden">Search sessions</span>
        <input
          type="search"
          value={query}
          placeholder="Search titles, summaries, projects"
          onChange={(event) => onQuery(event.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <div className="chip-group" role="group" aria-label="Risk">
        {RISK_ORDER.map((level) => (
          <button
            key={level}
            type="button"
            className={`chip risk-${level}`}
            aria-pressed={filters.risk.includes(level)}
            onClick={() => onChange({ ...filters, risk: toggle(filters.risk, level) })}
          >
            <RiskShape level={level} />
            {RISK_NAME[level]}
          </button>
        ))}
      </div>
      <div className="chip-group" role="group" aria-label="Status">
        {(['active', 'interrupted'] as const).map((status) => (
          <button
            key={status}
            type="button"
            className="chip"
            aria-pressed={filters.status.includes(status)}
            onClick={() => onChange({ ...filters, status: toggle(filters.status, status) })}
          >
            {STATUS_NAME[status]}
          </button>
        ))}
      </div>
      <div className="segmented" role="group" aria-label="Sort">
        <button
          type="button"
          aria-pressed={filters.sort === 'review'}
          onClick={() => onChange({ ...filters, sort: 'review' })}
          title="Highest risk first, then newest"
        >
          Riskiest
        </button>
        <button
          type="button"
          aria-pressed={filters.sort === 'recent'}
          onClick={() => onChange({ ...filters, sort: 'recent' })}
        >
          Newest
        </button>
      </div>
    </div>
  );
}

function EmptyState({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  if (filtered) {
    return (
      <div className="empty">
        <p className="empty-title">No sessions match these filters.</p>
        <button type="button" className="button" onClick={onClear}>
          Clear filters
        </button>
      </div>
    );
  }
  return (
    <div className="empty">
      <p className="empty-title">No sessions recorded yet.</p>
      <p className="empty-text">
        Start a Claude Code session in any project. If nothing appears, check that the hooks are
        installed.
      </p>
      <Command text="stillwatch status" />
    </div>
  );
}

export function QueuePage() {
  const api = useApi();
  const search = useSearch();
  const filters = parseFilters(search);
  const now = useNow();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useFocusOnNavigate(headingRef, 'queue');

  // The search box updates the URL after a short pause, so typing stays smooth.
  const [query, setQuery] = useState(filters.q);
  const debounced = useDebounced(query, 250);
  const filtersRef = useRef(filters);
  useEffect(() => {
    filtersRef.current = filters;
  });
  useEffect(() => {
    const current = filtersRef.current;
    if (debounced.trim() === current.q.trim()) return;
    navigate(paths.queue(filtersSearch({ ...current, q: debounced })), { replace: true });
  }, [debounced]);
  // Keep the box in sync when the URL changes from elsewhere (back, clear).
  const [lastUrlQ, setLastUrlQ] = useState(filters.q);
  if (filters.q !== lastUrlQ) {
    setLastUrlQ(filters.q);
    if (filters.q.trim() !== query.trim()) setQuery(filters.q);
  }

  const listQuery: ListQuery = {
    risk: filters.risk.length > 0 ? filters.risk : null,
    status: filters.status.length > 0 ? filters.status : null,
    q: filters.q.trim() === '' ? null : filters.q.trim(),
    sort: filters.sort,
    limit: 50,
  };
  const key = filtersSearch(filters);
  const list = useAsync((signal) => api.listSessions(listQuery, signal), key);

  // Later pages, appended below the first. Reset whenever the filters change.
  const [extra, setExtra] = useState<{ key: string; pages: SessionListResponse[] }>({
    key,
    pages: [],
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const pages = extra.key === key ? extra.pages : [];

  // Quietly refresh while the page is open, so live sessions move.
  const reloadRef = useRef(list.reload);
  useEffect(() => {
    reloadRef.current = list.reload;
  });
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') reloadRef.current(true);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const change = (next: Filters) => navigate(paths.queue(filtersSearch(next)), { replace: true });

  const first = list.status === 'ready' ? list.data : null;
  const sessions = first === null ? [] : [first, ...pages].flatMap((page) => page.sessions);
  const nextCursor = pages.length > 0 ? (pages.at(-1)?.nextCursor ?? null) : first?.nextCursor;

  const loadMore = () => {
    if (nextCursor === null || nextCursor === undefined) return;
    setLoadingMore(true);
    setMoreError(null);
    api.listSessions({ ...listQuery, cursor: nextCursor }, null).then(
      (page) => {
        setExtra({ key, pages: [...pages, page] });
        setLoadingMore(false);
      },
      (error: unknown) => {
        setMoreError(errorMessage(error));
        setLoadingMore(false);
      },
    );
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 ref={headingRef} tabIndex={-1} className="page-title">
            Sessions
          </h1>
          <p className="page-subtitle">
            {filters.sort === 'review'
              ? 'Riskiest first, so anything that needs a look is at the top.'
              : 'Newest first.'}
          </p>
        </div>
        {first !== null ? (
          <p className="page-count num" aria-live="polite">
            {count(first.total, 'session')}
          </p>
        ) : null}
      </div>
      <FilterBar filters={filters} query={query} onQuery={setQuery} onChange={change} />
      {list.status === 'loading' ? (
        <Loading label="Loading sessions" lines={8} />
      ) : list.status === 'error' ? (
        <ErrorNotice message={errorMessage(list.error)} onRetry={() => list.reload()} />
      ) : sessions.length === 0 ? (
        <EmptyState
          filtered={isFiltered(filters)}
          onClear={() => {
            setQuery('');
            change({ risk: [], status: [], q: '', sort: filters.sort });
          }}
        />
      ) : (
        <>
          <ul className="session-list" aria-label="Sessions">
            {sessions.map((session) => (
              <SessionRow key={session.id} session={session} now={now} />
            ))}
          </ul>
          {moreError !== null ? <ErrorNotice message={moreError} onRetry={loadMore} /> : null}
          {nextCursor !== null && nextCursor !== undefined ? (
            <div className="list-more">
              <button type="button" className="button" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading...' : 'Show more sessions'}
              </button>
              <span className="muted num">
                Showing {sessions.length.toLocaleString()} of {first?.total.toLocaleString()}
              </span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
