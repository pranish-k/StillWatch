import type { SessionDetailResponse } from '@stillwatch/schema';
import { useRef, useState } from 'react';
import { useApi } from '../api/context';
import { errorMessage } from '../api/errors';
import { absoluteTime, count, duration } from '../lib/format';
import { useAsync, useFocusOnNavigate } from '../lib/hooks';
import { Link } from '../router/Link';
import { navigate, paths, useSearch } from '../router/router';
import { RiskBadge, StatusBadge } from '../ui/badges';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Icon } from '../ui/Icon';
import { MarkedText } from '../ui/MarkedText';
import { ErrorNotice, Loading } from '../ui/misc';
import { ReportView } from './session/ReportView';
import { TimelineView } from './session/TimelineView';

function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Action = 'idle' | 'downloading' | 'reanalyzing' | 'deleting';

function Actions({
  detail,
  onReanalyzed,
}: {
  detail: SessionDetailResponse;
  onReanalyzed: () => void;
}) {
  const api = useApi();
  const id = detail.session.id;
  const [action, setAction] = useState<Action>('idle');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (kind: Action, task: () => Promise<void>) => {
    setAction(kind);
    setError(null);
    task().then(
      () => setAction('idle'),
      (err: unknown) => {
        setError(errorMessage(err));
        setAction('idle');
      },
    );
  };

  return (
    <div className="session-actions">
      <button
        type="button"
        className="button"
        disabled={action !== 'idle'}
        onClick={() =>
          run('downloading', async () => {
            const { text, filename } = await api.reportMarkdown(id);
            downloadText(text, filename);
          })
        }
      >
        <Icon name="download" size={14} />
        {action === 'downloading' ? 'Preparing...' : 'Markdown report'}
      </button>
      <button
        type="button"
        className="button"
        disabled={action !== 'idle'}
        title="Run the rules again on the recorded events"
        onClick={() =>
          run('reanalyzing', async () => {
            await api.reanalyze(id);
            onReanalyzed();
          })
        }
      >
        <Icon name="refresh" size={14} />
        {action === 'reanalyzing' ? 'Analyzing...' : 'Analyze again'}
      </button>
      <button
        type="button"
        className="button button-quiet-danger"
        disabled={action !== 'idle'}
        onClick={() => setConfirming(true)}
      >
        <Icon name="trash" size={14} />
        Delete
      </button>
      {error !== null ? (
        <p className="action-error" role="alert">
          {error}
        </p>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title="Delete this session?"
          confirmLabel="Delete session"
          busy={action === 'deleting'}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setAction('deleting');
            api.deleteSession(id).then(
              () => navigate(paths.queue(), { replace: true }),
              (err: unknown) => {
                setConfirming(false);
                setAction('idle');
                setError(errorMessage(err));
              },
            );
          }}
        >
          <p>
            Its events, findings, and snapshots are removed from this computer. This cannot be
            undone, and files the agent changed are not touched.
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

function Header({
  detail,
  onReanalyzed,
}: {
  detail: SessionDetailResponse;
  onReanalyzed: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useFocusOnNavigate(headingRef, detail.session.id);
  const { session, report } = detail;
  return (
    <div className="session-head">
      <Link to={paths.queue()} className="back-link">
        <Icon name="arrowLeft" size={14} />
        Sessions
      </Link>
      <div className="session-head-row">
        <div className="session-head-text">
          <div className="session-badges">
            <RiskBadge level={session.risk} label={report.riskLabel} />
            <StatusBadge status={session.status} label={report.statusLabel} />
          </div>
          <h1 ref={headingRef} tabIndex={-1} className="page-title session-page-title">
            <MarkedText text={report.title} />
          </h1>
          <p className="session-head-meta">
            {report.project !== null ? (
              <>
                <span>
                  <MarkedText text={report.project} />
                </span>
                <span aria-hidden="true">·</span>
              </>
            ) : null}
            <span>
              <MarkedText text={report.agentLabel} />
            </span>
            <span aria-hidden="true">·</span>
            <time dateTime={new Date(report.startedAt).toISOString()} className="num">
              {absoluteTime(report.startedAt)}
            </time>
            <span aria-hidden="true">·</span>
            <span className="num">
              {session.status === 'active' ? 'Still running' : duration(report.durationMs)}
            </span>
          </p>
        </div>
        <Actions detail={detail} onReanalyzed={onReanalyzed} />
      </div>
    </div>
  );
}

function Tabs({
  id,
  view,
  eventCount,
}: {
  id: string;
  view: 'report' | 'timeline';
  eventCount: number;
}) {
  return (
    <nav className="tabs" aria-label="Session views">
      <Link
        to={paths.session(id)}
        replace
        className="tab"
        aria-current={view === 'report' ? 'page' : undefined}
      >
        Report
      </Link>
      <Link
        to={`${paths.session(id)}?view=timeline`}
        replace
        className="tab"
        aria-current={view === 'timeline' ? 'page' : undefined}
      >
        Timeline <span className="tab-count num">{eventCount.toLocaleString()}</span>
      </Link>
    </nav>
  );
}

export function SessionPage({ id, eventId }: { id: string; eventId: string | null }) {
  const api = useApi();
  const search = useSearch();
  const detail = useAsync((signal) => api.session(id, signal), id);
  const view =
    eventId !== null || new URLSearchParams(search).get('view') === 'timeline'
      ? 'timeline'
      : 'report';

  if (detail.status === 'loading') {
    return (
      <div className="page">
        <Loading label="Loading session" lines={10} />
      </div>
    );
  }
  if (detail.status === 'error') {
    return (
      <div className="page">
        <Link to={paths.queue()} className="back-link">
          <Icon name="arrowLeft" size={14} />
          Sessions
        </Link>
        <ErrorNotice message={errorMessage(detail.error)} onRetry={() => detail.reload()} />
      </div>
    );
  }
  const data = detail.data;
  return (
    <div className="page">
      <Header detail={data} onReanalyzed={() => detail.reload(true)} />
      <Tabs id={id} view={view} eventCount={data.session.eventCount} />
      {view === 'report' ? (
        <ReportView detail={data} />
      ) : (
        <TimelineView key={id} detail={data} eventId={eventId} />
      )}
      <p className="session-foot muted">
        Session <code className="mono">{data.session.id}</code>
        {data.session.analyzedAt !== null ? (
          <> · analyzed {absoluteTime(data.session.analyzedAt)}</>
        ) : null}
        {' · '}
        {count(data.session.eventCount, 'event')}
      </p>
    </div>
  );
}
