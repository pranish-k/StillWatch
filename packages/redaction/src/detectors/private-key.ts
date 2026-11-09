/**
 * Private key blocks: from a `-----BEGIN ... PRIVATE KEY-----` line through
 * the matching END line, or to the end of the text when there is none.
 *
 * A header alone (for example in parser source code) is not a key: the block
 * must contain a line of key material (40 base64 characters in a row) close
 * to the header.
 */
import type { Span, StringDetector } from './types';

const BEGIN =
  /-----BEGIN (?:(?:RSA |EC |DSA |OPENSSH |ENCRYPTED |ANY )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/g;
const KEY_MATERIAL = /[A-Za-z0-9+/=]{40}/;
const BODY_WINDOW = 400;
const END_MARK = '-----END ';
const END_LINE_MAX = 80;

function findPrivateKeys(text: string): Span[] {
  const spans: Span[] = [];
  const begin = new RegExp(BEGIN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = begin.exec(text)) !== null) {
    const start = match.index;
    const headerEnd = start + match[0].length;
    if (!KEY_MATERIAL.test(text.slice(headerEnd, headerEnd + BODY_WINDOW))) {
      begin.lastIndex = headerEnd;
      continue;
    }
    const endAt = text.indexOf(END_MARK, headerEnd);
    let end = text.length;
    if (endAt !== -1) {
      const close = text.indexOf('-----', endAt + END_MARK.length);
      if (close !== -1 && close - endAt <= END_LINE_MAX) {
        end = close + 5;
      } else {
        const newline = text.indexOf('\n', endAt);
        end = newline === -1 ? text.length : newline;
      }
    }
    spans.push({ start, end });
    if (end >= text.length) break;
    begin.lastIndex = end;
  }
  return spans;
}

/** Whole private key blocks (PEM, OpenSSH, PGP). */
export const privateKey: StringDetector = {
  info: {
    id: 'private-key',
    description: 'Private key block (PEM, OpenSSH, encrypted, PGP)',
    kind: 'structure',
  },
  applies: (text) => text.includes('-----BEGIN '),
  find: findPrivateKeys,
};
