import {
  MAIN_AGENT_ID,
  type EventView,
  type Finding,
  type SessionDetailResponse,
  type Severity,
} from '@stillwatch/schema';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../../api/context';
import { errorMessage } from '../../api/errors';
import { clockTime } from '../../lib/format';
import { eventGroup, eventIcon, type EventGroup } from '../../lib/labels';
import { Link } from '../../router/Link';
import { navigate, paths } from '../../router/router';
import { RiskShape } from '../../ui/badges';
import { Icon } from '../../ui/Icon';
import { MarkedText } from '../../ui/MarkedText';
import { ErrorNotice, Loading } from '../../ui/misc';
import { EventDetail } from './EventDetail';

/** How many extra pages to load while looking for a linked event. */
const MAX_SEEK_PAGES = 25;

type Filter = 'all' | 'findings' | EventGroup;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'findings', label: 'With findings' },
  { id: 'prompt', label: 'Prompts' },
  { id: 'tool', label: 'Tools' },
  { id: 'agent', label: 'Agent' },
];

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

type Loaded = { events: EventView[]; nextCursor: string | null };

/** Highest-severity finding for each event that is evidence for one. */
function findingsByEvent(findings: Finding[]): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>();
  for (const finding of findings) {
    for (const eventId of finding.evidence.eventIds) {
      const list = map.get(eventId);
      if (list === undefined) map.set(eventId, [finding]);
      else list.push(finding);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  }
  return map;
}

function matches(event: EventView, filter: Filter, flagged: boolean): boolean {
  if (filter === 'all') return true;
  if (filter === 'findings') return flagged;
  return eventGroup(event.kind) === filter;
}

function EventRow({
  event,
  sessionId,
  selected,
  findings,
}: {
  event: EventView;
  sessionId: string;
  selected: boolean;
  findings: Finding[] | undefined;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const row = ref.current;
    if (!selected || row === null) return;
    // Leave a row that is already in view alone, so stepping with the keyboard
    // does not jump; center one that is hidden, or under the sticky top bar.
    const rect = row.getBoundingClientRect();
    const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
    if (rect.top < top || rect.bottom > window.innerHeight) {
      row.scrollIntoView({ block: 'center' });
    }
  }, [selected]);
  const top = findings?.[0];
  const failed = event.kind === 'tool.failure' || event.kind === 'turn.failure';
  const denied = event.kind === 'permission.denied';
  const subagent = event.agentId !== null && event.agentId !== MAIN_AGENT_ID;
  return (
    <li
      ref={ref}
      className={`event-row${selected ? ' is-selected' : ''}${top ? ` flagged-${top.severity}` : ''}`}
    >
      <time className="event-time num" dateTime={new Date(event.ts).toISOString()}>
        {clockTime(event.ts)}
      </time>
      <span className={`event-icon${failed || denied ? ' is-bad' : ''}`}>
        <Icon name={eventIcon(event.kind, event.tool?.category ?? null)} size={14} />
      </span>
      <Link
        to={paths.event(sessionId, event.id)}
        replace
        className="event-summary row-link"
        aria-current={selected ? 'true' : undefined}
      >
        <MarkedText text={event.summary} />
      </Link>
      <span className="event-tags">
        {subagent ? (
          <span className="tag" title={`Subagent ${event.agentId ?? ''}`}>
            <MarkedText text={event.agentType ?? 'subagent'} />
          </span>
        ) : null}
        {failed ? <span className="tag tag-bad">Failed</span> : null}
        {denied ? <span className="tag tag-bad">Denied</span> : null}
        {top ? (
          <span
            className={`event-flag risk-${top.severity}`}
            title={findings.map((f) => f.title).join('\n')}
          >
            <RiskShape level={top.severity} />
            <span className="visually-hidden">{`Finding: ${top.title}`}</span>
          </span>
        ) : null}
      </span>
    </li>
  );
}

