import assert from 'node:assert/strict'
import { buildNightSchedule, normalizeNightWindows } from '../tools/lib/night-schedule.mjs'
import { normalizeBiliConfig } from '../lib/store.js'
import { daysText, normalizeDays } from '../tools/lib/time-window.mjs'

const cfg = normalizeBiliConfig({ night: { windows: [
  { start: '20:00', end: '24:00', wakes: 2, days: [1, 2, 3, 4, 5] },
  { start: '10:00', end: '12:00', wakes: 1, days: [0, 6] },
], maxWakesPerDay: 2 } })
assert.deepEqual(cfg.night.windows.map((w) => w.days), [[1, 2, 3, 4, 5], [0, 6]])
assert.equal(cfg.night.maxWakesPerDay, 2)
assert.equal(daysText([1, 2, 3, 4, 5]), '工作日')
assert.equal(daysText([0, 6]), '周末')
assert.deepEqual(normalizeDays([]), [0, 1, 2, 3, 4, 5, 6])

const numeric = [
  { start: 1200, end: 1440, wrap: false, label: '20:00–24:00', wakes: 2, days: [1, 2, 3, 4, 5] },
  { start: 600, end: 720, wrap: false, label: '10:00–12:00', wakes: 1, days: [0, 6] },
  { start: 1200, end: 1440, wrap: false, label: '20:00–24:00', wakes: 2, days: [0, 6] },
]
assert.deepEqual(normalizeNightWindows(numeric).map((w) => w.days), [[1, 2, 3, 4, 5], [0, 6], [0, 6]])

const monday = buildNightSchedule({ windows: numeric, maxWakes: 2, minGapMin: 20, skipChance: 0, nowMin: 0, day: 1, random: () => 0.5 })
assert.equal(monday.slots.length, 2)
assert.ok(monday.slots.every((s) => s.days.join(',') === '1,2,3,4,5'))
assert.ok(monday.slots.every((s) => s.window === '20:00–24:00'))

const weekend = buildNightSchedule({ windows: numeric, maxWakes: 2, minGapMin: 20, skipChance: 0, nowMin: 0, day: 6, random: () => 0.5 })
assert.equal(weekend.slots.length, 2)
assert.ok(weekend.slots.every((s) => s.days.join(',') === '0,6'))
assert.deepEqual([...new Set(weekend.slots.map((s) => s.window))].sort(), ['10:00–12:00', '20:00–24:00'])

const none = buildNightSchedule({ windows: [{ start: '20:00', end: '24:00', wakes: 1, days: [1] }], maxWakes: 2, nowMin: 0, day: 6, random: () => 0.5 })
assert.equal(none.slots.length, 0)
assert.ok(none.warnings.some((w) => w.includes('没有适用的作息窗口')))

const zero = buildNightSchedule({ windows: numeric, maxWakes: 0, nowMin: 0, day: 1, random: () => 0.5 })
assert.equal(zero.slots.length, 0)
console.log('night days tests OK')
