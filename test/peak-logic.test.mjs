import assert from 'node:assert/strict'
import fs from 'node:fs'

/**
 * Unit-test the shipped pure logic of the peak-hours widget without loading the
 * browser module: extract the marked region from client.js verbatim and import
 * it. Nothing is duplicated by hand, so a shipped change cannot pass while the
 * test still checks the old rule.
 */
const clientPath = new URL('../client.js', import.meta.url)
const source = fs.readFileSync(clientPath, 'utf8')
const START = '// #region pure-logic'
const END = '// #endregion pure-logic'
const startAt = source.indexOf(START)
const endAt = source.indexOf(END)
assert.ok(startAt >= 0, 'logic region start marker is present')
assert.ok(endAt > startAt, 'logic region end marker follows the start marker')

const region = source.slice(startAt + START.length, endAt)
const names = ['PEAK_WINDOWS_UTC', 'MODELS', 'HOLIDAYS', 'HOLIDAY_YEARS', 'beijingDateKey', 'isPeak', 'statusAt', 'nextChange', 'localDayStart', 'nextLocalMidnight', 'daySegments', 'formatPrice', 'durationParts', 'holidayYearsKnown']
const code = `${region}\nexport { ${names.join(', ')} };\n`
const logic = await import(`data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`)

/** One instant from an ISO string. */
function at(iso) {
  return new Date(iso)
}

/** One invariant assertion with a readable label. */
function peak(iso, expected) {
  assert.equal(logic.isPeak(at(iso)), expected, `isPeak(${iso})`)
}

/** One status assertion. */
function status(iso, expectedPeak, expectedReason) {
  const result = logic.statusAt(at(iso))
  assert.equal(result.peak, expectedPeak, `statusAt(${iso}).peak`)
  assert.equal(result.reason, expectedReason, `statusAt(${iso}).reason`)
}

// --- rate windows on a plain weekday (Thursday 2026-11-19) -------------------
peak('2026-11-19T00:59:59Z', false)
peak('2026-11-19T01:00:00Z', true)
peak('2026-11-19T03:59:59Z', true)
peak('2026-11-19T04:00:00Z', false)
peak('2026-11-19T05:59:59Z', false)
peak('2026-11-19T06:00:00Z', true)
peak('2026-11-19T09:59:59Z', true)
peak('2026-11-19T10:00:00Z', false)
peak('2026-11-19T23:59:59Z', false)

// --- weekends are off-peak in full ------------------------------------------
peak('2026-11-21T02:00:00Z', false)
peak('2026-11-21T08:00:00Z', false)
peak('2026-11-22T02:00:00Z', false)
status('2026-11-21T02:00:00Z', false, 'weekend')
status('2026-11-22T08:00:00Z', false, 'weekend')

// --- reasons on a weekday ----------------------------------------------------
status('2026-11-19T02:00:00Z', true, 'peak')
status('2026-11-19T04:30:00Z', false, 'hours')
status('2026-11-19T10:30:00Z', false, 'hours')

// --- Chinese public holidays are off-peak all day --------------------------
status('2026-10-01T02:00:00Z', false, 'holiday')
status('2026-10-01T08:00:00Z', false, 'holiday')
status('2026-09-30T02:00:00Z', true, 'peak')
status('2026-10-08T02:00:00Z', true, 'peak')
status('2026-02-16T08:00:00Z', false, 'holiday')
status('2027-10-04T02:00:00Z', false, 'holiday')
status('2027-02-09T02:00:00Z', false, 'holiday')
status('2027-02-15T02:00:00Z', true, 'peak')

// --- a holiday date is a Beijing date, not a UTC date ----------------------
assert.equal(logic.beijingDateKey(at('2026-09-30T15:59:59Z')), '2026-09-30')
assert.equal(logic.beijingDateKey(at('2026-09-30T16:00:00Z')), '2026-10-01')

