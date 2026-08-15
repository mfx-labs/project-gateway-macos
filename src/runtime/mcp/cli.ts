#!/usr/bin/env node
/**
 * WP-9 Slice 5 / WP-10 Slice 3 — local stdio MCP runtime CLI
 * (project-gateway-macos-mcp).
 *
 * Trusted composition root: loads the operator-owned startup configuration
 * (--config), reconstructs genuine trusted registrations through the
 * private/trusted composition pipeline, builds the committed host-owned
 * inspection, drafting, persistence, and changed-context registries (one
 * shared SchemaRegistry instance per logical surface), and serves the six
 * WP-9 read-only inspection tools, the one WP-10 `draft-artifact` tool,
 * and the two WP-14A tools (`persist-artifact`, `inspect-changes`) over
 * stdio MCP through the official SDK's `serveStdio` entry (which owns
 * protocol negotiation/framing for the modern 2026-07-28 protocol
 * generation and SDK-managed legacy compatibility).
 *
 * STDOUT IS MCP PROTOCOL ONLY — no banners, no stdout logging. All operational
 * diagnostics go to bounded stderr.
 *
 * PS-1 operator bootstrap verb (`project-gateway-macos-mcp bootstrap`): operator
 * CLI behavior only, dispatched before the MCP path and never entering the
 * server; loads the operator bootstrap configuration, provisions or
 * replay-verifies the trusted store through the trusted control-plane
 * bootstrap action, and emits the resolved runtime configuration (see
 * `src/bootstrap/run.ts`). Bootstrap mode emits no MCP protocol data.
 *
 * The OpenAI Secure MCP Tunnel, ChatGPT connector configuration, and all
 * tunnel protocol work are NOT part of this CLI (WP-14 owns that
 * integration); the local CLI is the command an external tunnel client will launch.
 */
import { readFileSync } from 'node:fs';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadRuntimeConfig } from './config.js';
import { composeTrustedRegistry } from './compose.js';
import { createMcpServer } from './server.js';
import { writeDiagnostic } from './diagnostics.js';
import { runBootstrapCommand } from '../../bootstrap/run.js';
import { trustedHostLaneForPlatformArch } from '../../trusted/index.js';
import type { TrustedHostLane } from '../../trusted/index.js';

const USAGE = 'usage: project-gateway-macos-mcp --config <file>\n       project-gateway-macos-mcp bootstrap --config <file> [--output <file>]\n';

interface CliArgs {
  readonly configPath: string;
}

/**
 * Strict runtime-mode parse: `--config <file>` exactly. The bootstrap verb
 * is dispatched BEFORE this parser (first argument `bootstrap`), so the two
 * modes are structurally mutually exclusive: runtime mode can never accept
 * `bootstrap`, and bootstrap mode can never reach the MCP server path.
 */
function parseArgs(argv: readonly string[]): { readonly ok: true; readonly args: CliArgs } | { readonly ok: false; readonly message: string } {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    process.stderr.write(USAGE);
    process.exit(0);
  }
  if (argv.length !== 2 || argv[0] !== '--config') {
    return { ok: false, message: USAGE };
  }
  const rawPath = argv[1];
  if (rawPath === undefined || rawPath.length === 0) return { ok: false, message: USAGE };
  return { ok: true, args: { configPath: rawPath } };
}

function packageIdentity(): { readonly name: string; readonly version: string } {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { readonly name?: string; readonly version?: string };
    return { name: pkg.name ?? 'project-gateway-macos-mcp', version: pkg.version ?? '0.0.0' };
  } catch {
    return { name: 'project-gateway-macos-mcp', version: '0.0.0' };
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // Hygiene first: usage/help work on any platform.
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    process.stderr.write(USAGE);
    process.exit(0);
  }
  // Trusted host lane — the ONE derivation at the operator CLI boundary,
  // shared by the bootstrap path and the runtime/start path (PS-6). The
  // I/O-free trusted core never probes the host itself; the pure mapping
  // consumes this boundary's single host observation. Unsupported hosts
  // (Linux, Windows, unknown platforms/architectures) fail closed with
  // exit 2 before any validation, composition, or server startup.
  const hostLane = trustedHostLaneForPlatformArch(process.platform, process.arch);
  if (hostLane === null) {
    process.stderr.write(`project-gateway-macos-mcp: unsupported host lane (${process.platform} ${process.arch}); supported: darwin-arm64, darwin-x86_64\n`);
    process.exit(2);
  }
  // Operator-only bootstrap verb: never enters the MCP server path.
  if (argv[0] === 'bootstrap') {
    process.exit(await runBootstrapCommand(argv, hostLane));
  }
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(parsed.message);
    process.exit(2);
  }
  const loaded = loadRuntimeConfig(parsed.args.configPath);
  if (!loaded.ok) {
    writeDiagnostic(loaded.message);
    process.exit(1);
  }
  const composed = await composeTrustedRegistry(loaded.config, {}, hostLane);
  if (!composed.ok) {
    writeDiagnostic(composed.message);
    process.exit(1);
  }
  const identity = packageIdentity();
  const server = createMcpServer(composed.registry, composed.draftingRegistry, composed.persistRegistry, composed.changesRegistry, identity);
  // The SDK owns the stdio transport, the era decision (modern 2026-07-28
  // opening plus SDK-managed legacy compatibility), framing, and shutdown on
  // EOF. No manual JSON-RPC parsing/writing; no session state; no listener.
  serveStdio(() => server, {
    onerror: (error) => writeDiagnostic(`runtime error: ${error.message}`),
  });
}

main();
