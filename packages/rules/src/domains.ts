/**
 * Network reach: which tool calls can talk to the network, which domains they
 * name, and per-domain records for the report.
 */
import type { AnalysisInput, DomainRecord, StoredEvent } from '@stillwatch/schema';
import type { NetworkCall, ToolCallGroup } from './context';
import { pushUnique, urlHost } from './text';

/** Package registries and code hosts that ordinary development contacts. */
const WELL_KNOWN_SUFFIXES = [
  'npmjs.org',
  'npmjs.com',
  'yarnpkg.com',
  'pypi.org',
  'pythonhosted.org',
  'crates.io',
  'golang.org',
  'go.dev',
  'rubygems.org',
  'github.com',
  'githubusercontent.com',
  'gitlab.com',
  'bitbucket.org',
  'nodejs.org',
  'jsr.io',
  'deno.land',
  'maven.org',
  'apache.org',
  'gradle.org',
  'nuget.org',
  'packagist.org',
  'brew.sh',
  'ghcr.io',
  'docker.io',
  'docker.com',
];

/** True for registries and code hosts (and their subdomains). */
export function isWellKnownDomain(domain: string): boolean {
  return WELL_KNOWN_SUFFIXES.some((s) => domain === s || domain.endsWith(`.${s}`));
}

/** True for loopback and local names, which never leave the computer. */
export function isLocalDomain(domain: string): boolean {
  return (
    domain === 'localhost' ||
    domain.endsWith('.localhost') ||
    domain.startsWith('127.') ||
    domain === '::1' ||
    domain === '[::1]' ||
    domain === '0.0.0.0'
  );
}

/** True when an event's tool can reach the network. */
export function isNetworkCapable(event: StoredEvent): boolean {
  const category = event.tool?.category;
  if (category === 'web.fetch' || category === 'web.search' || category === 'mcp') return true;
  return event.facts.signals.some((s) => s.kind === 'network' && s.source === 'tool.input');
}

/** Network-capable tool calls, with the domains their input names. */
export function buildNetworkCalls(
  calls: readonly ToolCallGroup[],
  indexOf: ReadonlyMap<string, number>,
): NetworkCall[] {
  const out: NetworkCall[] = [];
  for (const group of calls) {
    const events = [group.pre, group.post, group.failure].filter((e) => e !== null);
    if (!events.some(isNetworkCapable)) continue;
    // The call event's facts hold input only; a result's facts also name response domains.
    const inputFacts = (group.pre ?? group.primary).facts;
    const domains: string[] = [];
    for (const d of inputFacts.domains) pushUnique(domains, d);
    const urlDomain = group.tool.url === null ? null : urlHost(group.tool.url);
    if (urlDomain !== null) pushUnique(domains, urlDomain);
    const via = new Map<string, string[]>();
    for (const domain of domains) {
      const programs = inputFacts.commands
        .filter((c) => c.text.toLowerCase().includes(domain))
        .map((c) => c.program);
      const first = inputFacts.commands[0]?.program;
      const names =
        programs.length > 0
          ? programs
          : group.category === 'shell' && first !== undefined
            ? [first]
            : [group.tool.name];
      const list: string[] = [];
      for (const n of names) pushUnique(list, n);
      via.set(domain, list);
    }
    const event = group.post ?? group.failure ?? group.pre ?? group.primary;
    out.push({
      group,
      event,
      index: indexOf.get(event.id) ?? 0,
      domains,
      via,
      effective: group.denied === null,
    });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** One record per domain the session contacted, in first-contact order. */
export function buildDomainRecords(
  input: AnalysisInput,
  calls: readonly NetworkCall[],
): DomainRecord[] {
  const known = new Set(input.prior.knownDomains.map((d) => d.toLowerCase()));
  const byDomain = new Map<string, DomainRecord>();
  for (const call of calls) {
    if (!call.effective) continue;
    for (const domain of call.domains) {
      let record = byDomain.get(domain);
      if (record === undefined) {
        record = {
          sessionId: input.session.id,
          domain,
          firstEventId: (call.group.pre ?? call.event).id,
          count: 0,
          isNew: !known.has(domain),
          via: [],
        };
        byDomain.set(domain, record);
      }
      record.count += 1;
      for (const v of call.via.get(domain) ?? []) pushUnique(record.via, v);
    }
  }
  return [...byDomain.values()];
}