// --- next transition, to the second ----------------------------------------
const transitions = [
  ['2026-11-19T02:00:00.000Z', '2026-11-19T04:00:00.000Z'],
  ['2026-11-19T03:59:59.500Z', '2026-11-19T04:00:00.000Z'],
  ['2026-11-19T04:30:00.000Z', '2026-11-19T06:00:00.000Z'],
  ['2026-11-19T10:00:00.000Z', '2026-11-20T01:00:00.000Z'],
  ['2026-11-19T00:30:00.000Z', '2026-11-19T01:00:00.000Z'],
  ['2026-11-20T10:00:00.000Z', '2026-11-23T01:00:00.000Z'],
  ['2026-09-30T12:00:00.000Z', '2026-10-08T01:00:00.000Z'],
  ['2026-10-08T02:00:00.000Z', '2026-10-08T04:00:00.000Z'],
]
for (const [from, expected] of transitions) {
  const result = logic.nextChange(at(from))
  assert.ok(result instanceof Date, `nextChange(${from}) returns a Date`)
  assert.equal(result.toISOString(), expected, `nextChange(${from})`)
}

// --- a local day is covered by contiguous 15-minute blocks ------------------
for (const iso of ['2026-11-19T12:00:00Z', '2026-10-01T12:00:00Z', '2026-10-25T12:00:00Z', '2026-03-29T12:00:00Z', '2026-01-01T12:00:00Z']) {
  const day = logic.daySegments(logic.localDayStart(at(iso)))
  const length = day.endMs - day.startMs
  assert.ok(length >= 23 * 3_600_000 && length <= 25 * 3_600_000, `local day around ${iso} is 23-25 hours long`)
  assert.equal(day.segments[0].start, day.startMs, `first block starts at local midnight for ${iso}`)
  assert.equal(day.segments[day.segments.length - 1].end, day.endMs, `last block ends at next local midnight for ${iso}`)
  for (let index = 0; index < day.segments.length; index += 1) {
    const segment = day.segments[index]
    assert.ok(segment.end > segment.start, `block ${index} is non-empty for ${iso}`)
    const middle = Math.floor((segment.start + segment.end) / 2)
    assert.equal(segment.kind === 'peak', logic.isPeak(new Date(middle)), `block ${index} kind matches its midpoint for ${iso}`)
    if (index > 0) {
      assert.equal(segment.start, day.segments[index - 1].end, `block ${index} is contiguous for ${iso}`)
      assert.equal(segment.kind === 'peak', logic.isPeak(new Date(segment.start)), `block ${index} starts exactly on a rate change for ${iso}`)
      assert.equal(day.segments[index - 1].kind === 'peak', logic.isPeak(new Date(segment.start - 1)), `block ${index - 1} ends exactly before the rate change for ${iso}`)
    }
  }
}

// --- prices -----------------------------------------------------------------
const prices = [
  [0.003, '$0.003'],
  [0.006, '$0.006'],
  [0.022, '$0.022'],
  [0.044, '$0.044'],
  [0.15, '$0.15'],
  [0.3, '$0.30'],
  [0.6, '$0.60'],
  [0.66, '$0.66'],
  [1.2, '$1.20'],
  [1.32, '$1.32'],
  [1.98, '$1.98'],
  [3.96, '$3.96'],
]
for (const [value, expected] of prices) {
  assert.equal(logic.formatPrice(value), expected, `formatPrice(${value})`)
}

// --- durations --------------------------------------------------------------
assert.deepEqual(logic.durationParts((9 * 3600 + 61) * 1000), { hours: 9, minutes: 1, seconds: 1 })
assert.deepEqual(logic.durationParts(-5), { hours: 0, minutes: 0, seconds: 0 })

// --- calendar coverage and model table -------------------------------------
assert.equal(logic.holidayYearsKnown(2026), true)
assert.equal(logic.holidayYearsKnown(2027), true)
assert.equal(logic.holidayYearsKnown(2028), false)
// 2026: 3 + 9 + 3 + 5 + 3 + 3 + 7 = 33 rest days; 2027: 3 + 9 + 3 + 5 + 1 + 1 + 7 = 29.
assert.equal(logic.HOLIDAYS.size, 33 + 29)
assert.equal(logic.MODELS.length, 2)
for (const model of logic.MODELS) {
  assert.equal(model.cacheHit.peak, model.cacheHit.offPeak * 2, `${model.id} cache-hit off-peak is half of peak`)
  assert.equal(model.cacheMiss.peak, model.cacheMiss.offPeak * 2, `${model.id} cache-miss off-peak is half of peak`)
  assert.equal(model.output.peak, model.output.offPeak * 2, `${model.id} output off-peak is half of peak`)
}

console.log(`ok - peak-hours logic holds in TZ=${process.env.TZ ?? '(system)'}`)
