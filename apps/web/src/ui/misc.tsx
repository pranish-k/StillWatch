import { useEffect, useRef, useState } from 'react';
import { absoluteTime, relativeTime } from '../lib/format';
import { Icon } from './Icon';

export function RelTime({ ts, now }: { ts: number; now: number }) {
  return (
    <time className="num" dateTime={new Date(ts).toISOString()} title={absoluteTime(ts)}>
      {relativeTime(ts, now)}
    </time>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      className="button button-small"
      onClick={() => {
        void copyText(text).then((ok) => {
          setState(ok ? 'copied' : 'failed');
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setState('idle'), 2000);
        });
      }}
    >
      <Icon name={state === 'copied' ? 'check' : 'copy'} size={14} />
      <span aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
      </span>
    </button>
  );
}

/** A command shown in monospace with a copy button. */
export function Command({ text }: { text: string }) {
  return (
    <span className="command">
      <code>{text}</code>
      <CopyButton text={text} />
    </span>
  );
}

export function SkeletonLines({ lines, className }: { lines: number; className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton-line" />
      ))}
    </div>
  );
}

export function Loading({ label, lines = 6 }: { label: string; lines?: number }) {
  return (
    <div role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      <SkeletonLines lines={lines} />
    </div>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="notice notice-error" role="alert">
      <Icon name="alert" />
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="button button-small" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
