#!/usr/bin/env bash
# 停止 QQ 机器人（Linux / macOS），等价「停止QQ机器人.bat」。
#
# 用法：
#   ./stop-qq-bot.sh          # 只停桥接（SurfCore bridge）
#   ./stop-qq-bot.sh --all    # 桥接 + SnowLuma（Docker 用 docker compose stop，原生用 kill）
#
# 与 restart.sh 同样的判定规则：先按 state/bridge.lock 的 PID，再按 bridge.js 命令行兜底，
# 且排除 MCP 子进程（*mcp-*）与依赖目录（*node_modules*），避免误杀。
set -u
cd "$(dirname "$0")" || exit 1

ALL=0
for arg in "$@"; do
  case "$arg" in
    --all|-a|all) ALL=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg（只支持 --all）" >&2; exit 1 ;;
  esac
done

cmdline_of() {
  if [ -r "/proc/$1/cmdline" ]; then
    tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null
  else
    ps -p "$1" -o command= 2>/dev/null
  fi
}

collect_bridge_pids() {
  local pid cmd
  if [ -f "state/bridge.lock" ]; then
    pid=$(tr -dc '0-9' < "state/bridge.lock")
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && echo "$pid"
  fi
  for pid in $(pgrep -f 'bridge\.js' 2>/dev/null || true); do
    [ "$pid" = "$$" ] && continue
    cmd=$(cmdline_of "$pid")
    case "$cmd" in
      *mcp-*|*node_modules*) continue ;;
      *bridge.js*) echo "$pid" ;;
    esac
  done
}

# start.sh / restart.sh 的监护 shell 会不断拉起 node，所以先停监护，再停 node。
stop_guard() {
  local pid cmd
  for pid in $(pgrep -f 'start\.sh' 2>/dev/null || true); do
    [ "$pid" = "$$" ] && continue
    cmd=$(cmdline_of "$pid")
    case "$cmd" in
      *bash*start.sh*|*/start.sh*) echo "  stop guard PID $pid"; kill -TERM "$pid" 2>/dev/null || true ;;
    esac
  done
}

echo "[stop] 停止桥接……"
stop_guard
pids=$(collect_bridge_pids | sort -u)
for pid in $pids; do
  echo "  kill PID $pid"
  kill -TERM "$pid" 2>/dev/null || true
done
sleep 1
for pid in $pids; do
  if kill -0 "$pid" 2>/dev/null; then
    echo "  PID $pid 未响应 TERM，发送 KILL"
    kill -KILL "$pid" 2>/dev/null || true
  fi
done
rm -f state/bridge.lock

if [ "$ALL" = "1" ]; then
  echo "[stop] 停止 SnowLuma……"
  SNOW_DIR="${SNOWLUMA_DIR:-}"
  if [ -z "$SNOW_DIR" ]; then
    for cand in "../snowluma-docker" "../snowluma"; do
      [ -d "$cand" ] && SNOW_DIR="$cand" && break
    done
  fi
  if [ -n "$SNOW_DIR" ] && [ -f "$SNOW_DIR/docker-compose.yml" ] && command -v docker >/dev/null 2>&1; then
    ( cd "$SNOW_DIR" && docker compose stop ) || echo "  docker compose stop 失败：可能没有 docker 权限（把用户加进 docker 组，或用 fnos-cli 操作）"
  else
    hit=0
    for pid in $(pgrep -f 'index\.mjs' 2>/dev/null || true); do
      cmd=$(cmdline_of "$pid")
      case "$cmd" in
        *SnowLuma*|*snowluma*|*/app/runtime/*) echo "  kill SnowLuma PID $pid"; kill -TERM "$pid" 2>/dev/null || true; hit=1 ;;
      esac
    done
    [ "$hit" = "0" ] && echo "  没找到 SnowLuma 进程（Docker 部署请用：cd snowluma-docker && docker compose stop）"
  fi
fi

echo "[stop] 完成。"
