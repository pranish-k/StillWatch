import type { StatusResponse } from '@stillwatch/schema';
import { useEffect, useRef, type ReactNode } from 'react';
import { useApi } from '../api/context';
import { errorMessage } from '../api/errors';
import { absoluteTime, bytes, count, duration } from '../lib/format';
import { GAP_LABEL } from '../lib/labels';
import { useAsync, useFocusOnNavigate, useNow } from '../lib/hooks';
import { CodeText } from '../ui/CodeText';
import { Icon } from '../ui/Icon';
import { MarkedText } from '../ui/MarkedText';
import { Command, ErrorNotice, Loading, RelTime } from '../ui/misc';

type Health = 'ok' | 'warn' | 'bad';

function HealthDot({ health }: { health: Health }) {
  const label = health === 'ok' ? 'OK' : health === 'warn' ? 'Needs attention' : 'Problem';
  return (
    <span className={`health health-${health}`}>
      <Icon name={health === 'ok' ? 'check' : 'alert'} size={14} />
      <span>{label}</span>
    </span>
  );
}

function Card({ title, health, children }: { title: string; health: Health; children: ReactNode }) {
  return (
    <section className="card" aria-label={title}>
      <div className="card-head">
        <h2 className="card-title">{title}</h2>
        <HealthDot health={health} />
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function hooksHealth(status: StatusResponse): Health {
  const { hooks } = status;
  if (!hooks.installed || !hooks.hookScriptOk) return 'bad';
  if (hooks.missing.length > 0 || hooks.outdated.length > 0 || hooks.compatible === false)
    return 'warn';
  return 'ok';
}

function spoolHealth(status: StatusResponse, now: number): Health {
  const { spool } = status;
  if (spool.oldestAt !== null && now - spool.oldestAt > 5 * 60_000) return 'bad';
  if (spool.pending > 100) return 'warn';
  return 'ok';
}

const SCOPE_LABEL = { user: 'All projects', project: 'This project', local: 'This project, local' };

export function StatusPage() {
  const api = useApi();
  const status = useAsync((signal) => api.status(signal), 'status');
  const now = useNow(5_000);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useFocusOnNavigate(headingRef, 'status');

  const reload = status.reload;
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  });
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') reloadRef.current(true);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 ref={headingRef} tabIndex={-1} className="page-title">
            Status
          </h1>
          <p className="page-subtitle">Whether Stillwatch is recording, and where data is kept.</p>
        </div>
      </div>
      {status.status === 'loading' ? (
        <Loading label="Loading status" lines={8} />
      ) : status.status === 'error' ? (
        <ErrorNotice message={errorMessage(status.error)} onRetry={() => status.reload()} />
      ) : (
        <StatusBody status={status.data} now={now} />
      )}
    </div>
  );
}

function StatusBody({ status, now }: { status: StatusResponse; now: number }) {
  const { hooks, spool, db, collector } = status;
  return (
    <>
      {status.warnings.length > 0 ? (
        <ul className="warnings">
          {status.warnings.map((warning, i) => (
            <li key={i} className="notice notice-warn">
              <Icon name="alert" />
              <span>
                <CodeText text={warning} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="card-grid">
        <Card title="Capture hooks" health={hooksHealth(status)}>
          <dl className="kv">
            <Row label="Installed">
              {hooks.installed ? (hooks.scope !== null ? SCOPE_LABEL[hooks.scope] : 'Yes') : 'No'}
            </Row>
            {hooks.settingsPath !== null ? (
              <Row label="Settings">
                <span className="mono break">
                  <MarkedText text={hooks.settingsPath} />
                </span>
              </Row>
            ) : null}
            <Row label="Hook events">
              <span className="num">{count(hooks.events.length, 'event')}</span>
              {hooks.missing.length > 0 ? (
                <span className="muted">
                  {' '}
                  (missing <span className="mono">{hooks.missing.join(', ')}</span>)
                </span>
              ) : null}
              {hooks.outdated.length > 0 ? (
                <span className="muted"> ({hooks.outdated.length} from an older version)</span>
              ) : null}
            </Row>
            <Row label="Hook script">{hooks.hookScriptOk ? 'In place' : 'Missing or changed'}</Row>
            <Row label="Claude Code">
              {hooks.claudeVersion !== null ? (
                <span className="mono">{hooks.claudeVersion}</span>
              ) : (
                'Version unknown'
              )}
              {hooks.compatible === false ? (
                <span className="tag tag-warn">Not tested with this version</span>
              ) : null}
            </Row>
            <Row label="Last event">
              {status.lastEventAt !== null ? (
                <RelTime ts={status.lastEventAt} now={now} />
              ) : (
                'None yet'
              )}
            </Row>
          </dl>
          {!hooks.installed ||
          !hooks.hookScriptOk ||
          hooks.missing.length > 0 ||
          hooks.outdated.length > 0 ? (
            <Command text="stillwatch install" />
          ) : null}
        </Card>

        <Card title="Collector" health="ok">
          <dl className="kv">
            <Row label="Version">
              <span className="mono">{status.version}</span>
            </Row>
            <Row label="Running for">
              <span className="num" title={absoluteTime(collector.startedAt)}>
                {duration(now - collector.startedAt)}
              </span>
            </Row>
            <Row label="Address">
              <span className="mono">127.0.0.1:{collector.port}</span>
            </Row>
            <Row label="Process">
              <span className="mono">{collector.pid}</span>
            </Row>
          </dl>
        </Card>

        <Card title="Spool" health={spoolHealth(status, now)}>
          <dl className="kv">
            <Row label="Waiting">
              <span className="num">{count(spool.pending, 'event')}</span>
            </Row>
            <Row label="Oldest">
              {spool.oldestAt !== null ? (
                <RelTime ts={spool.oldestAt} now={now} />
              ) : (
                'Nothing waiting'
              )}
            </Row>
            <Row label="Failed imports">
              <span className="num">{spool.failedTotal.toLocaleString()}</span>
            </Row>
          </dl>
        </Card>

        <Card title="Data" health="ok">
          <dl className="kv">
            <Row label="Database">
              <span className="mono break">
                <MarkedText text={db.path} />
              </span>
            </Row>
            <Row label="Size">
              <span className="num">{bytes(db.sizeBytes)}</span>
            </Row>
            <Row label="Recorded">
              <span className="num">
                {count(db.sessions, 'session')}, {count(db.events, 'event')}
              </span>
            </Row>
            <Row label="Kept for">
              <span className="num">{count(status.retentionDays, 'day')}</span>
            </Row>
          </dl>
          <p className="card-note">
            Everything stays on this computer. Delete data with{' '}
            <code className="mono">stillwatch delete-data</code>.
          </p>
        </Card>
      </div>

      <section className="report-section" aria-labelledby="gaps-title">
        <h2 id="gaps-title" className="section-title">
          Capture gaps
          <span className="section-count num">{status.gaps.length}</span>
        </h2>
        {status.gaps.length === 0 ? (
          <p className="muted">No gaps outside sessions. Stillwatch has been recording.</p>
        ) : (
          <ul className="row-list">
            {status.gaps.map((gap) => (
              <li key={gap.id} className="row">
                <span className={`tag ${gap.severity === 'info' ? '' : 'tag-warn'}`}>
                  {GAP_LABEL[gap.severity]}
                </span>
                <span className="row-body">
                  <MarkedText text={gap.reason} />
                </span>
                <span className="row-end muted">
                  <RelTime ts={gap.createdAt} now={now} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
