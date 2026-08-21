# Project Gateway for macOS

Project Gateway connects ChatGPT to project folders you choose on your Mac,
through a controlled local gateway. You decide which projects to register, and
Project Gateway limits what it can do to a small, controlled set of operations.

It runs on your Mac, in the foreground, under your control. You start it when
you want to use it and stop it with `Ctrl+C`.

## Quick start

First-time setup (once):

```sh
pgw tunnel
pgw project add ~/Documents/MyProject
```

Normal use:

```sh
pgw up
```

**Stop:** press `Ctrl+C`.

That's the whole daily loop. Everything below explains each step in a little
more detail.

## What you need

- **A Mac** running macOS.
- **`pgw` installed** — the Project Gateway command-line tool (see
  [Install pgw](#install-pgw)).
- **Node.js ≥ 22** — required to run the installer script.
- **A Tunnel ID** — created in the OpenAI Platform (see below).
- **A Runtime API Key** with the tunnel permissions it needs — created in the
  OpenAI Platform.
- **Terminal access** — `pgw` is a command-line tool that runs in the
  foreground.

You create the Tunnel and the Runtime API Key once, on the OpenAI Platform.
Project Gateway saves the tunnel configuration for later use, and stores your
Runtime API Key securely in the macOS Keychain.

## Install pgw

There is no `pgw install` command. Install with the one-command bootstrap
installer below and nothing to fill in.

**One command.** Paste this into a Terminal:

```sh
(
  tmp="$(mktemp "${TMPDIR:-/tmp}/pgw-install.XXXXXX")" &&
  trap 'rm -f "$tmp"' EXIT &&
  curl -fsSL \
    https://raw.githubusercontent.com/mfx-labs/project-gateway-macos/main/install.sh \
    -o "$tmp" &&
  [ -s "$tmp" ] &&
  bash "$tmp"
)
```

The installer resolves the current stable release, detects your Mac's
architecture, downloads the matching checksummed release payload, verifies
it, and installs the `pgw` command. The command stays the same for every
release — you never need to change it when a new version is published.

After installing, check it works:

```sh
pgw --version
pgw help
```

You may need to add `~/.local/bin` to your `PATH` — the installer tells you
if so.

Next, set up the tunnel once:

```sh
pgw tunnel
pgw project add ~/Documents/MyProject
```

Then see [Set up the tunnel](#set-up-the-tunnel-once) below.

### Manual install (advanced / fallback)

Most people don't need this — the one-command install above is the supported
path. If you prefer to install from a source checkout, clone the `v0.2.0`
tag, detect your architecture, download the matching release tarball and its
SHA-256 sidecar, and run the standalone installer:

```sh
git clone --branch v0.2.0 --depth 1 \
  https://github.com/mfx-labs/project-gateway-macos.git
cd project-gateway-macos

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) PLATFORM="x64" ;;
  arm64)  PLATFORM="arm64" ;;
  *) echo "unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

BASE="https://github.com/mfx-labs/project-gateway-macos/releases/download/v0.2.0"
TARBALL="project-gateway-macos-0.2.0-darwin-${PLATFORM}.tar.gz"
curl -fL -o "$TARBALL"        "$BASE/$TARBALL"
curl -fL -o "$TARBALL.sha256" "$BASE/$TARBALL.sha256"

node scripts/install.mjs "$PWD/$TARBALL" "$PWD/$TARBALL.sha256"
```

The installer verifies the tarball against its SHA-256 sidecar before
installing.

## Set up the tunnel (once)

Run:

```sh
pgw tunnel
```

You normally run this **once per machine**. `pgw tunnel`:

- checks that your system is a supported macOS / architecture;
- installs (or reuses) the pinned `tunnel-client`;
- configures the `project-gateway` tunnel profile;
- accepts and validates your Tunnel ID;
- stores (or reuses) your Runtime API Key in the macOS Keychain;
- verifies the result.

Before you run it, create these on the OpenAI Platform:

1. A **Tunnel** (OpenAI Platform → Tunnels).
2. A **Runtime API Key** with the required **Tunnels Read + Use** permission:
   <https://platform.openai.com/settings/organization/api-keys>.

The command will ask you for the Tunnel ID and, if it isn't already stored,
the Runtime API Key. The key is entered with echoing hidden. It is persisted
only in the macOS Keychain — it is not stored in the repository, in the tunnel
profile as a literal secret, or in logs.

Rerunning `pgw tunnel` is safe: it skips what's already installed, reuses your
tunnel identity, and reuses an existing Keychain credential.

## Register a project

Register the folders you want Project Gateway to work with:

```sh
pgw project add ~/Documents/MyProject
```

See what's registered:

```sh
pgw project list
```

A few notes:

- Your tunnel identity and your project registry are **separate things**. The
  tunnel connects ChatGPT to Project Gateway; the registry is the list of
  project folders Project Gateway is allowed to work with.
- Project operations are scoped to projects you explicitly register. Project
  Gateway does **not** expose your whole Mac.
- The workspace ID shown by some commands is an internal operational
  identifier. Normal users don't need it for tunnel setup or for `pgw up`.

## Start Project Gateway

```sh
pgw up
```

One command starts the configured tunnel and the Project Gateway stack in the
foreground on your Mac.

- Keep the Terminal window open while you're using Project Gateway.
- Press `Ctrl+C` to stop.

For normal use you do not need to run `tunnel-client` or `pgw start` manually —
`pgw up` handles all of that for you.

## Day to day

After first-time setup, normal use is simply:

```sh
pgw up
```

Add another project only when you need it:

```sh
pgw project add ~/Documents/AnotherProject
```

See your current projects:

```sh
pgw project list
```

**Stop:** press `Ctrl+C`.

## Command cheat sheet

| Command | What it does |
| --- | --- |
| `pgw help` | Show the available commands. |
| `pgw tunnel` | One-time tunnel setup (install/reuse tunnel-client, profile, Keychain credential). |
| `pgw up` | Start the complete configured Gateway stack in the foreground. |
| `pgw project add <path>` | Register a project. |
| `pgw project list` | List registered projects. |
| `pgw project remove <path-or-workspace-id>` | Deregister a project. |
| `pgw doctor` | Check your installation / runtime state. |
| `pgw start` | Low-level MCP stdio runtime; normally not run manually for tunnel use. |
| `pgw --version` | Show the installed version. |

`pgw add`, `pgw list`, and `pgw remove` also still work as shortcuts for their
`pgw project …` forms, but `pgw project …` is the documented workflow.

## How it works

At a high level:

```text
ChatGPT
   |
   v
secure tunnel
   |
   v
Project Gateway on your Mac
   |
   v
registered projects
```

In more detail, one `pgw up` session looks like this:

```text
pgw up
  -> tunnel-client
       -> pgw start
```

- `pgw up` is the orchestration — it sets up the tunnel connection for the
  session.
- `pgw start` is the low-level MCP runtime that Project Gateway actually uses
  to serve the registered projects over that connection.

There is no background service or always-on daemon. Project Gateway runs only
when you run `pgw up`, and it stops when you press `Ctrl+C`.

## Security at a glance

- **You choose what Project Gateway can touch.** Project-facing operations are
  scoped to projects you explicitly register, performed through a constrained
  set of operations — Project Gateway is not a general file, shell, or
  Git-automation tool.
- **Your Runtime API Key is stored in the macOS Keychain.** It is persisted in
  the Keychain, not stored literally in your tunnel profile or the repository,
  and it is never printed.
- **The tunnel client is pinned and verified.** `tunnel-client` is pinned to a
  specific version and its checksum is verified before it is installed.
- **Runs in the foreground, under your control.** No LaunchAgent or autostart
  is installed by this workflow; `Ctrl+C` stops the running session.

For deeper detail, see the [Advanced / engineering](#advanced--engineering)
section and the linked documentation below.

## Troubleshooting

**"`pgw up` says tunnel setup is incomplete."**

Run the one-time setup again — it's safe and idempotent:

```sh
pgw tunnel
```

**"My project isn't available."**

Check what's registered:

```sh
pgw project list
```

If it's missing, register it:

```sh
pgw project add <path>
```

**"I want to verify my installation."**

```sh
pgw doctor
```

**"I want to stop Project Gateway."**

Press `Ctrl+C` in the Terminal running `pgw up`.

**"`pgw tunnel` is asking for a Tunnel ID / Runtime API Key."**

These come from the OpenAI Platform. Create (or open) a Tunnel, and create a
Runtime API Key with **Tunnels Read + Use** permission, then paste the values
when prompted:

- Tunnel ID: OpenAI Platform → Tunnels. It looks like `tunnel_` followed by
  32 hex characters.
- Runtime API Key: <https://platform.openai.com/settings/organization/api-keys>

The key is entered with echoing hidden and stored in the macOS Keychain.

Operators and developers can find more granular checks in the
[operator runbook](docs/operations/project-gateway-operator-runbook.md).

## Updating and removing projects

To stop Project Gateway from working with a project:

```sh
pgw project remove <path-or-workspace-id>
```

Removing a project from Project Gateway does **not** delete your project
files. It only deregisters the project and preserves its local store.

Removing Project Gateway itself (uninstall) is not part of the canonical user
workflow; see the
[operator & installer documentation](docs/specs/operator-cli-and-installer-spec.md)
for uninstall and removal details.

## Advanced / engineering

Everything above is written for end users. The material below is for operators,
developers, and readers who want the engineering details. The repository keeps
its work packages, decisions, and specifications under [`docs/`](docs/),
including:

- [Operator CLI & installer spec](docs/specs/operator-cli-and-installer-spec.md)
- [Operator runbook](docs/operations/project-gateway-operator-runbook.md)
- [macOS product contract](docs/macos-product-contract.md)
- [Physical reboot acceptance summary](docs/reports/physical-reboot-acceptance-summary.md)
- [Releases](https://github.com/mfx-labs/project-gateway-macos/releases)

### Constrained operation surface

Project Gateway is deliberately not a generic tool. It is:

- not a generic filesystem MCP
- not a shell-execution MCP
- not a generic Git-automation MCP
- not an authority self-approval mechanism
- not a package manager
- not a daemon

Its model-accessible MCP tools do **not** grant unrestricted local filesystem
authority. Operations are constrained to the accepted artifact model, and a
project must be explicitly registered before it is exposed.

For reference, the runtime exposes nine MCP tools: `draft-artifact`,
`enumerate-class`, `inspect-audit-history`, `inspect-changes`,
`inspect-registry`, `inspect-stored-record`, `persist-artifact`,
`validate-artifact`, `verify-record`. There is no generic shell, filesystem-
write, or arbitrary Git-execution tool.

### Supported lanes and validation status

| Lane | v0.2.0 status |
| --- | --- |
| macOS Intel x86_64 | Physical reboot acceptance passed |
| macOS Apple Silicon arm64 | Packaging/static validation passed; physical execution not performed |

Debugging and hardening details (fail-closed checks, store/state layout,
recovery and audit behavior) live in the linked specifications and reports.

## Development / contributing

This section is for people building Project Gateway, not for end users.

From a checkout, the committed development path is:

```sh
npm ci
npm run build
npm run typecheck
```

Run the tests with `npm test`. The installer spec and operator runbook describe
the runtime layout (`~/.local/share/project-gateway-macos/current/`,
`~/.local/bin/pgw`, registry, and state) and the release/validation process.

## License

[MIT](LICENSE)
