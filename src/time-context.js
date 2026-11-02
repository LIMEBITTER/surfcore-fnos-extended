// 时间上下文 + 出口时间校验。
//
// 设计目标（2026-11-02）：
//   1. 不增加额外模型调用/token：时钟只作为 prompt 末尾的一小段；
//   2. 不依赖模型心算：发送前用服务器时间做一次确定性校验，错了就地改写；
//   3. 高可用：解析失败/异常一律 fail-open，绝不阻断消息。
//
// 注意：这里用显式 Asia/Shanghai，不依赖宿主的本地时区设置。

const TZ = 'Asia/Shanghai';
const CN_NUM = '0-9零〇一二三四五六七八九十两';
const HISTORY_RE = /(昨天|昨晚|明天|刚才|那时|约好|计划|我说|如果|假如)/;

const DIGITS = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

function pad(n) { return String(n).padStart(2, '0'); }

function toInt(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return NaN;
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0;
  let num = 0;
  for (const ch of s) {
    if (DIGITS[ch] !== undefined) num = DIGITS[ch];
    else if (ch === '十') { total += (num || 1) * 10; num = 0; }
    else if (ch === '百') { total += (num || 1) * 100; num = 0; }
    else return NaN;
  }
  return total + num;
}

function localParts(now) {
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const out = {};
  for (const part of fmt.formatToParts(now)) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  if (out.hour === '24') out.hour = '00';
  return out;
}

export function formatClock(now = new Date()) {
  const p = localParts(now);
  return `【钟】${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} ${p.weekday}（${TZ}）`;
}

export function formatAnchors(now = new Date()) {
  const p = localParts(now);
  const sec = Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second);
  const nextHalf = (Math.floor(sec / 1800) + 1) * 1800;
  const nextHour = (Math.floor(sec / 3600) + 1) * 3600;
  const target = (t) => (t >= 86400 ? 0 : t);
  const hm = (t) => `${pad(Math.floor((t % 86400) / 3600))}:${pad(Math.floor((t % 3600) / 60))}`;
  const diff = (t) => {
    const d = (t >= 86400 ? 86400 : t) - sec;
    return d > 0 ? d : 86400 - sec + target(t);
  };
  const desc = (t) => {
    const d = Math.max(1, Math.round(diff(t)));
    return `${hm(target(t))} 还有 ${Math.floor(d / 60)} 分 ${d % 60} 秒`;
  };
  return `【锚点】${desc(nextHalf)}；${desc(nextHour)}`;
}

export function needsTimeDetail(text) {
  return /(几点|多久|时间|到点|睡|还有|今天|明天|昨天|昨晚|分钟|小时|点(?:半|啦|了))/.test(String(text ?? ''));
}

// 把“口语目标时间”映射到最近的未来时刻；支持 11 点半 ≈ 23:30 这种 12 小时制。
function nextTargetTime(hour, minute, now, allow12h) {
  const p = localParts(now);
  const nowSec = Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second);
  const baseDay = new Date(now);
  const candidates = [];
  for (const h of (allow12h && hour >= 1 && hour <= 12 ? [hour, (hour + 12) % 24] : [hour])) {
    for (const dayOffset of [0, 1]) {
      const dt = new Date(baseDay);
      dt.setDate(dt.getDate() + dayOffset);
      const p2 = localParts(dt);
      const target = new Date(`${p2.year}-${p2.month}-${p2.day}T${pad(h)}:${pad(minute)}:00+08:00`);
      if (!Number.isFinite(target.getTime())) continue;
      const delta = target.getTime() - now.getTime();
      if (delta > 0 && delta <= 36 * 3600 * 1000) candidates.push(delta);
    }
  }
  if (!candidates.length) return null;
  return Math.round(Math.min(...candidates) / 60000);
}

export function guardTimeClaims(input, now = new Date()) {
  let text = String(input ?? '');
  if (!text) return { text, changed: false, corrections: [] };
  const corrections = [];
  const edits = [];

  try {
    // 1) “还有 X 分钟就[到] HH 点半” → 按服务器时间重算分钟数
    const countRe = new RegExp(`(还有|还剩|再有)\\s*([${CN_NUM}]{1,3})\\s*分钟\\s*(?:就|到|就是)?\\s*([${CN_NUM}]{1,2})\\s*([点:：])\\s*(半|[${CN_NUM}]{1,3})?`, 'g');
    let m;
    while ((m = countRe.exec(text)) !== null) {
      const before = text.slice(Math.max(0, m.index - 16), m.index);
      if (HISTORY_RE.test(before)) continue;
      const claimed = toInt(m[2]);
      const hour = toInt(m[3]);
      const minute = m[5] === '半' ? 30 : (m[5] ? toInt(m[5]) : 0);
      if (!Number.isFinite(claimed) || !Number.isFinite(hour) || !Number.isFinite(minute)) continue;
      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) continue;
      const expected = nextTargetTime(hour, minute, now, m[4] === '点');
      if (expected === null || expected < 0 || expected > 720) continue;
      if (Math.abs(claimed - expected) <= 2) continue;
      const start = m.index + m[0].indexOf(m[2]);
      edits.push({ start, end: start + m[2].length, replacement: String(expected), from: m[2], to: String(expected) });
    }

    // 2) “现在/已经 HH:MM” → 与服务器时钟不一致时直接替换
    const clockRe = /(现在|已经)\s*(?:是|到)?\s*(\d{1,2})[:：](\d{2})/g;
    while ((m = clockRe.exec(text)) !== null) {
      const before = text.slice(Math.max(0, m.index - 16), m.index);
      if (HISTORY_RE.test(before)) continue;
      const hour = Number(m[2]);
      const minute = Number(m[3]);
      if (hour > 23 || minute > 59) continue;
      const p = localParts(now);
      const nowMin = Number(p.hour) * 60 + Number(p.minute);
      if (Math.abs(hour * 60 + minute - nowMin) <= 1) continue;
      const start = m.index + m[0].indexOf(`${m[2]}:${m[3]}`);
      const replacement = `${p.hour}:${p.minute}`;
      edits.push({ start, end: start + `${m[2]}:${m[3]}`.length, replacement, from: `${m[2]}:${m[3]}`, to: replacement });
    }

    if (!edits.length) return { text, changed: false, corrections: [] };
    edits.sort((a, b) => b.start - a.start);
    for (const e of edits) {
      if (e.start < 0 || e.end > text.length) continue;
      text = text.slice(0, e.start) + e.replacement + text.slice(e.end);
      corrections.push({ from: e.from, to: e.to });
    }
    return { text, changed: corrections.length > 0, corrections };
  } catch {
    // 高可用：校验出错不能影响发消息
    return { text: String(input ?? ''), changed: false, corrections: [] };
  }
}
