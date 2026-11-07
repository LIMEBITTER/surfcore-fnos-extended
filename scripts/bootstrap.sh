#!/usr/bin/env bash
# SurfCore 一键引导安装（Linux）
#
# 陌生用户用法（复制这一行到终端）：
#   curl -fsSL https://raw.githubusercontent.com/LIMEBITTER/surfcore-fnos-extended/linux/scripts/bootstrap.sh | bash
#
# 只检查环境不安装：
#   bash scripts/bootstrap.sh --check
#
# 自定义安装位置：
#   SURFCORE_DIR="$HOME/surfcore" bash scripts/bootstrap.sh
set -Eeuo pipefail

REPO_URL="https://github.com/LIMEBITTER/surfcore-fnos-extended.git"
REPO_BRANCH="linux"
REPO_ZIP="https://github.com/LIMEBITTER/surfcore-fnos-extended/archive/refs/heads/linux.tar.gz"

CHECK=0
DIR=""
while (($#)); do
  case "$1" in
    --check) CHECK=1 ;;
    --dir)
      [[ $# -ge 2 ]] || { echo "✖ --dir 需要一个路径" >&2; exit 1; }
      DIR="$2"; shift ;;
    -h|--help)
      sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "✖ 未知参数：$1" >&2; exit 1 ;;
  esac
  shift
done

say()  { printf '%s\n' "$*"; }
ok()   { printf '  \033[32m[OK]\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m[!!]\033[0m %s\n' "$*"; }
step() { printf '\n=== %s. %s ===\n' "$1" "$2"; }
die()  { printf '\n\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

say '=============================================='
say '  SurfCore 一键安装（Linux）'
say '=============================================='

# ── 1. 环境 ────────────────────────────────────────────────
step 1 '检查环境'
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
NODE="${NODE_BIN:-}"
if [[ -z "$NODE" ]]; then
  if command -v node >/dev/null 2>&1; then
    NODE="$(command -v node)"
  elif [[ -x "$DSH_HOME/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node" ]]; then
    NODE="$DSH_HOME/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node"
    warn "PATH 里没有 node，改用 DSH 自带的 Node"
    ok "$NODE"
  else
    die '没找到 Node.js（DSH 自带运行时也没有）。请装 Node 22.13+： https://nodejs.org/'
  fi
fi

if ! "$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  die "Node $("$NODE" -v) 太老（需要 >= 22.13）"
fi
ok "Node $("$NODE" -v)"

shopt -s nullglob
profiles=()
for p in "$DSH_HOME"/profiles/*/package.json; do
  profiles+=("$(basename "$(dirname "$p")")")
done
shopt -u nullglob
if ((${#profiles[@]})); then
  ok "DSH 配置目录：$DSH_HOME（profile：$(IFS='、'; echo "${profiles[*]}")）"
else
  warn "没找到 DSH。请先装 DeepSeek Harness 并打开一次（$DSH_HOME）"
fi

if command -v git >/dev/null 2>&1; then
  ok 'git 可用（会用 clone）'
else
  warn '没有 git（会用 tar.gz 下载，也能装）'
fi

port_out=""
if command -v ss >/dev/null 2>&1; then
  port_out="$(ss -ltn 2>/dev/null || true)"
elif command -v netstat >/dev/null 2>&1; then
  port_out="$(netstat -ltn 2>/dev/null || true)"
fi
if grep -Eq ':(3000|3001)([[:space:]]|$)' <<<"$port_out"; then
  ok '检测到 SnowLuma 端口（3000/3001）'
else
  warn '没检测到 SnowLuma：QQ 会连不上，装好它之后再点一键安装即可'
fi

if ((CHECK)); then
  say ''
  say '仅检查模式，结束。'
  exit 0
fi

# ── 2. 拿到代码 ─────────────────────────────────────────────
step 2 '下载 SurfCore'
DIR="${DIR:-${SURFCORE_DIR:-$HOME/surfcore}}"
say "  安装到：$DIR"

if [[ -e "$DIR" && ! -f "$DIR/package.json" ]]; then
  die "$DIR 已存在，但不是 SurfCore 目录；换一个 --dir 或先移走它"
fi

if [[ -f "$DIR/package.json" ]]; then
  ok '目录已存在，跳到更新'
  if [[ -d "$DIR/.git" ]] && command -v git >/dev/null 2>&1; then
    git -C "$DIR" pull --ff-only >/dev/null 2>&1 || warn 'git pull 失败（可忽略，继续用现有版本）'
  fi
elif command -v git >/dev/null 2>&1; then
  mkdir -p "$(dirname "$DIR")"
  git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$DIR" || die 'git clone 失败'
  ok '克隆完成'
else
  command -v curl >/dev/null 2>&1 || die '没有 git，也没有 curl；请先装 git 或 curl'
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  say '  下载 tar.gz …'
  curl -fL "$REPO_ZIP" -o "$TMP/repo.tar.gz" || die '下载失败'
  tar -xzf "$TMP/repo.tar.gz" -C "$TMP" || die '解压失败'
  src="$(find "$TMP" -maxdepth 1 -type d -name 'surfcore-fnos-extended-*' -print -quit)"
  [[ -n "$src" ]] || die '解压后找不到源码目录'
  mkdir -p "$(dirname "$DIR")"
  mv "$src" "$DIR"
  ok '解压完成'
fi

# ── 3. 依赖 ────────────────────────────────────────────────
step 3 '安装依赖（npm install）'
cd "$DIR"
PNPM_CJS="$DSH_HOME/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs"
if command -v npm >/dev/null 2>&1; then
  npm install --no-audit --no-fund || die '依赖安装失败。可试：npm config set registry https://registry.npmmirror.com'
elif [[ -f "$PNPM_CJS" ]]; then
  warn '没有 npm，改用 DSH 自带的 pnpm'
  "$NODE" "$PNPM_CJS" install || die '依赖安装失败'
else
  die '没有 npm 也没有 pnpm，请装 Node 22.13+ 后重试'
fi
ok '依赖完成'

# ── 4. 装进 DSH ───────────────────────────────────────────
step 4 '装进 DSH（注册插件 / 预设 / MCP）'
PROFILE=""
if [[ -f scripts/detect-profile.mjs ]]; then
  PROFILE="$("$NODE" scripts/detect-profile.mjs 2>/dev/null | tail -n 1 || true)"
fi
PROFILE="${PROFILE:-web}"
say "  使用 profile：$PROFILE"
"$NODE" scripts/setup-dsh.mjs "$PROFILE" || die "注册失败：可在 $DIR 下手动跑 node scripts/setup-dsh.mjs $PROFILE"
ok '已注册'

# ── 5. 配置 ───────────────────────────────────────────────
step 5 '生成本地配置'
if [[ -f config.json ]]; then
  ok 'config.json 已存在（不覆盖）'
else
  cp config.example.json config.json
  ok '已生成 config.json（白名单稍后在界面里勾）'
fi

# ── 6. 下一步 ─────────────────────────────────────────────
step 6 '完成'
say ''
say '  接下来（必须做）：'
say '    1) 完全退出 DSH，再打开'
say '    2) 设置 → SurfCore → 诊断 → 一键安装（全部）'
say '    3) 弹窗里填主人 QQ、勾群 → 开始安装'
say '    4) 若提示需要，再退出重开一次 DSH'
say ''
say "  安装目录：$DIR"
say '  出问题：设置 → SurfCore → 诊断 → 重新体检，把 ✗ 的那项发我。'
say ''
