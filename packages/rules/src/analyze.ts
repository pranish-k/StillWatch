/** The analysis orchestrator: context, rules, findings, and every derived output. */
import {
  RULE_IDS,
  type AnalysisInput,
  type AnalysisResult,
  type SensitiveAccess,
} from '@stillwatch/schema';
import { buildContext, type Classify, type RuleContext } from './context';
import { finalizeFindings } from './findings';
import { buildGaps } from './gaps';
import { buildLinks, noteLoads } from './links';
import { riskOf } from './risk';
import { RULE_FUNCTIONS } from './rules';
import { buildStats } from './stats';
import { buildUnfinished } from './unfinished';

function sensitiveAccess(ctx: RuleContext): SensitiveAccess[] {
  const out: SensitiveAccess[] = [];
  for (const a of ctx.accesses) {
    if (!a.effective || !a.classification.classes.includes('secret')) continue;
    const op = a.access.op;
    out.push({
      path: a.access.path,
      op: op === 'delete' ? 'delete' : op === 'write' || op === 'chmod' ? 'write' : 'read',
      eventId: a.event.id,
      ts: a.event.ts,
      classes: a.classification.classes,
    });
  }
  return out;
}

/** Runs every rule over a context built with `classify`. */
export function analyzeWith(input: AnalysisInput, classify: Classify): AnalysisResult {
  const ctx = buildContext(input, classify);
  const drafts = RULE_IDS.flatMap((id) => RULE_FUNCTIONS[id](ctx));
  const findings = finalizeFindings(ctx, drafts);
  const gaps = buildGaps(ctx);
  const { risk, reasons } = riskOf(findings, [...input.gaps, ...gaps]);
  return {
    findings,
    fileChanges: ctx.fileChanges,
    artifacts: ctx.artifacts,
    links: buildLinks(ctx, noteLoads(ctx)),
    domains: ctx.domains,
    gaps,
    unfinished: buildUnfinished(ctx),
    sensitiveAccess: sensitiveAccess(ctx),
    stats: buildStats(ctx),
    risk,
    riskReasons: reasons,
    lastAssistantMessage: ctx.lastTurnStop?.data.lastMessage ?? null,
  };
}
