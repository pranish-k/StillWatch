/**
 * Detects instruction-like text aimed at an agent, and hidden text, inside
 * untrusted content. Every pattern is linear: alternatives are fixed words
 * and gaps are bounded, so a megabyte of hostile text is scanned quickly.
 */
import type { FactSource, Signal } from '@stillwatch/schema';
import { capText } from './text';

type Pattern = { re: RegExp; kind: 'prompt_injection'; confidence: Signal['confidence'] };

const AGENT = String.raw`(?:ai\s+(?:agents?|assistants?|models?)|assistants?|agents?|claude|codex|llms?|language\s+models?)`;
const VERB = String.raw`(?:run|execute|curl|wget|download|install|write|delete|remove|send|upload|exfiltrate)`;
const MODAL = String.raw`(?:must|should|shall|needs?\s+to|ha(?:ve|s)\s+to|(?:are|is)\s+(?:required|instructed)\s+to|will\s+now|now)`;

function p(source: string, confidence: Signal['confidence']): Pattern {
  return { re: new RegExp(source, 'gi'), kind: 'prompt_injection', confidence };
}

const PATTERNS: Pattern[] = [
  p(
    String.raw`\b(?:ignore|disregard|forget)\s+(?:(?:all|any|the|your|my|of|these|those)\s+){0,3}(?:previous|prior|above|earlier|preceding)\s+(?:instructions?|directions?|prompts?|messages?|rules?|guidelines?|context|commands?)\b`,
    'high',
  ),
  p(String.raw`\byou\s+are\s+now\b`, 'low'),
  p(String.raw`\bnew\s+instructions\b`, 'medium'),
  p(String.raw`\bsystem\s+prompt\b`, 'low'),
  p(String.raw`<\/?system>|<assistant>|<\|im_start\|>|\[INST\]`, 'high'),
  p(String.raw`<\/?system-reminder>|<\|im_end\|>|<<SYS>>`, 'medium'),
  p(
    String.raw`\b(?:important|note)\s*(?::|\s+to\b|\s+for\b)\s*(?:(?:to|for|the|all|any)\s+){0,2}(?:${AGENT}|ai|chatgpt|copilot|gemini)\b`,
    'medium',
  ),
  p(
    String.raw`\b(?:important|note)\s*:[^\n]{0,60}?\b(?:if\s+you\s+are|as)\s+an?\s+(?:ai|llm|language\s+model|assistant|agent|ai\s+agent|ai\s+assistant)\b`,
    'high',
  ),
  p(
    String.raw`\b${AGENT}(?:\s+[\w'-]{1,30}){0,4}?\s+${MODAL}\s+(?:(?:now|immediately|also|first|then|quietly|silently)\s+)?${VERB}\b`,
    'medium',
  ),
  p(
    String.raw`\b(?:claude|codex|assistant|agent|ai)\s*[,:]\s*(?:please\s+)?(?:now\s+|immediately\s+)?${VERB}\b`,
    'medium',
  ),
  p(
    String.raw`\bif\s+you(?:'re|\s+are)\s+an?\s+(?:ai|llm|language\s+model|assistant|agent|ai\s+agent|ai\s+assistant|automated\s+agent)\b[^\n]{0,80}?\b${VERB}\b`,
    'high',
  ),
  p(
    String.raw`\b(?:do\s+not|don['’]?t|never)\s+(?:tell|inform|notify|alert|show|mention\s+(?:this\s+|it\s+)?to|reveal\s+(?:this\s+|it\s+)?to)\s+(?:the\s+)?user\b`,
    'high',
  ),
  p(
    String.raw`\bwithout\s+(?:asking|telling|informing|notifying|alerting|confirming\s+with|consulting)\s+(?:the\s+)?user\b`,
    'medium',
  ),
];

const COMMENT_VERB = new RegExp(String.raw`\b(?:${VERB}|ignore|disregard)\b`, 'i');
const COMMENT_AGENT = /\b(?:ai|assistant|agent|claude|codex|llm|you)\b/i;
const COMMENT_IMPERATIVE = new RegExp(String.raw`^\s*(?:please\s+)?${VERB}\b`, 'i');

const INVISIBLE =
  /[\u200b-\u200d\u2060\ufeff\u202a-\u202e\u2066-\u2069\u00ad]|\uDB40[\uDC00-\uDC7F]/g;

const MAX_DETAIL = 80;
const MAX_SIGNALS = 32;
const MAX_MATCHES_PER_PATTERN = 8;
const MAX_COMMENT_SCAN = 4000;

