/**
 * Hostile and awkward strings for the mock data. The dashboard must show all
 * of them as literal text. Secrets appear only as redaction markers.
 */

export const SCRIPT_TAG = '<script>alert("stillwatch")</script>';
export const IMG_TAG = '<img src=x onerror="alert(1)">';
export const MARKDOWN = '**bold** _em_ [click me](javascript:alert(1)) `code` # heading';
export const AWS_MARKER = '[REDACTED:aws-access-key-id:1a2b3c4d]';
export const GH_MARKER = '[REDACTED:github-token:9f8e7d6c]';
export const ENV_MARKER = '[REDACTED:env-assignment:0badc0de]';
export const TRUNCATED_MARKER = '[TRUNCATED:120 chars]';

export const LONG_PATH =
  '/Users/dev/code/checkout-service/packages/very-long-workspace-package-name/src/features/' +
  'payments/providers/internal/adapters/legacy/compat/v2/handlers/__generated__/' +
  'a-file-name-that-keeps-going-and-going-without-any-spaces-to-break-on.generated.test.tsx';

export const RTL_AND_ZERO_WIDTH = 'invoice‮txt.exe and zero​width';

export const HOSTILE_OUTPUT = [
  'Build log:',
  SCRIPT_TAG,
  IMG_TAG,
  '<iframe src="https://evil.example"></iframe>',
  MARKDOWN,
  `AWS_ACCESS_KEY_ID=${AWS_MARKER}`,
  `export GITHUB_TOKEN=${GH_MARKER}`,
  `Long line ${'x'.repeat(240)}${TRUNCATED_MARKER}`,
].join('\n');
