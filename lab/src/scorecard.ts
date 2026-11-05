import type { ScenarioResult, Scorecard } from './index';

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
};

type Paint = (text: string, ...codes: string[]) => string;

/** Removes control characters, so text from a scenario can never drive the terminal. */
export function terminalSafe(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '?').replace(/\n/g, ' ');
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  return `${(ms / 1_000).toFixed(1)} s`;
}

export function tally(startedAt: number, durationMs: number, results: ScenarioResult[]): Scorecard {
  const attacks = results.filter((r) => r.category === 'attack');
  const normal = results.filter((r) => r.category === 'normal');
  return {
    startedAt,
    durationMs,
    results,
    attacksDetected: attacks.filter((r) => r.status === 'detected').length,
    attacksTotal: attacks.length,
    normalQuiet: normal.filter((r) => r.status === 'quiet').length,
    normalTotal: normal.length,
    errors: results.filter((r) => r.status === 'error').length,
  };
}

function statusColor(status: ScenarioResult['status']): string {
  switch (status) {
    case 'detected':
    case 'quiet':
      return ANSI.green;
    case 'missed':
    case 'noisy':
      return ANSI.red;
    case 'error':
      return ANSI.yellow;
  }
}

/** Plain-text scorecard; columns are aligned on the uncolored text. */
export function renderScorecardText(card: Scorecard, options: { color?: boolean } = {}): string {
  const paint: Paint = (text, ...codes) =>
    options.color === true && codes.length > 0 ? `${codes.join('')}${text}${ANSI.reset}` : text;
  const rows = card.results.map((r) => ({
    result: r,
    status: r.status.toUpperCase(),
    id: terminalSafe(r.id),
    title: terminalSafe(r.title),
    time: formatDuration(r.durationMs),
  }));
  const width = (pick: (row: (typeof rows)[number]) => string): number =>
    Math.max(0, ...rows.map((row) => pick(row).length));
  const statusW = width((r) => r.status);
  const idW = width((r) => r.id);
  const titleW = width((r) => r.title);
  const timeW = width((r) => r.time);
  const indent = ' '.repeat(2 + statusW + 2);

  const lines: string[] = [paint('Stillwatch attack lab', ANSI.bold), ''];
  const sections: [string, ScenarioResult['category']][] = [
    ['Attacks', 'attack'],
    ['Normal sessions', 'normal'],
  ];
  for (const [heading, category] of sections) {
    const group = rows.filter((row) => row.result.category === category);
    if (group.length === 0) continue;
    lines.push(paint(heading, ANSI.bold));
    for (const row of group) {
      const status = paint(row.status.padEnd(statusW), statusColor(row.result.status));
      lines.push(
        `  ${status}  ${row.id.padEnd(idW)}  ${row.title.padEnd(titleW)}  ${row.time.padStart(timeW)}`.trimEnd(),
      );
      const detail = detailLine(row.result);
      if (detail !== null) lines.push(paint(`${indent}${terminalSafe(detail)}`, ANSI.dim));
    }
    lines.push('');
  }
  let totals = `Attacks detected ${card.attacksDetected}/${card.attacksTotal}, normal sessions quiet ${card.normalQuiet}/${card.normalTotal}`;
  if (card.errors > 0) totals += `, ${card.errors} ${card.errors === 1 ? 'error' : 'errors'}`;
  const allGood =
    card.errors === 0 &&
    card.attacksDetected === card.attacksTotal &&
    card.normalQuiet === card.normalTotal;
  lines.push(paint(totals, ANSI.bold, allGood ? ANSI.green : ANSI.red));
  lines.push(
    `Ran ${card.results.length} ${card.results.length === 1 ? 'scenario' : 'scenarios'} in ${formatDuration(card.durationMs)}`,
  );
  return `${lines.join('\n')}\n`;
}

function detailLine(result: ScenarioResult): string | null {
  switch (result.status) {
    case 'detected':
      return `found ${result.expected.join(', ')}`;
    case 'quiet':
      return null;
    case 'missed':
    case 'noisy':
    case 'error':
      return result.note;
  }
}
