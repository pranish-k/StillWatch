/**
 * Collapsible JSON viewer. Every value is rendered as text; strings get
 * redaction and truncation markers highlighted.
 */
import type { JsonValue } from '@stillwatch/schema';
import { memo } from 'react';
import { MarkedText } from './MarkedText';

function summary(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.length} ${value.length === 1 ? 'item' : 'items'}]`;
  if (value !== null && typeof value === 'object') {
    const n = Object.keys(value).length;
    return `{${n} ${n === 1 ? 'key' : 'keys'}}`;
  }
  return '';
}

function Leaf({ value }: { value: Exclude<JsonValue, object> | null }) {
  if (value === null) return <span className="json-null">null</span>;
  if (typeof value === 'string') {
    return (
      <span className="json-string">
        &quot;
        <MarkedText text={value} />
        &quot;
      </span>
    );
  }
  if (typeof value === 'number') return <span className="json-number">{String(value)}</span>;
  return <span className="json-bool">{String(value)}</span>;
}

const Node = memo(function Node({
  name,
  value,
  depth,
}: {
  name: string | null;
  value: JsonValue;
  depth: number;
}) {
  const key =
    name === null ? null : (
      <>
        <span className="json-key">{name}</span>
        <span className="json-punct">: </span>
      </>
    );
  if (value === null || typeof value !== 'object') {
    return (
      <div className="json-row">
        {key}
        <Leaf value={value} />
      </div>
    );
  }
  const entries: [string, JsonValue][] = Array.isArray(value)
    ? value.map((item, i) => [String(i), item])
    : Object.entries(value);
  if (entries.length === 0) {
    return (
      <div className="json-row">
        {key}
        <span className="json-punct">{Array.isArray(value) ? '[]' : '{}'}</span>
      </div>
    );
  }
  return (
    <details className="json-node" open={depth < 2}>
      <summary className="json-row">
        {key}
        <span className="json-summary">{summary(value)}</span>
      </summary>
      <div className="json-children">
        {entries.map(([k, v]) => (
          <Node key={k} name={k} value={v} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
});

export function JsonTree({ value, label }: { value: JsonValue; label: string }) {
  return (
    <div className="json-tree mono" role="group" aria-label={label}>
      {value !== null && typeof value === 'object' && Object.keys(value).length > 0 ? (
        // Show the top level open, without a wrapper row for the root itself.
        (Array.isArray(value)
          ? value.map((v, i) => [String(i), v] as const)
          : Object.entries(value)
        ).map(([k, v]) => <Node key={k} name={k} value={v} depth={1} />)
      ) : (
        <Node name={null} value={value} depth={0} />
      )}
    </div>
  );
}
