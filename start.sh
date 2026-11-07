#!/usr/bin/env bash
# 一键启动（Linux / macOS）。
#
# 与 start.bat 等价，做三件事：
#   1) 收紧 state/ 权限（失败只打印提示，绝不阻断启动）；
#   2) 跑 node src/bridge.js；
#   3) 退出码 2 = 已有实例持有 state/bridge.lock，直接退出；其它退出码 5 秒后自动重启。
#
# 用法：./start.sh
set -u
cd "$(dirname "$0")" || exit 1

if [ ! -f src/bridge.js ]; then
  echo "[start.sh] 当前目录不像 SurfCore 仓库（找不到 src/bridge.js）：$(pwd)" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "[start.sh] 找不到 node。请先安装 Node.js >= 22.13 并确保它在 PATH 里。" >&2
  exit 1
fi

# 收紧 state/ 与 config.json 权限：Windows 走 icacls，这里走 chmod。
# 失败时脚本自己会打印可复制的命令并以 0 退出，所以这里只兜住异常退出码。
node scripts/harden-state-acl.mjs --quiet || true

child=""
on_signal() {
  if [ -n "$child" ] && kill -0 "$child" 2>/dev/null; then
    kill -TERM "$child" 2>/dev/null
    wait "$child" 2>/dev/null
  fi
  echo "[start.sh] 已停止。" >&2
  exit 0
}
trap on_signal INT TERM

while :; do
  node src/bridge.js &
  child=$!
  wait "$child"
  code=$?
  child=""

  if [ "$code" -eq 2 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 已有桥接实例在运行（退出码 2），本次不再启动。" >&2
    exit 2
  fi
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 桥接退出（code $code），5 秒后重启……" >&2
  sleep 5
done
