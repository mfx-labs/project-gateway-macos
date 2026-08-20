# Project Gateway for macOS

Project Gateway for macOS is a local, standalone gateway that exposes explicitly
registered project workspaces through a constrained MCP artifact interface. It is a
standalone macOS distribution with its own operator CLI.

## The `pgw` operator

`pgw` manages local project registration, readiness verification, runtime startup,
and application uninstall. It ships as an architecture-specific standalone
distribution and runs only on macOS.

**What Project Gateway macOS is not:**

- a generic filesystem MCP
- a shell-execution MCP
- a generic Git-automation MCP
- an authority self-approval mechanism
- a package manager
- a daemon

Model-accessible MCP tools do **not** grant unrestricted local filesystem authority.
Gateway operations are constrained to the accepted artifact model, and projects must
be explicitly registered before they are exposed.

## Closed operator surface

```
pgw --version
pgw add <path>
pgw list
pgw remove <path-or-id>
pgw doctor
pgw start
pgw uninstall
```

| Command | Purpose |
| --- | --- |
| `pgw add <path>` | Registers a project and initializes its controlled local Gateway store. |
| `pgw list` | Lists registered projects. |
| `pgw remove <path-or-id>` | Deregisters a project while preserving its store/state. |
| `pgw doctor` | Performs a read-only readiness check. |
| `pgw start` | Launches the stdio MCP runtime; verifies existing state; does not provision or repair the store. |
| `pgw uninstall` | Removes the installed runtime/link; preserves registry, project state, stores. |

There is no `pgw install` command; installation is performed by the standalone
installer script described below.

## Requirements

- macOS
- Node.js >= 22
- Git >= 2.30

### Architectures and validation status

| Lane | v0.1.0 status |
| --- | --- |
| macOS Intel x86_64 | Physical reboot acceptance passed |
| macOS Apple Silicon arm64 | Packaging/static validation passed; physical execution not performed |

Intel x86_64 was physically validated through installation, project registration, a
physical reboot, post-reboot `doctor`, post-reboot `start`, MCP initialization, and
uninstall. Apple Silicon arm64 was **not** physically executed for v0.1.0.

## Installation (v0.1.0)

Download the artifacts for your architecture from the
[v0.1.0 release](https://github.com/mfx-labs/project-gateway-macos/releases/tag/v0.1.0):

```
project-gateway-macos-0.1.0-darwin-x64.tar.gz        (+ .sha256)
project-gateway-macos-0.1.0-darwin-arm64.tar.gz      (+ .sha256)
```

The standalone installer is `scripts/install.mjs`. The four published release assets
are the two tarballs and two SHA-256 sidecars; the installer is obtained from a
checkout of the `v0.1.0` tag:

```sh
git clone --branch v0.1.0 --depth 1 \
  https://github.com/mfx-labs/project-gateway-macos.git

cd project-gateway-macos

# Download the matching tarball + .sha256 from the v0.1.0 release, then:

node scripts/install.mjs \
  /path/to/project-gateway-macos-0.1.0-darwin-x64.tar.gz \
  /path/to/project-gateway-macos-0.1.0-darwin-x64.tar.gz.sha256
```

For Apple Silicon, substitute the `-darwin-arm64-` tarball and sidecar. Verify the
tarball SHA-256 against its sidecar before use.

### Install and state layout

| Item | Path |
| --- | --- |
| Runtime | `~/.local/share/project-gateway-macos/current/` |
| Operator | `~/.local/bin/pgw` |
| Registry | `~/.config/project-gateway-macos/registry.json` |
| State | `~/.local/state/project-gateway-macos/` |

You may need to add `~/.local/bin` to your `PATH`.

## Quick start

```sh
pgw --version

pgw add ~/Documents/my-project

pgw list

pgw doctor

pgw start
```

`pgw start` is a stdio MCP server process, so it is normally launched by an MCP
client/transport integration rather than used as an interactive shell command.

## MCP surface

The runtime exposes exactly nine MCP tools:

- `draft-artifact`
- `enumerate-class`
- `inspect-audit-history`
- `inspect-changes`
- `inspect-registry`
- `inspect-stored-record`
- `persist-artifact`
- `validate-artifact`
- `verify-record`

There is no generic shell, filesystem-write, or arbitrary Git-execution tool, and no
approval/issue/activate/execute tool.

## Safety and trust boundary

- Projects must be explicitly registered before any Gateway operation applies.
- Operations are constrained to the accepted artifact model.
- `pgw doctor` and startup verification fail closed.
- `pgw start` does not silently repair or provision missing stores.
- Model-accessible MCP tools cannot approve, issue, or activate their own authority.

## Uninstall

```sh
pgw uninstall
```

**Removed:** the installed runtime and the canonical Gateway `pgw` link.

**Preserved:** the project registry, Gateway state, initialized stores, and project
files.

`pgw remove` is separate from uninstall: it deregisters a single project while
preserving its store/state.

## Documentation

- [Operator CLI & installer spec](docs/specs/operator-cli-and-installer-spec.md)
- [Operator runbook](docs/operations/project-gateway-operator-runbook.md)
- [Physical reboot acceptance summary](docs/reports/physical-reboot-acceptance-summary.md)
- [Releases](https://github.com/mfx-labs/project-gateway-macos/releases)

## License

[MIT](LICENSE)
