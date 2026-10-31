// 给视频点赞 / 取消赞（本机补丁 2026-11-01，SurfCore 0.8.4）
//
//   node like.mjs --bvid BV1xx411c7mD --dry
//   node like.mjs --bvid BV1xx411c7mD --go
//   node like.mjs --bvid BV1xx411c7mD --go --undo
//
// 只做"视频点赞"这一件事：先 BV→aid，再调 archive/like（csrf=bili_jct）。
// 点赞可逆、无正文，所以不经过四本账；调用方（bridge）自己做频率上限。
import fs from 'node:fs'
import { accountBili } from '../lib/state-paths.mjs'

const argv = process.argv.slice(2)
const args = new Map()
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i]
  if (a.startsWith('--')) args.set(a.slice(2), argv[i + 1]?.startsWith('--') ? true : argv[++i] ?? true)
}
const bvid = String(args.get('bvid') ?? '').trim()
const isDry = args.has('dry')
const isGo = args.has('go')
const undo = args.has('undo')

if (!bvid) { console.error('缺少 --bvid'); process.exit(2) }
if (!/^BV[0-9A-Za-z]{8,12}$/.test(bvid)) { console.error('--bvid 格式不对'); process.exit(2) }
if (!isDry && !isGo) { console.error('必须显式 --dry 或 --go'); process.exit(2) }

const credPath = accountBili('credentials.json')
if (!fs.existsSync(credPath)) { console.error(`缺少凭据文件: ${credPath}`); process.exit(3) }
const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'))
for (const k of ['sessdata', 'bili_jct', 'buvid3']) {
  if (!cred[k] || String(cred[k]).trim() === '') { console.error(`凭据文件缺少 ${k}`); process.exit(3) }
}
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const cookie = `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}`
const H = { 'user-agent': UA, referer: `https://www.bilibili.com/video/${bvid}`, cookie }

const view = await (await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, { headers: H })).json()
if (view.code !== 0 || !view.data?.aid) {
  console.error(`取视频信息失败: code=${view.code} ${view.message ?? ''}`)
  process.exit(4)
}
const aid = view.data.aid
const title = view.data.title ?? ''
const like = undo ? 0 : 1
console.log(`视频: ${title}`)
console.log(`  bvid=${bvid} aid=${aid}`)
console.log(undo ? '  动作: 取消赞' : '  动作: 点赞')

if (isDry) {
  console.log('[dry] 未提交点赞。')
  process.exit(0)
}

const body = new URLSearchParams({ aid: String(aid), like: String(like), csrf: String(cred.bili_jct) })
const r = await fetch('https://api.bilibili.com/x/web-interface/archive/like', {
  method: 'POST',
  headers: { ...H, origin: 'https://www.bilibili.com', 'content-type': 'application/x-www-form-urlencoded' },
  body,
})
const out = await r.json().catch(() => ({}))
console.log(`[go] HTTP ${r.status} code=${out.code ?? '?'} ${out.message ?? ''}`)
if (out.code === 0) console.log(undo ? '  ✅ 已取消赞' : '  ✅ 已点赞')
process.exit(out.code === 0 ? 0 : 5)
