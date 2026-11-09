import { MAIN_AGENT_ID, type EventView, type Finding, type JsonValue } from '@stillwatch/schema';
import { useEffect, type ReactNode } from 'react';
import { useApi } from '../../api/context';
import { errorMessage } from '../../api/errors';
import { count, duration, preciseTime } from '../../lib/format';
import { useAsync } from '../../lib/hooks';
import { SeverityMark } from '../../ui/badges';
import { Icon } from '../../ui/Icon';
import { JsonTree } from '../../ui/JsonTree';
import { MarkedText } from '../../ui/MarkedText';
import { CopyButton, ErrorNotice, Loading } from '../../ui/misc';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function hasContent(value: JsonValue | null): value is JsonValue {
  if (value === null) return false;
  if (typeof value !== 'object') return true;
  return Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0;
}

function factsCount(event: EventView): number {
  const f = event.facts;
  return (
    f.files.length +
    f.commands.length +
    f.domains.length +
    f.packages.length +
    f.signals.length +
    f.secrets.length
  );
}

function Body({ event, findings }: { event: EventView; findings: Finding[] }) {
  const tool = event.tool;
  const subagent = event.agentId !== null && event.agentId !== MAIN_AGENT_ID;
  const data = event.data as JsonValue;
  return (
    <>
      <dl className="kv">
        <Row label="Time">
          <time className="num" dateTime={new Date(event.ts).toISOString()}>
            {preciseTime(event.ts)}
          </time>
        </Row>
        <Row label="Event">
          <span className="mono">{event.kind}</span>{' '}
          <span className="muted mono">#{event.seq}</span>
        </Row>
        <Row label="Agent">
          {subagent ? (
            <>
              <MarkedText text={event.agentType ?? 'Subagent'} />{' '}
              <span className="muted mono">{(event.agentId ?? '').slice(0, 12)}</span>
            </>
          ) : (
            'Main agent'
          )}
        </Row>
        {tool !== null ? (
          <>
            <Row label="Tool">
              <span className="mono">
                <MarkedText text={tool.name} />
              </span>
              {tool.mcpServer !== null ? (
                <span className="muted">
                  {' '}
                  from MCP server <MarkedText text={tool.mcpServer.name} />
                </span>
              ) : null}
            </Row>
            {tool.durationMs !== null ? (
              <Row label="Took">
                <span className="num">{duration(tool.durationMs)}</span>
              </Row>
            ) : null}
            {tool.sandboxDisabled ? (
              <Row label="Sandbox">
                <span className="tag tag-warn">Turned off for this call</span>
              </Row>
            ) : null}
            {tool.runInBackground ? <Row label="Ran">In the background</Row> : null}
          </>
        ) : null}
        {event.cwd !== null ? (
          <Row label="Folder">
            <span className="mono break">
              <MarkedText text={event.cwd} />
            </span>
          </Row>
        ) : null}
        {event.permissionMode !== null ? (
          <Row label="Permissions">
            <span className="mono">
              <MarkedText text={event.permissionMode} />
            </span>
          </Row>
        ) : null}
      </dl>

      {findings.length > 0 ? (
        <div className="detail-block">
          <h3 className="detail-title">Evidence for</h3>
          <ul className="plain-list detail-findings">
            {findings.map((finding) => (
              <li key={finding.id}>
                <SeverityMark severity={finding.severity} />
                <MarkedText text={finding.title} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tool !== null && tool.command !== null ? (
        <div className="detail-block">
          <div className="detail-title-row">
            <h3 className="detail-title">Command</h3>
            <CopyButton text={tool.command} />
          </div>
          <pre className="code-block">
            <MarkedText text={tool.command} />
          </pre>
        </div>
      ) : null}

      {tool !== null && tool.error !== null ? (
        <div className="detail-block">
          <h3 className="detail-title">Error</h3>
          <pre className="code-block code-block-bad">
            <MarkedText text={tool.error} />
          </pre>
        </div>
      ) : null}

      {event.redactions.length > 0 ? (
        <div className="notice notice-info">
          <Icon name="key" />
          <span>
            Stillwatch removed{' '}
            {count(
              event.redactions.reduce((n, r) => n + r.count, 0),
              'secret',
            )}{' '}
            from this event before storing it (
            {[...new Set(event.redactions.map((r) => r.detector))].join(', ')}).
          </span>
        </div>
      ) : null}

      {tool !== null && hasContent(tool.input) ? (
        <div className="detail-block">
          <h3 className="detail-title">Input</h3>
          <JsonTree value={tool.input} label="Tool input" />
        </div>
      ) : null}
      {tool !== null && hasContent(tool.response) ? (
        <div className="detail-block">
          <h3 className="detail-title">Response</h3>
          <JsonTree value={tool.response} label="Tool response" />
        </div>
      ) : null}
      {hasContent(data) ? (
        <div className="detail-block">
          <h3 className="detail-title">Details</h3>
          <JsonTree value={data} label="Event details" />
        </div>
      ) : null}
      {factsCount(event) > 0 ? (
        <details className="detail-block detail-collapsible">
          <summary className="detail-title">What Stillwatch extracted</summary>
          <JsonTree value={event.facts} label="Extracted facts" />
        </details>
      ) : null}
      <p className="detail-hash muted">
        Hash <span className="mono break">{event.hash}</span>
      </p>
    </>
  );
}

export function EventDetail({
  sessionId,
  eventId,
  loaded,
  findings,
  onClose,
}: {
  sessionId: string;
  eventId: string;
  loaded: EventView | null;
  findings: Finding[];
  onClose: () => void;
}) {
  const api = useApi();
  const fetched = useAsync(
    (signal) => (loaded !== null ? Promise.resolve(loaded) : api.event(eventId, signal)),
    `${eventId}:${loaded === null ? 'fetch' : 'loaded'}`,
  );
  const event = loaded ?? (fetched.status === 'ready' ? fetched.data : null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const wrongSession = event !== null && event.sessionId !== sessionId;

  return (
    <aside className="detail" aria-labelledby="detail-title">
      <div className="detail-head">
        <h2 id="detail-title" className="detail-heading">
          {event !== null && !wrongSession ? <MarkedText text={event.summary} /> : 'Event'}
        </h2>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close event details"
          title="Close (Esc)"
        >
          <Icon name="x" />
        </button>
      </div>
      {wrongSession ? (
        <ErrorNotice message="This event belongs to a different session." />
      ) : event !== null ? (
        <Body event={event} findings={findings} />
      ) : fetched.status === 'error' ? (
        <ErrorNotice message={errorMessage(fetched.error)} onRetry={() => fetched.reload()} />
      ) : (
        <Loading label="Loading event" lines={6} />
      )}
    </aside>
  );
}
