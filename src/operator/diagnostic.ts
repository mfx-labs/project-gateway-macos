/**
 * S2/S3 — bounded operator stderr diagnostics.
 *
 * All human diagnostics go to stderr (never stdout); single-line and bounded.
 */
const MAX_DIAGNOSTIC_LENGTH = 2048;

export function diagnostic(message: string): void {
  const bounded = message.length > MAX_DIAGNOSTIC_LENGTH ? `${message.slice(0, MAX_DIAGNOSTIC_LENGTH)}…(truncated)` : message;
  process.stderr.write(`pgw: ${bounded.replace(/[\r\n]+/g, ' ')}\n`);
}
