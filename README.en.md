# SurfCore · fnOS Extended

A QQ / Bilibili agent plugin for [DSH (DeepSeek Harness)](https://github.com/deepseek-ai/dsh). This is the Linux / fnOS branch of [Mieksido/surfcore](https://github.com/Mieksido/surfcore): it keeps personas, memory, the QQ bridge and Bilibili features, while replacing Windows-only startup, browser, path and permission logic.

> Branch: `linux`. Updates follow formal Releases only — there is no dev channel.

| Item | Value |
| --- | --- |
| Version | `0.8.9.1-linux` |
| DSH | verified on `0.2.2-rc.1`; baseline `0.2.1-rc.5` |
| Node | ≥ 22.13 |
| Platform | Linux x64 / fnOS |
| License | MIT; SnowLuma is third-party proprietary and not bundled |

## What it does

SurfCore is a DSH profile bundle, not a standalone service. DSH loads it; the plugin starts the QQ bridge, registers MCP servers, and adds a console page inside DSH Web.

```
QQ users
  │
  ▼
SnowLuma (Docker: Linux QQ + OneBot)
  │  HTTP :3000 / WebSocket :3001
  ▼
src/bridge.js (wakeups, presets, quotas, Bilibili tools)
  │  DSH Web API
  ▼
DSH (profile chosen at install time)  Web UI :3080
  └─ console API :3100
```

Do not run a second `npm start`; the bridge is started by the plugin. A duplicate only fights over the lock and ports.

## Requirements

| Dependency | Notes |
| --- | --- |
| Node ≥ 22.13 | same user as DSH; do not install as root |
| DSH + profile | `dsh --profile <name> --dump-config` must work |
| pnpm | required by `dsh plugin install` |
| SnowLuma | Docker image `motricseven7/snowluma:latest`; log in yourself |
| Chromium/Chrome | only for Bilibili QR login; `SURFCORE_BROWSER` can override |

## Install

### One command

```bash
curl -fsSL https://raw.githubusercontent.com/LIMEBITTER/surfcore-fnos-extended/linux/scripts/bootstrap.sh -o /tmp/surfcore-bootstrap.sh
bash /tmp/surfcore-bootstrap.sh --check
bash /tmp/surfcore-bootstrap.sh
```

The script checks Node, the DSH profile, git and common ports, clones the `linux` branch to `~/surfcore` (`SURFCORE_DIR` overrides), runs `npm install`, then `setup-dsh.mjs` to register the bundle / presets / MCP servers. It does not restart DSH.

### Manual

```bash
git clone --branch linux https://github.com/LIMEBITTER/surfcore-fnos-extended.git ~/surfcore
cd ~/surfcore
npm install
node scripts/detect-profile.mjs
node scripts/setup-dsh.mjs <profile>
```

`setup-dsh.mjs` rolls back profile changes on failure. Do not retry blindly; fix the original error first.

### SnowLuma

Run SnowLuma in Docker, publish OneBot HTTP / WebSocket and the WebUI only to loopback or your LAN, and mount its `data/` directory:

- WebUI: `http://<host>:5099`
- OneBot HTTP: `127.0.0.1:3000`
- OneBot WebSocket: `127.0.0.1:3001`

Log in to QQ in the WebUI. The OneBot token lives in SnowLuma's `data/config/onebot_<uin>.json`; SurfCore reads it via `snowluma.homeDir`.

## Configuration

Runtime configuration is `config.json` at the repository root (only `config.example.json` is committed; never overwrite user data wholesale).

| Key | Purpose |
| --- | --- |
| `dsh.baseUrl` | DSH Web API, default `http://127.0.0.1:3080` |
| `snowluma.wsUrl` / `httpUrl` | OneBot endpoints; use `127.0.0.1` for Docker, never `0.0.0.0` |
| `snowluma.homeDir` | SnowLuma data directory (needed to find the OneBot token) |
| `snowluma.followDiscoveredEndpoint` | keep `false` for Docker |
| `ownerQQ` / `allow.*` | who may use it; empty `allow.groups` means no group chats |
| `consolePort` / `consoleToken` | console; empty token is generated into `state/console-token` |
| `biliBridge.manual.enabled` | allow manual Bilibili tools from QQ; default off |

Useful environment variables:

| Variable | Purpose |
| --- | --- |
| `SURFCORE_BROWSER` | absolute path to the browser used for QR login |
| `SURFCORE_TRUSTED_HOSTS` | extra exact Host values allowed by the console API |
| `SNOWLUMA_HOME` | override the SnowLuma directory |
| `DSH_HOME` / `DSH_PROFILE` | DSH home and profile name |

Tighten sensitive files:

```bash
npm run harden-acl
```

## Start and verify

Restart DSH after installation. Then:

```bash
curl -I http://127.0.0.1:3080/          # 401 is expected without a token cookie

TOKEN=$(cat state/console-token)
curl -s -H "x-console-token: $TOKEN" http://127.0.0.1:3100/api/status

node scripts/self-test.js
cd plugins/surfcore && npm test
```

Healthy state:

- DSH Web opens and SurfCore is visible in settings / Plugins.
- `/api/status` reports `dshReady=true`, `snowluma.connected=true`, `accountOnline=true`, `good=true`.
- SnowLuma WebUI opens; QQ is logged in; OneBot `:3000/:3001` is listening.
- The bridge process exists and its log contains `SnowLuma 已连接`.

## Data and logs

| Content | Path |
| --- | --- |
| Plugin config | `~/surfcore/config.json` (600) |
| Console token | `~/surfcore/state/console-token` |
| Bilibili config / credentials | `$DSH_HOME/surfcore/bili.config.json`, `$DSH_HOME/surfcore/bili/credentials.json` |
| Characters / memory / ledger | `$DSH_HOME/surfcore/characters/<id>/` |
| Bridge log | `~/surfcore/state/bridge.log` |

The repository never contains real accounts, group IDs, cookies or memory data.

## Bilibili and night schedule

- Bilibili QR login, watch history, dynamics, comment/private-message listening and manual tools live in the Bilibili section of the settings page.
- Each night window can target every day, weekdays, weekends, or individual weekdays; a cross-midnight window belongs to its start day.
- Defaults follow DeepSeek off-peak pricing: weekdays 18:30–24:00, weekends 08:00–24:00 (plus a separate 00:00–01:00 window). Peak hours (weekdays 09:00–12:00 and 14:00–18:00) are not used for scheduled wakeups.
- `night.maxWakesPerDay` caps wakeups per day: 0 means no wakeup, maximum 12.

## Updates

- Formal Releases only; the dev channel was removed.
- The root `package.json` is the single source of the version; the plugin package must match.
- Source installs: `git pull --ff-only origin linux`, then restart DSH. Zip installs: use “Check for updates” in settings.
- After updating, fully quit and reopen DSH; refreshing the page is not enough.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Console 403 “loopback only” | set `SURFCORE_TRUSTED_HOSTS=<host:port>` and restart DSH |
| `dsh plugin ... exit 127` / `spawn pnpm ENOENT` | install pnpm, rerun `setup-dsh.mjs` |
| `Cannot find module '@deepseek-ai/schemastery'` | run `npm install`, then `setup-dsh`, then restart |
| SnowLuma `code=1006` | check `snowluma.homeDir`, OneBot token, and that `:3000/:3001` are listening |
| Bilibili QR login finds no browser | install Chromium or set `SURFCORE_BROWSER` |
| Button action gives no feedback | 0.8.9.1 adds automatic toasts; attach `state/bridge.log` and the browser console if it still happens |

## Development

```bash
git checkout linux
cd plugins/surfcore && npm test
cd ../.. && npm run test:audit
npm run test:version
```

- Do not open issues/PRs against upstream `Mieksido/surfcore`; `upstream` is read-only.
- Commit messages: `feat(scope): …`, `fix(scope): …`, `docs: …`.
- Release process: `docs/RELEASE.md`; formal Releases only.

## More docs

- Agent deployment runbook: [`README.DSH.md`](README.DSH.md) (Chinese)
- Architecture / Bilibili subsystem: `docs/guides/ARCHITECTURE.md`, `docs/guides/SUBSYSTEM-BILI.md`
- Pitfalls: `docs/PITFALLS.md`; change cases: `docs/cases/`

## License

MIT, with upstream copyright notices. Upstream: [Mieksido/surfcore](https://github.com/Mieksido/surfcore).
