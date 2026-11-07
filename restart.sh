#!/usr/bin/env bash
# 重启桥接（Linux / macOS），等价 restart.bat。
#
# 为什么要这么麻烦：start.sh 会自动重启 node，所以只 kill node 没用——监护 shell 会再拉起来。
# 而且旧版按绝对路径匹配命令行永远匹配不上（start.bat 是相对路径启动的）。这里两条路一起走：
#   ① state/bridge.lock 里记的 PID（桥接自己写的单实例锁）
#   ② `bridge.js` 命令行兜底（排除 *mcp-* 与 *node_modules*，那是 MCP 子进程）
# 确认旧实例真的退出（并放开控制台端口）之后才删锁并拉起新实例；否则中止，避免双实例。
#
# 用法：./restart.sh
set -u
cd "$(dirname "$0")" || exit 1

LOCK="state/bridge.lock"

cmdline_of() {
  # $1 = pid。优先 /proc（Linux），没有就用 ps（macOS/BSD）。
  if [ -r "/proc/$1/cmdline" ]; then
    tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null
  else
    ps -p "$1" -o command= 2>/dev/null
  fi
}

collect_bridge_pids() {
  local pid cmd
  if [ -f "$LOCK" ]; then
    pid=$(tr -dc '0-9' < "$LOCK")
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

echo "[restart] 停止旧桥接……"
pids=$(collect_bridge_pids | sort -u | tr '\n' ' ')
for pid in $pids; do
  echo "  kill PID $pid"
  kill -TERM "$pid" 2>/dev/null || true
done

# 等它真的退出：最长 5 秒，还活着就 KILL。
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ -z "$pids" ] && break
  alive=""
  for pid in $pids; do
    kill -0 "$pid" 2>/dev/null && alive="$alive $pid"
  done
  [ -z "$alive" ] && break
  sleep 0.5
done
for pid in ${alive:-}; do
  echo "  PID $pid 未响应 TERM，发送 KILL"
  kill -KILL "$pid" 2>/dev/null || true
done
sleep 1

leftover=""
for pid in $(collect_bridge_pids | sort -u); do
  kill -0 "$pid" 2>/dev/null && leftover="$leftover $pid"
done
if [ -n "$leftover" ]; then
  echo "[restart] 仍有桥接进程存活：$leftover" >&2
  for pid in $leftover; do
    echo "  PID $pid  $(cmdline_of "$pid")" >&2
  done
  echo "[restart] 已中止：出现双实例会互相抢消息、互相覆盖 state/。请手动结束上面列出的 PID 后重试。" >&2
  exit 1
fi

rm -f "$LOCK"

echo "[restart] 启动新桥接（后台）……"
if command -v setsid >/dev/null 2>&1; then
  setsid nohup bash ./start.sh >> state/guard.log 2>&1 &
else
  nohup bash ./start.sh >> state/guard.log 2>&1 &
fi
echo "[restart] 完成。日志：state/guard.log（桥接自身日志：state/bridge.log）"
