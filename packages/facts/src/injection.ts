/**
 * Detects instruction-like text aimed at an agent, and hidden text, inside
 * untrusted content. Every pattern is linear: alternatives are fixed words
 * and gaps are bounded, so a megabyte of hostile text is scanned quickly.
 */
import type { FactSource, Signal } from '@stillwatch/schema';
import { capText } from './text';

type Pattern = { re: RegExp; kind: 'prompt_injection'; confidence: Signal['confidence'] };

const AGENT = String.raw`(?:ai\s+(?:agents?|assistants?|models?)|assistants?|agents?|claude|codex|llms?|language\s+models?)`;
const VERB = String.raw`(?:run|execute|curl|wget|download|install|write|delete|remove|send|upload|exfiltrate|append|copy|paste|push|disable|post|forward)`;
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
  // Redirecting the task away from what the user asked.
  p(
    String.raw`\b(?:ignore|disregard|forget)\s+(?:the\s+)?user(?:['’]s)?\s+(?:request|instructions?|question|task|prompt)\b`,
    'high',
  ),
  // Addressing an agent, then asking for an action later in the same line: "AI agents: ... run X".
  p(String.raw`\b${AGENT}\b[^\n:]{0,40}:[^\n]{0,160}?\b(?:please\s+)?${VERB}\b`, 'medium'),
  // An @-mention of an agent followed by an action, as in issue and pull request text.
  p(String.raw`@(?:claude|codex|copilot|gemini|cursor|devin)\b[^\n]{0,200}?\b${VERB}\b`, 'medium'),
  // Claimed approval that tells the agent not to check with anyone.
  p(
    String.raw`\bno\s+need\s+to\s+(?:confirm|ask|check)\s+with\s+(?:anyone|anybody|the\s+user|them)\b`,
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

const HIDDEN_STYLE =
  /<([a-z][a-z0-9]{0,10})\b[^>]{0,200}?style\s*=\s*["'][^"'>]{0,200}?(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?![.\d]*[1-9])|opacity\s*:\s*0(?![.\d]*[1-9]))[^>]{0,200}>([^<]{1,600})/gi;
const MAX_HIDDEN_ELEMENTS = 16;

/** Text inside HTML elements styled to be invisible, when it reads like an instruction. */
function scanHiddenHtml(text: string, list: SignalList): void {
  HIDDEN_STYLE.lastIndex = 0;
  let n = 0;
  for (
    let m = HIDDEN_STYLE.exec(text);
    m !== null && n < MAX_HIDDEN_ELEMENTS;
    m = HIDDEN_STYLE.exec(text)
  ) {
    n++;
    const body = m[2] ?? '';
    if (COMMENT_VERB.test(body) && (COMMENT_AGENT.test(body) || COMMENT_IMPERATIVE.test(body))) {
      list.add('hidden_text', `hidden HTML: ${body}`, 'high');
    }
  }
}

/** True when every character is printable ASCII, a tab, or a line break. */
function isPrintableText(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (!(c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126))) return false;
  }
  return true;
}

const BASE64_TOKEN = /[A-Za-z0-9+/]{24,2048}={0,2}/g;
const MAX_DECODED_TOKENS = 8;
const DECODED_COMMAND =
  /\b(?:curl|wget)\b[^\n]{0,200}\|\s*(?:ba|z|da)?sh\b|\b(?:ba)?sh\s+-c\s|\beval\s|\bnc\s+-|\brm\s+-rf\s|\bchmod\s+\+x\s/;

/**
 * Base64 strings that decode to a shell command or to instruction-like text:
 * a way to slip an instruction past a reader and past plain-text checks.
 */
function scanEncoded(text: string, list: SignalList): void {
  BASE64_TOKEN.lastIndex = 0;
  let n = 0;
  for (
    let m = BASE64_TOKEN.exec(text);
    m !== null && n < MAX_DECODED_TOKENS;
    m = BASE64_TOKEN.exec(text)
  ) {
    const token = m[0];
    if (token.length % 4 === 1) continue;
    n++;
    const decoded = Buffer.from(token, 'base64').toString('latin1');
    // Only printable text can be an instruction; hashes and keys decode to binary.
    if (!isPrintableText(decoded)) continue;
    // Fixed details: decoded text never went through redaction, so none of it is kept.
    if (DECODED_COMMAND.test(decoded)) {
      list.add('prompt_injection', 'base64 text that decodes to a shell command', 'high');
      continue;
    }
    const inner = new SignalList('data');
    scanPatterns(decoded, inner, '');
    if (inner.out.length > 0) {
      list.add('prompt_injection', 'base64 text that decodes to instruction-like text', 'high');
    }
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
  scanHiddenHtml(visible, list);
  scanEncoded(visible, list);
  if (hidden !== '') scanPatterns(hidden, list, 'hidden: ');
  return list.out;
}
