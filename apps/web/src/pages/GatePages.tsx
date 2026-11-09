import type { SignedOutReason } from '../auth/auth';
import { Icon } from '../ui/Icon';
import { Command } from '../ui/misc';

const SIGNED_OUT_TEXT: Record<SignedOutReason, string> = {
  none: 'The dashboard opens from your terminal, so only you can see your sessions.',
  expired: 'Your sign-in expired. Open the dashboard again from your terminal.',
  link_failed:
    'That sign-in link was already used or has expired. Links work once, for two minutes.',
};

export function SignedOutPage({ reason }: { reason: SignedOutReason }) {
  return (
    <section className="gate" aria-labelledby="gate-title">
      <div className="gate-icon">
        <Icon name="lock" size={20} />
      </div>
      <h1 id="gate-title" className="gate-title">
        {reason === 'none' ? 'Open Stillwatch from your terminal' : 'Sign in again'}
      </h1>
      <p className="gate-text">{SIGNED_OUT_TEXT[reason]}</p>
      <Command text="stillwatch open" />
    </section>
  );
}

export function UnreachablePage({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="gate" aria-labelledby="gate-title">
      <div className="gate-icon gate-icon-warn">
        <Icon name="plug" size={20} />
      </div>
      <h1 id="gate-title" className="gate-title">
        The collector is not running
      </h1>
      <p className="gate-text">
        Stillwatch keeps recording into its spool while the collector is stopped, and imports
        everything when it starts again.
      </p>
      <Command text="stillwatch start" />
      <button type="button" className="button" onClick={onRetry}>
        <Icon name="refresh" size={14} />
        Try again
      </button>
    </section>
  );
}
