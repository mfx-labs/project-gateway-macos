/**
 * PS-1 — operator bootstrap command runner (`project-gateway-macos-mcp bootstrap`).
 *
 * Operator CLI behavior ONLY: loads the operator bootstrap configuration
 * (closed document; `configurationIdentity` may be absent and is then
 * derived), composes the genuine control-plane bootstrap action per surface
 * (provision or exact idempotent replay), and emits the resolved runtime
 * configuration — the exact document normal `project-gateway-macos-mcp --config`
 * startup accepts.
 *
 * This module NEVER starts the MCP server, never touches the MCP SDK, and
 * emits no MCP protocol data. Diagnostics go to bounded stderr; the
 * resolved configuration goes to `--output <file>` (atomic, 0600,
 * fail-closed on conflicting overwrite) or, when `--output` is omitted, to
 * stdout as a single JSON document (the documented minimal truthful
 * composition behavior). No provenance, capability, brand, or other
 * authority-bearing value is ever serialized.
 *
 * This module is intentionally OUTSIDE `src/runtime/mcp`: the runtime
 * static guards pin `src/runtime/mcp/**` to MCP-protocol-only stdout and
 * forbid storage mutation vocabulary there. Bootstrap mode is the operator
 * face of the trusted control plane, so it lives in its own area and
 * carries its own narrow fs discipline (bounded config read, atomic output
 * write) without weakening the runtime guards.
 */
import { dirname } from 'node:path';
import {
  closeSync, fchmodSync, fsyncSync, linkSync, openSync, readFileSync, unlinkSync, writeSync,
} from 'node:fs';
import { loadBootstrapConfig, type BootstrapSurfaceConfig } from '../runtime/mcp/config.js';
import { writeDiagnostic } from '../runtime/mcp/diagnostics.js';
import { createArtifactLocationResolver, createRootPathResolver } from '../runtime/mcp/lanes.js';
import { bootstrapStore, type StorageBootstrapActionInput } from '../control-plane/storage-bootstrap-action.js';
import type { TrustedHostLane } from '../trusted/index.js';

const BOOTSTRAP_USAGE =
  'usage: project-gateway-macos-mcp bootstrap --config <file> [--output <file>]\n';

/**
 * Low-level output write primitive (node:fs `writeSync` signature).
 * Injectable for focused short-write tests; production always uses
 * `writeSync`. This is a pure byte-writer primitive — no authority, no
 * path logic, no I/O capability beyond the byte write itself.
 */
export type OutputByteWriter = (fd: number, buffer: Buffer, offset: number, length: number) => number;

/**
 * Write the COMPLETE byte buffer to the descriptor (SIR-PS1-002).
 *
 * The final output path is NEVER published unless the complete intended
 * runtime-config byte sequence has been written: this function returns only
 * after every byte is on the descriptor (the publish step runs after it,
 * and after `fsyncSync`). Short writes are looped; zero-progress or
 * invalid progress is treated as an I/O failure and fails closed.
 */
function writeAllBytes(fd: number, bytes: Buffer, write: OutputByteWriter = writeSync): void {
  let written = 0;
  while (written < bytes.length) {
    const n = write(fd, bytes, written, bytes.length - written);
    if (n <= 0) {
      // Zero-progress or invalid progress: fail closed rather than risk
      // publishing a truncated document.
      throw Object.assign(new Error('output write made no progress'), { code: 'ESHORTWRITE' });
    }
    written += n;
  }
}

/** Strict bootstrap-mode argument shape; anything else fails closed. */
function parseBootstrapArgs(argv: readonly string[]): { readonly ok: true; readonly configPath: string; readonly outputPath?: string } | { readonly ok: false; readonly message: string } {
  if (argv.length === 2 && (argv[1] === '--help' || argv[1] === '-h')) {
    return { ok: false, message: BOOTSTRAP_USAGE };
  }
  if (argv.length === 3 && argv[1] === '--config') {
    const configPath = argv[2];
    if (configPath !== undefined && configPath.length > 0) return { ok: true, configPath };
  }
  if (argv.length === 5 && argv[1] === '--config' && argv[3] === '--output') {
    const configPath = argv[2];
    const outputPath = argv[4];
    if (configPath !== undefined && configPath.length > 0 && outputPath !== undefined && outputPath.length > 0) {
      return { ok: true, configPath, outputPath };
    }
  }
  return { ok: false, message: BOOTSTRAP_USAGE };
}

function buildActionInputs(surfaces: readonly BootstrapSurfaceConfig[], hostLane: TrustedHostLane): StorageBootstrapActionInput[] {
  return surfaces.map((surface) => ({
    surfaceId: surface.surfaceId,
    locator: surface.locator,
    serviceUid: surface.serviceUid,
    forbiddenRoots: surface.forbiddenRoots,
    configurationVersion: surface.configurationVersion,
    hostLane,
    ...(surface.configurationIdentity !== undefined ? { configurationIdentity: surface.configurationIdentity } : {}),
    limitProfile: surface.limitProfile,
    workspaces: (surface.workspaces ?? []).map((w) => ({
      workspaceId: w.workspaceId,
      root: w.root,
      ...(w.artifactLocation !== undefined ? { artifactLocation: w.artifactLocation } : {}),
    })),
    ...(surface.gitPath !== undefined ? { gitPath: surface.gitPath } : {}),
    ...(surface.gitHome !== undefined ? { gitHome: surface.gitHome } : {}),
    ...(surface.gitTmpdir !== undefined ? { gitTmpdir: surface.gitTmpdir } : {}),
    resolvers: {
      resolveRootPath: createRootPathResolver(),
      ...((surface.workspaces ?? []).some((w) => w.artifactLocation !== undefined)
        ? { resolveArtifactLocation: createArtifactLocationResolver() }
        : {}),
    },
  }));
}

