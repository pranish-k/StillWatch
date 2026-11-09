/**
 * Detectors for secrets with a recognizable shape (vendor token prefixes,
 * JWTs, URL passwords, Authorization headers).
 *
 * Linear time: every pattern starts with a negative lookbehind over the same
 * characters its body consumes, so a match can only start at the beginning of
 * a run, and every quantifier is bounded. A failed attempt therefore costs at
 * most the bounded length of one run, and runs do not overlap.
 */
import { isPlaceholderValue } from '../secret-names';
import type { Span, StringDetector } from './types';

type PatternSpec = {
  id: string;
  description: string;
  /** Global regex. With a named group `s` (and the `d` flag), only that group is the secret. */
  regex: RegExp;
  /** Substrings of which at least one must occur (checked on the lowercase input when `lower`). */
  needles: string[];
  lower?: boolean;
  /** Extra check on the secret text. */
  accept?: (secret: string) => boolean;
};

function patternDetector(spec: PatternSpec): StringDetector {
  return {
    info: { id: spec.id, description: spec.description, kind: 'pattern' },
    applies(text, lower) {
      const haystack = spec.lower === true ? lower : text;
      return spec.needles.some((needle) => haystack.includes(needle));
    },
    find(text) {
      const spans: Span[] = [];
      for (const match of text.matchAll(spec.regex)) {
        const group = match.indices?.groups?.s;
        const start = group ? group[0] : match.index;
        const end = group ? group[1] : match.index + match[0].length;
        if (spec.accept && !spec.accept(text.slice(start, end))) continue;
        spans.push({ start, end });
      }
      return spans;
    },
  };
}

const notPlaceholder = (minLength: number) => (secret: string) =>
  !isPlaceholderValue(secret, { minLength });

/** AWS access key ids: a known 4-letter prefix and 16 uppercase alphanumerics. */
export const awsAccessKeyId = patternDetector({
  id: 'aws-access-key-id',
  description: 'AWS access key id (AKIA, ASIA, and other key prefixes)',
  regex:
    /(?<![A-Za-z0-9_])(?:AKIA|ASIA|ABIA|ACCA|AGPA|AIDA|AIPA|AKPA|ANPA|ANVA|APKA|AROA|ASCA)[A-Z0-9]{16}(?![A-Za-z0-9_])/g,
  needles: ['A'],
});

/** AWS secret access keys, recognized by the assignment they appear in. */
export const awsSecretAccessKey = patternDetector({
  id: 'aws-secret-access-key',
  description: 'AWS secret access key in an aws_secret_access_key assignment',
  regex:
    /(?<![A-Za-z0-9_])(?:aws_?)?secret_?access_?key["']?[ \t]{0,8}(?:=>|[:=])[ \t]{0,8}["']?(?<s>[A-Za-z0-9/+]{40})(?![A-Za-z0-9/+=])/dgi,
  needles: ['secret'],
  lower: true,
});

/** GitHub classic tokens (ghp_, gho_, ghu_, ghs_, ghr_) and fine-grained PATs. */
export const githubToken = patternDetector({
  id: 'github-token',
  description: 'GitHub token (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_)',
  regex:
    /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{36,251}|github_pat_[A-Za-z0-9_]{82,244})(?![A-Za-z0-9_])/g,
  needles: ['gh', 'github_pat_'],
});

/** GitLab personal access tokens. */
export const gitlabToken = patternDetector({
  id: 'gitlab-token',
  description: 'GitLab personal access token (glpat-)',
  regex: /(?<![A-Za-z0-9_-])glpat-[A-Za-z0-9_-]{20,255}(?![A-Za-z0-9_-])/g,
  needles: ['glpat-'],
});

/** Slack bot, user, app, and legacy tokens. */
export const slackToken = patternDetector({
  id: 'slack-token',
  description: 'Slack token (xoxa-, xoxb-, xoxp-, xoxo-, xoxs-, xoxr-)',
  regex: /(?<![A-Za-z0-9_-])xox[abposr]-[0-9]{1,20}-[A-Za-z0-9-]{8,250}(?![A-Za-z0-9_-])/g,
  needles: ['xox'],
});

/** Slack incoming webhook URLs; the host and route stay visible. */
export const slackWebhook = patternDetector({
  id: 'slack-webhook',
  description: 'Slack webhook URL path',
  regex:
    /https:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/(?<s>[A-Za-z0-9_/-]{20,255})/dg,
  needles: ['hooks.slack.com'],
});

