/**
 * WP-9 Slice 5 — bounded stderr diagnostics for the stdio MCP runtime.
 *
 * STDOUT IS MCP PROTOCOL ONLY. All operational diagnostics go to stderr,
 * bounded and redacted: never raw artifact content, trusted bootstrap
 * objects, capabilities, full cursors, storage payloads, or stack traces
 * in normal operator-facing messages.
 */
const MAX_DIAGNOSTIC_LENGTH = 2048;

/** Write one bounded, single-line diagnostic to stderr. */
export function writeDiagnostic(message: string): void {
  const bounded = message.length > MAX_DIAGNOSTIC_LENGTH ? `${message.slice(0, MAX_DIAGNOSTIC_LENGTH)}…(truncated)` : message;
  const singleLine = bounded.replace(/[\r\n]+/g, ' ');
  process.stderr.write(`project-gateway-macos-mcp: ${singleLine}\n`);
}
