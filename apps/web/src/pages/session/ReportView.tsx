import type {
  ReportFinding,
  RiskLevel,
  SessionDetailResponse,
  SessionStats,
} from '@stillwatch/schema';
import type { ReactNode } from 'react';
import { count, duration } from '../../lib/format';
import {
  ARTIFACT_LABEL,
  ATTRIBUTION_LABEL,
  CHANGE_LABEL,
  GAP_LABEL,
  UNFINISHED_LABEL,
} from '../../lib/labels';
import { Link } from '../../router/Link';
import { paths } from '../../router/router';
import { SeverityMark } from '../../ui/badges';
import { Icon } from '../../ui/Icon';
import { MarkedText } from '../../ui/MarkedText';

const MAX_EVIDENCE_LINKS = 5;

const WHY_TITLE: Record<RiskLevel, string> = {
  high: 'Why this is high risk',
  medium: 'Why this is worth a look',
  unknown: 'Why the risk is unknown',
  low: 'Findings',
};

function Section({
  id,
  title,
  count: n,
  children,
  note,
}: {
  id: string;
  title: string;
  count?: number;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <section className="report-section" aria-labelledby={id}>
      <h2 id={id} className="section-title">
        {title}
        {n !== undefined ? <span className="section-count num">{n.toLocaleString()}</span> : null}
      </h2>
      {children}
      {note !== undefined ? <p className="section-note">{note}</p> : null}
    </section>
  );
}

function EvidenceLinks({ sessionId, eventIds }: { sessionId: string; eventIds: string[] }) {
  if (eventIds.length === 0) return null;
  const shown = eventIds.slice(0, MAX_EVIDENCE_LINKS);
  const rest = eventIds.length - shown.length;
  return (
    <span className="evidence">
      {shown.length === 1 ? (
        <Link to={paths.event(sessionId, shown[0] ?? '')} className="evidence-link">
          Show in timeline
          <Icon name="chevron" size={12} />
        </Link>
      ) : (
        <>
          <span className="muted">Evidence</span>
          {shown.map((eventId, i) => (
            <Link
              key={eventId}
              to={paths.event(sessionId, eventId)}
              className="evidence-chip num"
              aria-label={`Evidence ${i + 1} of ${eventIds.length}`}
            >
              {i + 1}
            </Link>
          ))}
          {rest > 0 ? <span className="muted">and {rest} more</span> : null}
        </>
      )}
    </span>
  );
}

/** A path inside the project, shown relative to it; anything else as recorded. */
function shortPath(path: string, root: string | null): string {
  if (root === null || root === '') return path;
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return path.startsWith(prefix) && path.length > prefix.length ? path.slice(prefix.length) : path;
}

