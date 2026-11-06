/**
 * Risk, severity, and status badges. Each carries text and a distinct shape,
 * so meaning never depends on color alone.
 */
import type { RiskLevel, SessionStatus, Severity } from '@stillwatch/schema';

const RISK_LABEL: Record<RiskLevel, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  unknown: 'Unknown',
};

/** Shapes: high a filled triangle, medium a diamond, low a circle, unknown a dashed circle. */
export function RiskShape({ level, size = 10 }: { level: RiskLevel; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 10 10', 'aria-hidden': true } as const;
  switch (level) {
    case 'high':
      return (
        <svg {...common} className="shape">
          <path d="M5 .8 9.6 9.2H.4z" fill="currentColor" />
        </svg>
      );
    case 'medium':
      return (
        <svg {...common} className="shape">
          <path d="M5 .6 9.4 5 5 9.4.6 5z" fill="currentColor" />
        </svg>
      );
    case 'low':
      return (
        <svg {...common} className="shape">
          <circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case 'unknown':
      return (
        <svg {...common} className="shape">
          <circle
            cx="5"
            cy="5"
            r="3.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeDasharray="2 1.6"
          />
        </svg>
      );
  }
}

export function RiskBadge({ level, label }: { level: RiskLevel; label?: string }) {
  return (
    <span className={`badge risk risk-${level}`}>
      <RiskShape level={level} />
      {label ?? `${RISK_LABEL[level]} risk`}
    </span>
  );
}

export function SeverityMark({ severity }: { severity: Severity }) {
  return (
    <span className={`severity risk-${severity}`}>
      <RiskShape level={severity} />
      <span>{RISK_LABEL[severity]}</span>
    </span>
  );
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  active: 'Live',
  finished: 'Finished',
  interrupted: 'Interrupted',
};

export function StatusBadge({ status, label }: { status: SessionStatus; label?: string }) {
  return (
    <span className={`badge status status-${status}`}>
      {status === 'active' ? <span className="live-dot" aria-hidden="true" /> : null}
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}
