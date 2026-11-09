/**
 * Security headers sent on every response, and the fixed API response headers.
 */
import type { ServerResponse } from 'node:http';

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Browser features the dashboard never needs. */
const DENIED_FEATURES = [
  'accelerometer',
  'autoplay',
  'camera',
  'display-capture',
  'encrypted-media',
  'geolocation',
  'gyroscope',
  'hid',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'publickey-credentials-get',
  'screen-wake-lock',
  'serial',
  'usb',
  'xr-spatial-tracking',
] as const;

export const PERMISSIONS_POLICY = DENIED_FEATURES.map((feature) => `${feature}=()`).join(', ');

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': PERMISSIONS_POLICY,
};

export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
export const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';
export const NO_STORE = 'no-store';

/** Sets the security headers. Call first for every request. */
export function applySecurityHeaders(res: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
}

/** Security headers as raw HTTP header lines, for responses written to a bare socket. */
export function securityHeaderLines(): string {
  return Object.entries(SECURITY_HEADERS)
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join('');
}