function FindingCard({
  finding,
  sessionId,
  root,
}: {
  finding: ReportFinding;
  sessionId: string;
  root: string | null;
}) {
  return (
    <li className={`finding finding-${finding.severity}`}>
      <div className="finding-head">
        <SeverityMark severity={finding.severity} />
        <h3 className="finding-title">
          <MarkedText text={finding.title} />
        </h3>
        {finding.requested === false ? (
          <span className="tag tag-warn" title="Your prompts in this session did not ask for this">
            Not requested
          </span>
        ) : null}
      </div>
      <p className="finding-reason">
        <MarkedText text={finding.reason} />
      </p>
      {finding.evidence.paths.length > 0 ? (
        <ul className="path-list">
          {finding.evidence.paths.slice(0, 6).map((path) => (
            <li key={path} className="mono truncate" title={path}>
              <MarkedText text={shortPath(path, root)} />
            </li>
          ))}
          {finding.evidence.paths.length > 6 ? (
            <li className="muted">and {count(finding.evidence.paths.length - 6, 'more path')}</li>
          ) : null}
        </ul>
      ) : null}
      <EvidenceLinks sessionId={sessionId} eventIds={finding.evidence.eventIds} />
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

function Glance({ stats, detail }: { stats: SessionStats | null; detail: SessionDetailResponse }) {
  const { session, report } = detail;
  return (
    <aside className="glance" aria-label="Session at a glance">
      <h2 className="glance-title">At a glance</h2>
      <dl className="stats">
        <Stat
          label="Duration"
          value={session.status === 'active' ? 'Running' : duration(report.durationMs)}
        />
        <Stat label="Events" value={session.eventCount.toLocaleString()} />
        {stats !== null ? (
          <>
            <Stat label="Tool calls" value={stats.toolCalls.toLocaleString()} />
            <Stat label="Commands" value={stats.commands.toLocaleString()} />
            <Stat label="Files read" value={stats.filesRead.toLocaleString()} />
            <Stat label="Files written" value={stats.filesWritten.toLocaleString()} />
            <Stat label="Prompts" value={stats.prompts.toLocaleString()} />
            <Stat label="Failed calls" value={stats.failures.toLocaleString()} />
            {stats.denials > 0 ? (
              <Stat label="Denied" value={stats.denials.toLocaleString()} />
            ) : null}
          </>
        ) : null}
        <Stat label="Subagents" value={session.subagentCount.toLocaleString()} />
      </dl>
      {report.model !== null ? (
        <p className="glance-line">
          <span className="muted">Model</span>
          <span className="mono truncate" title={report.model}>
            <MarkedText text={report.model} />
          </span>
        </p>
      ) : null}
      {session.permissionMode !== null ? (
        <p className="glance-line">
          <span className="muted">Permissions</span>
          <span className="mono">
            <MarkedText text={session.permissionMode} />
          </span>
        </p>
      ) : null}
      {report.subagents.length > 0 ? (
        <div className="glance-block">
          <h3 className="glance-subtitle">Subagents</h3>
          <ul className="plain-list">
            {report.subagents.map((agent) => (
              <li key={agent.id} className="truncate" title={agent.id}>
                <MarkedText text={agent.type ?? 'General-purpose'} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}

export function ReportView({ detail }: { detail: SessionDetailResponse }) {
  const { report, session } = detail;
  const sid = session.id;
  const root = session.projectRoot;
  const unattributed = report.filesChanged.filter((f) => f.attribution === 'unattributed').length;

  return (
    <div className="report">
      <div className="report-main">
        <section className="summary" aria-labelledby="summary-title">
          <h2 id="summary-title" className="visually-hidden">
            Summary
          </h2>
          {report.summary.length > 0 ? (
            report.summary.map((line, i) => (
              <p key={i} className={i === 0 ? 'summary-lead' : 'summary-line'}>
                <MarkedText text={line} />
              </p>
            ))
          ) : (
            <p className="summary-line muted">Nothing notable was recorded in this session.</p>
          )}
        </section>

        {report.gaps.some((g) => g.severity === 'critical') ? (
          <div className="notice notice-warn" role="note">
            <Icon name="alert" />
            <span>
              Important data is missing for this session, so findings may be incomplete. See capture
              gaps below.
            </span>
          </div>
        ) : null}

        {report.whyRisk.length > 0 ? (
          <Section id="why" title={WHY_TITLE[report.risk]} count={report.whyRisk.length}>
            <ul className="finding-list">
              {report.whyRisk.map((finding) => (
                <FindingCard key={finding.id} finding={finding} sessionId={sid} root={root} />
              ))}
            </ul>
          </Section>
        ) : null}

        {report.whatRemains.length > 0 ? (
          <Section
            id="remains"
            title="What remains"
            count={report.whatRemains.length}
            note="These can run or be read again after the session ended. Check that each one is expected."
          >
            <ul className="row-list">
              {report.whatRemains.map((item, i) => (
                <li key={`${item.path}-${i}`} className="row">
                  <span className="tag">{ARTIFACT_LABEL[item.kind]}</span>
                  <span className="row-body">
                    <span className="mono truncate" title={item.path}>
                      <MarkedText text={item.display} />
                    </span>
                    {item.detail !== null &&
                    item.detail.toLowerCase() !== ARTIFACT_LABEL[item.kind].toLowerCase() ? (
                      <span className="row-detail">
                        <MarkedText text={item.detail} />
                      </span>
                    ) : null}
                  </span>
                  <span className="row-end">
                    <span className="muted">{item.change}</span>
                    <EvidenceLinks sessionId={sid} eventIds={item.eventIds.slice(0, 1)} />
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {report.otherFindings.length > 0 ? (
          <Section id="other" title="Other findings" count={report.otherFindings.length}>
            <ul className="finding-list finding-list-compact">
              {report.otherFindings.map((finding) => (
                <FindingCard key={finding.id} finding={finding} sessionId={sid} root={root} />
              ))}
            </ul>
          </Section>
        ) : null}

        <Section
          id="files"
          title="Files changed"
          count={report.filesChanged.length}
          {...(unattributed > 0
            ? {
                note: `${count(unattributed, 'change')} did not come from any recorded tool call or command. Another program, or a capture gap, may explain it.`,
              }
            : {})}
        >
          {report.filesChanged.length === 0 ? (
            <p className="muted">No file changes were recorded.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Path</th>
                    <th scope="col">Change</th>
                    <th scope="col" className="align-end">
                      Lines
                    </th>
                    <th scope="col">Made by</th>
                  </tr>
                </thead>
                <tbody>
                  {report.filesChanged.map((file) => (
                    <tr key={file.path}>
                      <td className="mono cell-path" title={file.path}>
                        <MarkedText text={file.display} />
                      </td>
                      <td>{CHANGE_LABEL[file.change]}</td>
                      <td className="align-end num nowrap">
                        {file.additions === null && file.deletions === null ? (
                          <span className="muted">-</span>
                        ) : (
                          <>
                            <span className="added">+{file.additions ?? 0}</span>{' '}
                            <span className="removed">-{file.deletions ?? 0}</span>
                          </>
                        )}
                      </td>
                      <td>
                        {file.attribution === 'unattributed' ? (
                          <span className="tag tag-warn">
                            {ATTRIBUTION_LABEL[file.attribution]}
                          </span>
                        ) : (
                          ATTRIBUTION_LABEL[file.attribution]
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {report.sensitiveAccess.length > 0 ? (
          <Section id="sensitive" title="Sensitive access" count={report.sensitiveAccess.length}>
            <ul className="row-list">
              {report.sensitiveAccess.map((item, i) => (
                <li key={`${item.path}-${i}`} className="row">
                  <span className="tag">{item.op}</span>
                  <span className="row-body">
                    <span className="mono truncate" title={item.path}>
                      <MarkedText text={item.display} />
                    </span>
                  </span>
                  <span className="row-end">
                    <EvidenceLinks sessionId={sid} eventIds={[item.eventId]} />
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section
          id="network"
          title="Network"
          count={report.network.length}
          note={report.networkNote}
        >
          {report.network.length === 0 ? (
            <p className="muted">No domains appeared in tool calls.</p>
          ) : (
            <ul className="row-list">
              {report.network.map((item) => (
                <li key={item.domain} className="row">
                  <span className="row-body">
                    <span className="mono truncate">
                      <MarkedText text={item.domain} />
                    </span>
                    {item.via.length > 0 ? (
                      <span className="row-detail">
                        via <MarkedText text={item.via.join(', ')} />
                      </span>
                    ) : null}
                  </span>
                  <span className="row-end">
                    {item.isNew ? (
                      <span className="tag tag-warn" title="Not seen in earlier sessions">
                        New
                      </span>
                    ) : null}
                    <span className="muted num">{count(item.count, 'time')}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {report.unfinished.length > 0 ? (
          <Section id="unfinished" title="Unfinished work" count={report.unfinished.length}>
            <ul className="row-list">
              {report.unfinished.map((item, i) => (
                <li key={i} className="row">
                  <span className="tag">{UNFINISHED_LABEL[item.kind]}</span>
                  <span className="row-body">
                    <MarkedText text={item.label} />
                  </span>
                  <span className="row-end">
                    {item.eventId !== null ? (
                      <EvidenceLinks sessionId={sid} eventIds={[item.eventId]} />
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {report.related.length > 0 ? (
          <Section id="related" title="Related sessions" count={report.related.length}>
            <ul className="row-list">
              {report.related.map((item, i) => (
                <li key={`${item.sessionId}-${i}`} className="row">
                  <Icon name="link" size={14} className="muted" />
                  <span className="row-body">
                    <span>
                      {item.direction === 'incoming' ? 'Written by ' : 'Used later by '}
                      <Link to={paths.session(item.sessionId)}>
                        <MarkedText text={item.sessionTitle ?? 'an untitled session'} />
                      </Link>
                    </span>
                    <span className="row-detail mono truncate" title={item.path}>
                      <MarkedText text={item.display} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {report.gaps.length > 0 ? (
          <Section id="gaps" title="Capture gaps" count={report.gaps.length}>
            <ul className="row-list">
              {report.gaps.map((gap, i) => (
                <li key={i} className="row">
                  <span className={`tag ${gap.severity === 'info' ? '' : 'tag-warn'}`}>
                    {GAP_LABEL[gap.severity]}
                  </span>
                  <span className="row-body">
                    <MarkedText text={gap.reason} />
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {report.agentReported !== null ? (
          <Section
            id="reported"
            title="What the agent said at the end"
            note="This is the agent's own account. Stillwatch never uses it to decide risk."
          >
            <blockquote className="quote">
              <MarkedText text={report.agentReported} />
            </blockquote>
          </Section>
        ) : null}

        <details className="limits">
          <summary>What Stillwatch cannot see</summary>
          <ul>
            {report.limits.map((limit, i) => (
              <li key={i}>{limit}</li>
            ))}
          </ul>
        </details>
      </div>
      <Glance stats={detail.stats} detail={detail} />
    </div>
  );
}
