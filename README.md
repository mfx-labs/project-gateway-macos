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
pgw help
pgw tunnel
pgw up
pgw start
pgw doctor
pgw project add <path>
pgw project list
pgw project remove <path-or-workspace-id>
pgw --version
```

`pgw add / list / remove` remain available as legacy top-level aliases for
`pgw project add / list / remove`.

| Command | Purpose |
| --- | --- |
| `pgw help` | Shows the canonical command surface. |
| `pgw tunnel` | One-time install/configure of the macOS tunnel workflow (pinned tunnel-client, profile, Keychain credential). |
| `pgw up` | Starts the configured tunnel + Gateway stack in the foreground (macOS). |
| `pgw start` | Starts the low-level Gateway stdio MCP runtime; verifies existing state; does not provision or repair the store. |
| `pgw doctor` | Performs a read-only readiness check. |
| `pgw project add <path>` | Registers a project and initializes its controlled local Gateway store. |
| `pgw project list` | Lists registered projects. |
| `pgw project remove <path-or-workspace-id>` | Deregisters a project while preserving its store/state. |

Normal tunnel users do not call `pgw start` directly; it is invoked as the MCP
child by the tunnel run. `pgw --version` prints version information.

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

## Tunnel workflow (macOS, manual foreground)

Project Gateway's local tunnel uses the upstream
[`openai/tunnel-client`](https://github.com/openai/tunnel-client) release in
front of `pgw start`. The supported macOS startup model is an interactive
Terminal running the tunnel in the foreground — no login item, no LaunchAgent,
no background service is installed.

### First-time PGW install

Install/configure `pgw` using the normal repository instructions
([Installation](#installation-v010)).

### Discover commands

```sh
pgw help
```

### First-time tunnel setup

One-time per machine. Installs the pinned `tunnel-client` binary, records your
tunnel identity in a tunnel-client profile, and stores your Runtime API Key in
the macOS Keychain.

1. create or select an OpenAI **Tunnel** in the OpenAI Platform.
2. create a **Runtime API Key** with the required Tunnels Read + Use permission
   (https://platform.openai.com/settings/organization/api-keys).
3. run:

   ```sh
   pgw tunnel
   ```

   You will be prompted for the tunnel ID and (if not already stored) the
   Runtime API Key. The key is entered with echoing hidden and is never
   printed or written to any file, profile, log, or shell history — it lives
   only in the macOS Keychain.

   Setup is safe to re-run: it skips installation, reuses an existing tunnel
   identity/profile, and reuses an existing Keychain credential.

### Normal use

Each foreground session:

```sh
pgw up
```

`pgw up` reads the tunnel identity and the Runtime API Key (from the macOS
Keychain) and launches the tunnel in the foreground
(`tunnel-client run --profile project-gateway`, which starts `pgw start`). It is
the canonical normal-use command and never installs or provisions anything.

If `pgw up` reports the tunnel is not configured, run `pgw tunnel` first.

### Low-level MCP runtime

Normal users do not need to invoke `pgw start` directly; tunnel-client starts it
as the MCP child during `pgw up`.

For repository discoverability / fallback, a thin wrapper is provided that
delegates to `pgw up`:

```sh
./scripts/start-project-gateway-macos.sh
```

### Stop

Press `Ctrl+C` in the Terminal running the tunnel.

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