export function TimelineView({
  detail,
  eventId,
}: {
  detail: SessionDetailResponse;
  eventId: string | null;
}) {
  const api = useApi();
  const sessionId = detail.session.id;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const seekPages = useRef(0);
  const flagged = useMemo(() => findingsByEvent(detail.findings), [detail.findings]);

  const loadPage = (cursor: string | null, signal: AbortSignal | null) => {
    setLoading(true);
    setError(null);
    api.events(sessionId, cursor, signal).then(
      (page) => {
        setLoaded((prev) => ({
          events: cursor === null || prev === null ? page.events : [...prev.events, ...page.events],
          nextCursor: page.nextCursor,
        }));
        setLoading(false);
      },
      (err: unknown) => {
        if (signal?.aborted === true) return;
        setError(err);
        setLoading(false);
      },
    );
  };

  // The first page. The parent keys this view by session, so it mounts fresh per session.
  const loadRef = useRef(loadPage);
  useEffect(() => {
    loadRef.current = loadPage;
  });
  useEffect(() => {
    const controller = new AbortController();
    loadRef.current(null, controller.signal);
    return () => controller.abort();
  }, [sessionId]);

  // A link to an event further down loads more pages until it appears.
  const present = eventId === null || loaded?.events.some((e) => e.id === eventId) === true;
  useEffect(() => {
    const cursor = loaded?.nextCursor ?? null;
    if (present || loading || cursor === null) return;
    if (seekPages.current >= MAX_SEEK_PAGES) return;
    seekPages.current += 1;
    loadRef.current(cursor, null);
  }, [present, loading, loaded]);

  const visible = (loaded?.events ?? []).filter((event) =>
    matches(event, filter, flagged.has(event.id)),
  );
  const selected = loaded?.events.find((e) => e.id === eventId) ?? null;

  const step = (delta: number) => {
    if (visible.length === 0) return;
    const index = visible.findIndex((e) => e.id === eventId);
    const next =
      visible[index === -1 ? 0 : Math.min(visible.length - 1, Math.max(0, index + delta))];
    if (next !== undefined) navigate(paths.event(sessionId, next.id), { replace: true });
  };

  return (
    <div className={`timeline-layout${eventId !== null ? ' has-detail' : ''}`}>
      <div className="timeline">
        <div className="timeline-bar">
          <div className="segmented" role="group" aria-label="Show events">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          {loaded !== null ? (
            <span className="muted num timeline-count">
              {visible.length === loaded.events.length
                ? `${loaded.events.length.toLocaleString()} of ${detail.session.eventCount.toLocaleString()} events`
                : `${visible.length.toLocaleString()} shown of ${loaded.events.length.toLocaleString()} loaded`}
            </span>
          ) : null}
        </div>
        {loaded === null && loading ? (
          <Loading label="Loading events" lines={12} />
        ) : loaded === null ? (
          <ErrorNotice message={errorMessage(error)} onRetry={() => loadPage(null, null)} />
        ) : (
          <>
            {visible.length === 0 ? (
              <p className="empty-text timeline-empty">No loaded events match this filter.</p>
            ) : (
              <ol
                className="event-list"
                aria-label="Events, oldest first"
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'j') {
                    event.preventDefault();
                    step(1);
                  } else if (event.key === 'ArrowUp' || event.key === 'k') {
                    event.preventDefault();
                    step(-1);
                  }
                }}
              >
                {visible.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    sessionId={sessionId}
                    selected={event.id === eventId}
                    findings={flagged.get(event.id)}
                  />
                ))}
              </ol>
            )}
            {error !== null ? (
              <ErrorNotice
                message={errorMessage(error)}
                onRetry={() => loadPage(loaded.nextCursor, null)}
              />
            ) : null}
            {loaded.nextCursor !== null ? (
              <div className="list-more">
                <button
                  type="button"
                  className="button"
                  disabled={loading}
                  onClick={() => loadPage(loaded.nextCursor, null)}
                >
                  {loading ? 'Loading...' : 'Show more events'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
      {eventId !== null ? (
        <EventDetail
          key={eventId}
          sessionId={sessionId}
          eventId={eventId}
          loaded={selected}
          findings={flagged.get(eventId) ?? []}
          onClose={() => navigate(`${paths.session(sessionId)}?view=timeline`, { replace: true })}
        />
      ) : null}
    </div>
  );
}
