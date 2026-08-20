#!/usr/bin/env node
/**
 * S2/S3/S4 — operator CLI entry (`pgw`).
 *
 * Dispatches --version, add, list, remove (S2), start, doctor (S3), and
 * uninstall (S4). Bounded stderr diagnostics; stdout carries command results
 * only (and MCP protocol for `start`). No command framework or plugin system.
 */
import { versionInfo, formatVersion } from './version.js';
import { diagnostic } from './diagnostic.js';
import { addProject } from './add.js';
import { listProjects } from './list.js';
import { removeProject } from './remove.js';
import { runStart } from './start.js';
import { runDoctor } from './doctor.js';
import { uninstall } from './uninstall.js';

const USAGE = 'usage: pgw --version | pgw add <path> | pgw list | pgw remove <path-or-id> | pgw start | pgw doctor | pgw uninstall';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    diagnostic(USAGE);
    process.exitCode = 2;
    return;
  }
  const command = argv[0]!;
  switch (command) {
    case '--version': {
      if (argv.length !== 1) {
        diagnostic('usage: pgw --version');
        process.exitCode = 2;
        return;
      }
      process.stdout.write(`${formatVersion(versionInfo())}\n`);
      return;
    }
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