/** Read an existing output file for the conflict check (identical bytes only). */
function readExisting(path: string, expected: Buffer): 'absent' | 'same' | 'different' | 'read-error' {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const buffer = readFileSync(fd);
    return buffer.equals(expected) ? 'same' : 'different';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
    return 'read-error';
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // best-effort close
      }
    }
  }
}

/**
 * Write the resolved runtime configuration atomically with exact mode 0600.
 * Existing-file semantics fail closed: identical bytes are an idempotent
 * no-op; any other existing content is a typed conflict and nothing is
 * written. The no-clobber guard is atomic (hard-link publish), not a
 * check-then-rename race.
 *
 * The optional `write` primitive is the narrowest testability seam for
 * deterministic short-write simulation (SIR-PS1-002); production always
 * uses `writeSync`. It widens no authority or I/O capability: the writer
 * can only consume bytes on an already-open descriptor.
 */
export function writeOutputFile(
  path: string,
  content: string,
  write: OutputByteWriter = writeSync,
): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string } {
  const bytes = Buffer.from(content, 'utf8');
  const existing = readExisting(path, bytes);
  if (existing === 'same') return { ok: true };
  if (existing === 'read-error') {
    return { ok: false, code: 'ERR-BOOT-OUTPUT-IO', message: 'output file could not be read for conflict check' };
  }
  const tmp = `${path}.tmp-${process.pid}`;
  let fd: number | undefined;
  try {
    fd = openSync(tmp, 'wx', 0o600);
    fchmodSync(fd, 0o600);
    writeAllBytes(fd, bytes, write);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    // Atomic no-clobber publish: link fails with EEXIST when the target
    // appeared since the conflict check (no overwrite is ever possible).
    linkSync(tmp, path);
    unlinkSync(tmp);
    const parent = openSync(dirname(path), 'r');
    try {
      fsyncSync(parent);
    } finally {
      closeSync(parent);
    }
    return { ok: true };
  } catch (err) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // best-effort close; the failure result stands
      }
    }
    try {
      unlinkSync(tmp);
    } catch {
      // best-effort cleanup; the failure result stands
    }
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      return { ok: false, code: 'ERR-BOOT-OUTPUT-CONFLICT', message: 'output file exists with different content; refusing to overwrite' };
    }
    return { ok: false, code: 'ERR-BOOT-OUTPUT-IO', message: `output file could not be written (${code ?? 'unknown error'})` };
  }
}

/**
 * Run the bootstrap command. Returns the process exit code:
 * 0 = success; 1 = operational failure (config/init/verify/output);
 * 2 = malformed operands. Never starts the MCP server.
 *
 * `hostLane` is the trusted host lane operand derived ONCE at the operator
 * CLI boundary (`src/runtime/mcp/cli.ts`) — the same derivation the runtime
 * start path uses, so bootstrap identity == start identity on one machine.
 */
export async function runBootstrapCommand(argv: readonly string[], hostLane: TrustedHostLane): Promise<number> {
  if (argv.length === 2 && (argv[1] === '--help' || argv[1] === '-h')) {
    process.stderr.write(BOOTSTRAP_USAGE);
    return 0;
  }
  const parsed = parseBootstrapArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(parsed.message);
    return 2;
  }
  const loaded = loadBootstrapConfig(parsed.configPath);
  if (!loaded.ok) {
    writeDiagnostic(`bootstrap: ${loaded.message}`);
    return 1;
  }
  if (loaded.config.surfaces.length === 0) {
    writeDiagnostic('bootstrap: the configuration declares no surfaces');
    return 1;
  }
  const inputs = buildActionInputs(loaded.config.surfaces, hostLane);
  const resolvedSurfaces = [];
  for (const input of inputs) {
    const result = bootstrapStore(input);
    if (!result.ok) {
      writeDiagnostic(`bootstrap: surface ${input.surfaceId} failed closed: ${result.code}: ${result.message}`);
      return 1;
    }
    resolvedSurfaces.push(result.resolved);
    writeDiagnostic(`bootstrap: surface ${input.surfaceId} INITIALIZED identity=${result.configurationIdentity}`);
  }
  const document = `${JSON.stringify({ surfaces: resolvedSurfaces }, null, 2)}\n`;
  if (parsed.outputPath !== undefined) {
    const written = writeOutputFile(parsed.outputPath, document);
    if (!written.ok) {
      writeDiagnostic(`bootstrap: ${written.code}: ${written.message}`);
      return 1;
    }
  } else {
    process.stdout.write(document);
  }
  return 0;
}
