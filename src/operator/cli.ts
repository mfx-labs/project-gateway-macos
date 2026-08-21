#!/usr/bin/env node
/**
 * S2/S3/S4 — operator CLI entry (`pgw`).
 *
 * Dispatches the canonical user-facing command surface:
 *
 *   help | tunnel | up | start | doctor | project add|list|remove | --version
 *
 * plus the legacy-compatible top-level add/list/remove, and uninstall.
 * Bounded stderr diagnostics; stdout carries command results only (and MCP
 * protocol for `start`). No command framework or plugin system.
 *
 * Unless otherwise covered, unknown invocations (`--help`, `-h`, typos) fall
 * through to the default unsupported-command branch.
 */
import { versionInfo, formatVersion } from './version.js';
import { diagnostic } from './diagnostic.js';
import { addProject } from './add.js';
import { listProjects } from './list.js';
import { removeProject } from './remove.js';
import { runStart } from './start.js';
import { runUp } from './up.js';
import { runTunnel } from './tunnel.js';
import { runDoctor } from './doctor.js';
import { uninstall } from './uninstall.js';

const USAGE = 'usage: pgw <command> [operands] | pgw --version';

const HELP = `Project Gateway for macOS operator.

usage: pgw <command> [operands]

commands:
  help
      show available commands

  tunnel
      install/configure the macOS tunnel workflow (one-time)

  up
      start the configured tunnel + Gateway stack in the foreground

  start
      start the low-level Gateway stdio MCP runtime

  doctor
      verify installation/runtime state

  project add <path>
      register a project

  project list
      list registered projects

  project remove <path-or-workspace-id>
      deregister a project without deleting trusted state

options:
  --version
      print version information

Normal macOS tunnel flow:
  once:   pgw tunnel
  use:    pgw up       (foreground; Ctrl+C to stop)
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    diagnostic(USAGE);
    process.exitCode = 2;
    return;
  }
  const command = argv[0]!;
  switch (command) {
    case 'help': {
      if (argv.length !== 1) {
        diagnostic('usage: pgw help');
        process.exitCode = 2;
        return;
      }
      process.stdout.write(HELP);
      return;
    }
    case '--version': {
      if (argv.length !== 1) {
        diagnostic('usage: pgw --version');
        process.exitCode = 2;
        return;
      }
      process.stdout.write(`${formatVersion(versionInfo())}\n`);
      return;
    }
    case 'project': {
      const sub = argv[1];
      switch (sub) {
        case 'add': {
          if (argv.length !== 3) {
            diagnostic('usage: pgw project add <path>');
            process.exitCode = 2;
            return;
          }
          const result = addProject({ path: argv[2]! });
          if (!result.ok) {
            diagnostic(`add: ${result.message}`);
            process.exitCode = 1;
            return;
          }
          process.stdout.write(result.alreadyRegistered ? `already registered ${result.id} ${result.path}\n` : `added ${result.id} ${result.path}\n`);
          return;
        }
        case 'list': {
          if (argv.length !== 2) {
            diagnostic('usage: pgw project list');
            process.exitCode = 2;
            return;
          }
          const result = listProjects();
          if (!result.ok) {
            diagnostic(`list: ${result.message}`);
            process.exitCode = 1;
            return;
          }
          for (const project of result.projects) process.stdout.write(`${project.id} ${project.path}\n`);
          return;
        }
        case 'remove': {
          if (argv.length !== 3) {
            diagnostic('usage: pgw project remove <path-or-workspace-id>');
            process.exitCode = 2;
            return;
          }
          const result = removeProject({ selector: argv[2]! });
          if (!result.ok) {
            diagnostic(`remove: ${result.message}`);
            process.exitCode = 1;
            return;
          }
          process.stdout.write(`removed ${result.removedId}\n`);
          return;
        }
        default:
          diagnostic('usage: pgw project <add <path> | list | remove <path-or-workspace-id>>');
          process.exitCode = 2;
          return;
      }
    }
    // Legacy-compatible top-level project commands (canonical under `project`).
    case 'add': {
      if (argv.length !== 2) {
        diagnostic('usage: pgw add <path>');
        process.exitCode = 2;
        return;
      }
      const result = addProject({ path: argv[1]! });
      if (!result.ok) {
        diagnostic(`add: ${result.message}`);
        process.exitCode = 1;
        return;
      }
      process.stdout.write(result.alreadyRegistered ? `already registered ${result.id} ${result.path}\n` : `added ${result.id} ${result.path}\n`);
      return;
    }
    case 'list': {
      if (argv.length !== 1) {
        diagnostic('usage: pgw list');
        process.exitCode = 2;
        return;
      }
      const result = listProjects();
      if (!result.ok) {
        diagnostic(`list: ${result.message}`);
        process.exitCode = 1;
        return;
      }
      for (const project of result.projects) process.stdout.write(`${project.id} ${project.path}\n`);
      return;
    }
    case 'remove': {
      if (argv.length !== 2) {
        diagnostic('usage: pgw remove <path-or-id>');
        process.exitCode = 2;
        return;
      }
      const result = removeProject({ selector: argv[1]! });
      if (!result.ok) {
        diagnostic(`remove: ${result.message}`);
        process.exitCode = 1;
        return;
      }
      process.stdout.write(`removed ${result.removedId}\n`);
      return;
    }
    case 'start': {
      if (argv.length !== 1) {
        diagnostic('usage: pgw start');
        process.exitCode = 2;
        return;
      }
      await runStart();
      return;
    }
    case 'up': {
      if (argv.length !== 1) {
        diagnostic('usage: pgw up');
        process.exitCode = 2;
        return;
      }
      process.exitCode = await runUp();
      return;
    }
    case 'tunnel': {
      if (argv.length !== 1) {
        diagnostic('usage: pgw tunnel');
        process.exitCode = 2;
        return;
      }
      process.exitCode = await runTunnel();
      return;
    }
    case 'doctor': {
      if (argv.length !== 1) {
        diagnostic('usage: pgw doctor');
        process.exitCode = 2;
        return;
      }
      process.exitCode = await runDoctor();
      return;
    }
    case 'uninstall': {
      if (argv.length !== 1) {
        diagnostic('usage: pgw uninstall');
        process.exitCode = 2;
        return;
      }
      const result = uninstall();
      if (!result.ok) {
        diagnostic(`uninstall: ${result.message}`);
        process.exitCode = 1;
        return;
      }
      if (result.preservedBinLink) {
        diagnostic('uninstall: kept ~/.local/bin/pgw (not the Gateway-owned symlink)');
      }
      process.stdout.write('uninstalled (registry and project state preserved)\n');
      return;
    }
    default:
      diagnostic(`unknown command: ${command}`);
      process.exitCode = 2;
      return;
  }
}

await main();