function isZeroWidth(cp: number): boolean {
  return (cp >= 0x200b && cp <= 0x200d) || cp === 0x2060 || cp === 0xfeff;
}

function isBidi(cp: number): boolean {
  return (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
}

function isTag(cp: number): boolean {
  return cp >= 0xe0000 && cp <= 0xe007f;
}

/** Collapses whitespace and caps a detail string. */
export function shortDetail(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_DETAIL ? `${capText(collapsed, MAX_DETAIL - 3)}...` : collapsed;
}

/** Collects signals from one source, deduplicated by kind and detail, up to a cap. */
export class SignalList {
  readonly out: Signal[] = [];
  private readonly seen = new Set<string>();
  private readonly source: FactSource;

  constructor(source: FactSource) {
    this.source = source;
  }

  add(kind: Signal['kind'], detail: string, confidence: Signal['confidence']): void {
    const d = shortDetail(detail);
    const key = `${kind}\u0000${d.toLowerCase()}`;
    if (this.out.length >= MAX_SIGNALS || this.seen.has(key)) return;
    this.seen.add(key);
    this.out.push({ kind, detail: d, source: this.source, confidence });
  }
}

function scanPatterns(text: string, list: SignalList, prefix: string): void {
  for (const pattern of PATTERNS) {
    let n = 0;
    pattern.re.lastIndex = 0;
    for (let m = pattern.re.exec(text); m !== null; m = pattern.re.exec(text)) {
      list.add(pattern.kind, prefix + m[0], prefix === '' ? pattern.confidence : 'high');
      if (++n >= MAX_MATCHES_PER_PATTERN) break;
      if (m[0] === '') pattern.re.lastIndex++;
    }
  }
}

function scanComments(text: string, list: SignalList): void {
  let from = 0;
  for (;;) {
    const open = text.indexOf('<!--', from);
    if (open === -1) return;
    const close = text.indexOf('-->', open + 4);
    const end = close === -1 ? text.length : close;
    const body = text.slice(open + 4, Math.min(end, open + 4 + MAX_COMMENT_SCAN));
    if (COMMENT_VERB.test(body) && (COMMENT_AGENT.test(body) || COMMENT_IMPERATIVE.test(body))) {
      list.add('hidden_text', `HTML comment: ${body}`, 'high');
    }
    if (close === -1) return;
    from = close + 3;
  }
}

/** Scans for invisible characters and returns text hidden in Unicode tag characters. */
function scanInvisible(text: string, list: SignalList): string {
  let zeroRun = 0;
  let longestZeroRun = 0;
  let bidi = 0;
  let tags = 0;
  let decoded = '';
  let tagRun = 0;
  let tagRunAfterFlag = false;
  let prev = 0;
  let flagTags = 0;
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i) ?? 0;
    if (cp > 0xffff) i++;
    if (isZeroWidth(cp)) {
      zeroRun++;
      if (zeroRun > longestZeroRun) longestZeroRun = zeroRun;
    } else {
      zeroRun = 0;
    }
    if (isBidi(cp)) bidi++;
    if (isTag(cp)) {
      if (tagRun === 0) tagRunAfterFlag = prev === 0x1f3f4;
      tagRun++;
      if (cp >= 0xe0020 && cp <= 0xe007e && decoded.length < 4096) {
        decoded += String.fromCharCode(cp - 0xe0000);
      }
      if (cp === 0xe007f && tagRunAfterFlag && tagRun <= 8) flagTags += tagRun;
    } else {
      if (tagRun > 0) tags += tagRun;
      tagRun = 0;
    }
    prev = cp;
  }
  tags += tagRun;
  if (longestZeroRun >= 2) {
    list.add('hidden_text', 'zero-width character run', longestZeroRun >= 8 ? 'high' : 'medium');
  }
  if (tags - flagTags > 0) list.add('hidden_text', 'Unicode tag characters', 'high');
  if (bidi > 0) list.add('hidden_text', 'bidirectional control characters', 'medium');
  return tags - flagTags > 0 ? decoded : '';
}

export function findInjection(text: string, source: FactSource): Signal[] {
  const list = new SignalList(source);
  if (text === '') return list.out;
  const hidden = scanInvisible(text, list);
  const visible = text.replace(INVISIBLE, '');
  scanPatterns(visible, list, '');
  scanComments(visible, list);
  if (hidden !== '') scanPatterns(hidden, list, 'hidden: ');
  return list.out;
}
