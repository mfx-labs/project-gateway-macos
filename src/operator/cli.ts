#!/usr/bin/env node
/**
 * S2 — operator CLI entry (`pgw`).
 *
 * Dispatches the S2 surface only: `--version`, `add`, `list`, `remove`.
 * `start` / `doctor` / `uninstall` are recognized but not implemented in this
 * build (S3/S4). Bounded stderr diagnostics; stdout carries command results
 * only. No command framework or plugin system.
 */
import { versionInfo, formatVersion } from './version.js';
import { addProject } from './add.js';
import { listProjects } from './list.js';
import { removeProject } from './remove.js';

const USAGE = 'usage: pgw --version | pgw add <path> | pgw list | pgw remove <path-or-id>';

function diagnostic(message: string): void {
  const bounded = message.length > 2048 ? `${message.slice(0, 2048)}…(truncated)` : message;
  process.stderr.write(`pgw: ${bounded.replace(/[\r\n]+/g, ' ')}\n`);
}

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    diagnostic(USAGE);
    return 2;
  }
  const command = argv[0]!;
  switch (command) {
    case '--version': {
      if (argv.length !== 1) {
        diagnostic('usage: pgw --version');
        return 2;
      }
      process.stdout.write(`${formatVersion(versionInfo())}\n`);
      return 0;
    }
    case 'add': {
      if (argv.length !== 2) {
        diagnostic('usage: pgw add <path>');
        return 2;
      }
      const result = addProject({ path: argv[1]! });
      if (!result.ok) {
        diagnostic(`add: ${result.message}`);
        return 1;
      }
      process.stdout.write(result.alreadyRegistered ? `already registered ${result.id} ${result.path}\n` : `added ${result.id} ${result.path}\n`);
      return 0;
    }
    case 'list': {
      if (argv.length !== 1) {
        diagnostic('usage: pgw list');
        return 2;
      }
      const result = listProjects();
      if (!result.ok) {
        diagnostic(`list: ${result.message}`);
        return 1;
      }
      for (const project of result.projects) process.stdout.write(`${project.id} ${project.path}\n`);
      return 0;
    }
    case 'remove': {
      if (argv.length !== 2) {
        diagnostic('usage: pgw remove <path-or-id>');
        return 2;
      }
      const result = removeProject({ selector: argv[1]! });
      if (!result.ok) {
        diagnostic(`remove: ${result.message}`);
        return 1;
      }
      process.stdout.write(`removed ${result.removedId}\n`);
      return 0;
    }
    case 'start':
    case 'doctor':
    case 'uninstall':
      diagnostic(`${command} is not implemented in this build`);
      return 1;
    default:
      diagnostic(`unknown command: ${command}`);
      return 2;
  }
}

process.exit(main());
