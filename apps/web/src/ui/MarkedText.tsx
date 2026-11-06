import { memo } from 'react';
import { parseMarkers } from '../lib/markers';

/**
 * Renders untrusted text as text, with redaction and truncation markers
 * highlighted as spans. Never interprets markup.
 */
export const MarkedText = memo(function MarkedText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const segments = parseMarkers(text);
  if (segments.length === 1 && segments[0]?.kind === 'text') {
    return <span className={className}>{text}</span>;
  }
  return (
    <span className={className}>
      {segments.map((segment, i) => {
        switch (segment.kind) {
          case 'text':
            return segment.text;
          case 'redacted':
            return (
              <mark
                key={i}
                className="marker marker-redacted"
                title={`Secret removed by Stillwatch (${segment.detector}, fingerprint ${segment.fingerprint})`}
              >
                {segment.text}
              </mark>
            );
          case 'truncated':
            return (
              <mark
                key={i}
                className="marker marker-truncated"
                title={`${segment.removed.toLocaleString()} characters were cut for storage`}
              >
                {segment.text}
              </mark>
            );
        }
      })}
    </span>
  );
});