/** Stripe secret and restricted keys. */
export const stripeKey = patternDetector({
  id: 'stripe-key',
  description: 'Stripe secret or restricted key (sk_live_, sk_test_, rk_live_, rk_test_)',
  regex: /(?<![A-Za-z0-9_])[sr]k_(?:live|test)_[A-Za-z0-9]{16,247}(?![A-Za-z0-9_])/g,
  needles: ['k_live_', 'k_test_'],
});

/** Anthropic API and admin keys. */
export const anthropicKey = patternDetector({
  id: 'anthropic-key',
  description: 'Anthropic API key (sk-ant-)',
  regex: /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{20,250}(?![A-Za-z0-9_-])/g,
  needles: ['sk-ant-'],
});

const OPENAI_SCOPED = /^sk-(?:proj|svcacct|admin)-/;

/** OpenAI project, service account, admin, and legacy keys. */
export const openaiKey = patternDetector({
  id: 'openai-key',
  description: 'OpenAI API key (sk-proj-, sk-svcacct-, sk-admin-, legacy sk-)',
  regex:
    /(?<![A-Za-z0-9_-])sk-(?:(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,250}|[A-Za-z0-9]{40,250})(?![A-Za-z0-9_-])/g,
  needles: ['sk-'],
  // Legacy keys embed the base64 of "OpenAI"; without it a long sk- string is not claimed.
  accept: (secret) => OPENAI_SCOPED.test(secret) || secret.includes('T3BlbkFJ'),
});

/** Google API keys. */
export const googleApiKey = patternDetector({
  id: 'google-api-key',
  description: 'Google API key (AIza)',
  regex: /(?<![A-Za-z0-9_-])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g,
  needles: ['AIza'],
});

/** npm access tokens. */
export const npmToken = patternDetector({
  id: 'npm-token',
  description: 'npm access token (npm_)',
  regex: /(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9_])/g,
  needles: ['npm_'],
});

/** PyPI API tokens (macaroons, which always start with AgE in base64). */
export const pypiToken = patternDetector({
  id: 'pypi-token',
  description: 'PyPI API token (pypi-AgE)',
  regex: /(?<![A-Za-z0-9_-])pypi-AgE[A-Za-z0-9_-]{50,1000}(?![A-Za-z0-9_-])/g,
  needles: ['pypi-'],
});

/** SendGrid API keys. */
export const sendgridKey = patternDetector({
  id: 'sendgrid-key',
  description: 'SendGrid API key (SG.)',
  regex: /(?<![A-Za-z0-9_-])SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g,
  needles: ['SG.'],
});

/** Twilio API key SIDs. */
export const twilioKey = patternDetector({
  id: 'twilio-key',
  description: 'Twilio API key (SK and 32 hex characters)',
  regex: /(?<![A-Za-z0-9_])SK[0-9a-f]{32}(?![A-Za-z0-9_])/g,
  needles: ['SK'],
});

/** Shopify access tokens. */
export const shopifyToken = patternDetector({
  id: 'shopify-token',
  description: 'Shopify token (shpat_, shpca_, shppa_, shpss_)',
  regex: /(?<![A-Za-z0-9_])shp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}(?![A-Za-z0-9_])/g,
  needles: ['shp'],
});

/** JSON Web Tokens: three base64url segments, the first two JSON objects. */
export const jwt = patternDetector({
  id: 'jwt',
  description: 'JSON Web Token (eyJ... . eyJ... . signature)',
  regex:
    /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,8192}\.eyJ[A-Za-z0-9_-]{5,8192}\.[A-Za-z0-9_-]{0,8192}(?![A-Za-z0-9_-])/g,
  needles: ['eyJ'],
});

/** Passwords in scheme://user:password@host URLs; the rest of the URL stays. */
export const urlCredentials = patternDetector({
  id: 'url-credentials',
  description: 'Password in a scheme://user:password@host URL',
  regex:
    /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]{0,30}:\/\/[^\s:/?#@"'<>[\]]{0,256}:(?<s>[^\s/?#@"'<>]{1,256})@/dg,
  needles: ['://'],
  accept: notPlaceholder(1),
});

/** Credentials after Authorization: Bearer/Basic/Token, also inside curl -H strings. */
export const authorizationHeader = patternDetector({
  id: 'authorization-header',
  description: 'Credential in an Authorization header (Bearer, Basic, Token)',
  regex:
    /(?<![A-Za-z0-9_-])(?:proxy-)?authorization["']?[ \t]{0,4}[:=][ \t]{0,4}["']?(?:bearer|basic|token|digest|bot)[ \t]{1,4}(?<s>[A-Za-z0-9._~+/=-]{8,8192})/dgi,
  needles: ['authorization'],
  lower: true,
  accept: notPlaceholder(8),
});
