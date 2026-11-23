/**
 * Client half of the DeepSeek peak-hours bundle.
 *
 * Renders one pill under the chat composer that answers the question at a
 * glance: is DeepSeek API pricing on peak or off-peak rates right now, and how
 * long until the rate changes? Clicking it opens a panel with today's local
 * timeline, the reason for the current window, and the price of every model at
 * the active rate.
 *
 * The schedule is a fixed rule (peak: 01:00-04:00 and 06:00-10:00 UTC, Monday
 * through Friday, excluding Chinese public holidays, which are off-peak all
 * day); off-peak rates are half the peak rates. Everything is derived from the
 * browser clock, so there is no Host route and no network read: the price table
 * and the holiday calendar are the only data, and both are static.
 */

window.__ModuleLoader__.load({
  id: 'dsh-deepseek-peak-hours',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    const NS = 'deepseek-peak-hours'

    // #region pure-logic

    const DAY_MS = 86_400_000
    /** China Standard Time is UTC+8 all year; a Chinese holiday is a Beijing date. */
    const BEIJING_OFFSET_MS = 28_800_000
    /** Peak windows as UTC hours, half-open [start, end). */
    const PEAK_WINDOWS_UTC = [[1, 4], [6, 10]]

    const PRICING_SOURCE = 'https://api-docs.deepseek.com/quick_start/pricing'
    const PRICING_UPDATED = '2026-11-18'

    /** Per 1M tokens, in USD, by window. Source: the pricing page linked above. */
    const MODELS = [
      {
        id: 'deepseek-flash',
        cacheHit: { peak: 0.006, offPeak: 0.003 },
        cacheMiss: { peak: 0.3, offPeak: 0.15 },
        output: { peak: 1.2, offPeak: 0.6 },
      },
      {
        id: 'deepseek-v4-pro',
        cacheHit: { peak: 0.044, offPeak: 0.022 },
        cacheMiss: { peak: 1.32, offPeak: 0.66 },
        output: { peak: 3.96, offPeak: 1.98 },
      },
    ]

    /**
     * Official Chinese public holiday dates, as Beijing calendar dates, on which
     * the whole day bills at off-peak rates. Only the official rest days matter:
     * weekends are off-peak anyway, and a make-up workday that falls on a weekend
     * stays off-peak. Source: State Council holiday notices for 2026 and 2027,
     * collected per year by https://github.com/NateScarlet/holiday-cn
     * (2026: https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm,
     * 2027: https://www.gov.cn/zhengce/zhengceku/202611/content_7085102.htm).
     */
    const HOLIDAYS = new Set([
      // 2026
      '2026-01-01', '2026-01-02', '2026-01-03',
      '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
      '2026-04-04', '2026-04-05', '2026-04-06',
      '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
      '2026-06-19', '2026-06-20', '2026-06-21',
      '2026-09-25', '2026-09-26', '2026-09-27',
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
      // 2027
      '2027-01-01', '2027-01-02', '2027-01-03',
      '2027-02-05', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09', '2027-02-10', '2027-02-11', '2027-02-12', '2027-02-13',
      '2027-04-03', '2027-04-04', '2027-04-05',
      '2027-05-01', '2027-05-02', '2027-05-03', '2027-05-04', '2027-05-05',
      '2027-06-09',
      '2027-09-15',
      '2027-10-01', '2027-10-02', '2027-10-03', '2027-10-04', '2027-10-05', '2027-10-06', '2027-10-07',
    ])
    const HOLIDAY_YEARS = [2026, 2027]

    /** Two-digit month or day. */
    function pad2(value) {
      return value < 10 ? `0${value}` : String(value)
    }

    /** The Beijing calendar date an instant falls on, as `YYYY-MM-DD`. */
    function beijingDateKey(instant) {
      const shifted = new Date(instant.getTime() + BEIJING_OFFSET_MS)
      return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
    }

    /** Fractional UTC hour of the day, in [0, 24). */
    function utcHour(instant) {
      return (((instant.getTime() % DAY_MS) + DAY_MS) % DAY_MS) / 3_600_000
    }

    /** Whether one instant bills at peak rates. */
    function isPeak(instant) {
      const weekday = instant.getUTCDay()
      if (weekday === 0 || weekday === 6) return false
      const hour = utcHour(instant)
      const inWindow = PEAK_WINDOWS_UTC.some((window) => hour >= window[0] && hour < window[1])
      if (!inWindow) return false
      return !HOLIDAYS.has(beijingDateKey(instant))
    }

    /** Whether one instant is peak, and which rule decided it. */
    function statusAt(instant) {
      const peak = isPeak(instant)
      if (HOLIDAYS.has(beijingDateKey(instant))) return { peak: false, reason: 'holiday' }
      const weekday = instant.getUTCDay()
      if (weekday === 0 || weekday === 6) return { peak: false, reason: 'weekend' }
      return { peak, reason: peak ? 'peak' : 'hours' }
    }

    /**
     * The first instant after `from` whose peak/off-peak state differs. Scans in
     * 15-minute steps to bracket a boundary, then bisects to the exact
     * millisecond; boundaries sit on UTC hours, so the scan lands in the block
     * that contains one.
     */
    function nextChange(from) {
      const start = from.getTime()
      const initial = isPeak(from)
      const step = 15 * 60_000
      const limit = 40 * DAY_MS
      let previous = start
      for (let at = start + step; at <= start + limit; at += step) {
        if (isPeak(new Date(at)) !== initial) {
          let low = previous
          let high = at
          while (high - low > 1) {
            const middle = low + Math.floor((high - low) / 2)
            if (isPeak(new Date(middle)) === initial) low = middle
            else high = middle
          }
          return new Date(high)
        }
        previous = at
      }
      return undefined
    }

    /** Local midnight of the day an instant belongs to. */
    function localDayStart(instant) {
      return new Date(instant.getFullYear(), instant.getMonth(), instant.getDate())
    }

    /** The following local midnight; a DST day can be shorter or longer than 24h. */
    function nextLocalMidnight(dayStart) {
      return new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1)
    }

    /**
     * One local day as ordered peak/off-peak blocks of 15 minutes. Every rate
     * boundary sits on a UTC quarter-hour, so sampling each block's midpoint
     * classifies it exactly.
     */
    function daySegments(dayStart) {
      const startMs = dayStart.getTime()
      const endMs = nextLocalMidnight(dayStart).getTime()
      const step = 15 * 60_000
      const segments = []
      let at = startMs
      while (at < endMs) {
        const next = Math.min(at + step, endMs)
        const middle = at + Math.floor((next - at) / 2)
        const kind = isPeak(new Date(middle)) ? 'peak' : 'offPeak'
        const last = segments[segments.length - 1]
        if (last !== undefined && last.kind === kind) last.end = next
        else segments.push({ kind, start: at, end: next })
        at = next
      }
      return { startMs, endMs, segments }
    }

    /** Format a per-million-token price, keeping three decimals only when needed. */
    function formatPrice(value) {
      return `$${value.toFixed(3).replace(/(\.\d{2})0$/, '$1')}`
    }

    /** Split a duration into whole hours, minutes and seconds. */
    function durationParts(totalMs) {
      const totalSeconds = Math.max(0, Math.floor(totalMs / 1000))
      return { hours: Math.floor(totalSeconds / 3600), minutes: Math.floor((totalSeconds % 3600) / 60), seconds: totalSeconds % 60 }
    }

    /** Whether the holiday calendar covers one calendar year. */
    function holidayYearsKnown(year) {
      return HOLIDAY_YEARS.includes(year)
    }

    // #endregion pure-logic

    /** Machine locale ids to the BCP 47 tags Intl formats with. */
    function localeTag(language) {
      if (language === 'zh') return 'zh-CN'
      return 'en-US'
    }

    const clockFormatters = new Map()
    const changeFormatters = new Map()

    /** Cached local clock formatter for one language. */
    function clockFormatter(language) {
      const tag = localeTag(language)
      let formatter = clockFormatters.get(tag)
      if (formatter === undefined) {
        formatter = new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' })
        clockFormatters.set(tag, formatter)
      }
      return formatter
    }

    /** Cached "weekday + clock" formatter for one language. */
    function changeFormatter(language) {
      const tag = localeTag(language)
      let formatter = changeFormatters.get(tag)
      if (formatter === undefined) {
        formatter = new Intl.DateTimeFormat(tag, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
        changeFormatters.set(tag, formatter)
      }
      return formatter
    }

    /** Format one instant as a local clock time. */
    function formatClock(instant, language) {
      return clockFormatter(language).format(instant)
    }

    /** Format one instant as a local weekday and clock time. */
    function formatChange(instant, language) {
      return changeFormatter(language).format(instant)
    }

    /** The countdown text for a transition: hours and minutes, then minutes, then seconds. */
    function durationText(t, totalMs) {
      const { hours, minutes, seconds } = durationParts(totalMs)
      if (hours > 0) return t('durationHm', { h: hours, m: minutes })
      if (minutes > 0) return t('durationM', { m: minutes })
      return t('durationS', { s: seconds })
    }

    const REASON_KEYS = {
      peak: 'reasonPeak',
      hours: 'reasonHours',
      weekend: 'reasonWeekend',
      holiday: 'reasonHoliday',
    }

    const EN = {
      statusPeak: 'Peak',
      statusOffPeak: 'Off-peak',
      peakIn: 'peak in {duration}',
      offPeakIn: 'off-peak in {duration}',
      title: 'DeepSeek API pricing',
      close: 'Close',
      peakBadge: '2× off-peak rates',
      offPeakBadge: '50% of peak rates',
      reasonPeak: 'peak hours',
      reasonHours: 'off-peak hours',
      reasonWeekend: 'weekend',
      reasonHoliday: 'Chinese public holiday',
      nextChange: 'changes {when}',
      now: 'now',
      peakColumn: 'peak',
      offPeakColumn: 'off-peak',
      peakTag: '2× rate',
      offPeakTag: '50% off',
      timelineLabel: 'Today, local time',
      localSchedule: 'Peak today: {windows}',
      noPeakToday: 'No peak hours today',
      timeRange: '{start} – {end}',
      rowCacheHit: 'input · cache hit',
      rowCacheMiss: 'input · cache miss',
      rowOutput: 'output',
      perMillion: 'Per 1M tokens',
      source: 'Pricing source',
      updated: 'updated {date}',
      holidayUnknown: 'Holiday data does not cover {year}; weekday rules only.',
      durationHm: '{h}h {m}m',
      durationM: '{m}m',
      durationS: '{s}s',
    }

    const ZH = {
      statusPeak: '高峰时段',
      statusOffPeak: '非高峰时段',
      peakIn: '{duration}后进入高峰',
      offPeakIn: '{duration}后进入非高峰',
      title: 'DeepSeek API 价格',
      close: '关闭',
      peakBadge: '价格为非高峰的 2 倍',
      offPeakBadge: '高峰价 5 折',
      reasonPeak: '高峰时段',
      reasonHours: '非高峰时段',
      reasonWeekend: '周末',
      reasonHoliday: '中国法定节假日',
      nextChange: '{when} 切换',
      now: '当前',
      peakColumn: '高峰',
      offPeakColumn: '非高峰',
      peakTag: '2 倍',
      offPeakTag: '5 折',
      timelineLabel: '今日本地时间',
      localSchedule: '今日高峰：{windows}',
      noPeakToday: '今日无高峰时段',
      timeRange: '{start} – {end}',
      rowCacheHit: '输入 · 缓存命中',
      rowCacheMiss: '输入 · 缓存未命中',
      rowOutput: '输出',
      perMillion: '每百万 tokens',
      source: '价格来源',
      updated: '更新于 {date}',
      holidayUnknown: '节假日数据未覆盖 {year} 年，仅按工作日规则计算。',
      durationHm: '{h} 小时 {m} 分',
      durationM: '{m} 分钟',
      durationS: '{s} 秒',
    }

    const CSS = [
      '.dsph-root{display:flex;justify-content:flex-end;padding:0 2px 2px}',
      '.dsph-pill{display:inline-flex;align-items:center;gap:6px;height:20px;padding:0 9px;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;white-space:nowrap;cursor:pointer;user-select:none}',
      '.dsph-pill:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsph-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dsph-dot{width:6px;height:6px;border-radius:50%;flex:none}',
      '.dsph-dot[data-tone=peak]{background:var(--dsw-alias-state-warn-primary)}',
      '.dsph-dot[data-tone=offPeak]{background:var(--dsw-alias-state-success-primary)}',
      '.dsph-status{color:var(--dsw-alias-label-secondary);font-weight:500}',
      '.dsph-count{color:var(--dsw-alias-label-tertiary)}',
      '.dsph-sep{color:var(--dsw-alias-label-caption);flex:none}',
      '.dsph-panel{position:fixed;z-index:80;box-sizing:border-box;padding:12px 14px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-panel);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);font-size:12px;line-height:18px;animation:dsph-in .12s ease-out}',
      '.dsph-panelHead{display:flex;align-items:center;gap:8px;margin-bottom:6px}',
      '.dsph-panelTitle{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dsph-close{margin-left:auto;width:20px;height:20px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:20px;cursor:pointer}',
      '.dsph-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.dsph-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dsph-statusRow{display:flex;align-items:center;gap:7px}',
      '.dsph-statusBig{font-size:13px;font-weight:600}',
      '.dsph-badge{padding:0 6px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);font-size:10px;line-height:15px;white-space:nowrap}',
      '.dsph-badge[data-tone=peak]{color:var(--dsw-alias-state-warn-primary)}',
      '.dsph-badge[data-tone=offPeak]{color:var(--dsw-alias-state-success-primary)}',
      '.dsph-remaining{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.dsph-sub{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:11px}',
      '.dsph-sectionLabel{margin-top:10px;color:var(--dsw-alias-label-caption);font-size:10px;letter-spacing:.03em;text-transform:uppercase}',
      '.dsph-track{position:relative;height:8px;margin-top:5px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
      '.dsph-seg{position:absolute;top:0;bottom:0}',
      '.dsph-seg[data-kind=peak]{background:var(--dsw-alias-state-warn-primary)}',
      '.dsph-seg[data-kind=offPeak]{background:var(--dsw-alias-state-success-tertiary)}',
      '.dsph-now{position:absolute;top:-1px;bottom:-1px;width:2px;border-radius:1px;background:var(--dsw-alias-label-primary);box-shadow:0 0 0 1px var(--dsw-alias-bg-base)}',
      '.dsph-ticks{position:relative;height:14px;margin-top:2px}',
      '.dsph-tick{position:absolute;top:0;color:var(--dsw-alias-label-caption);font-size:10px;white-space:nowrap}',
      '.dsph-schedule{margin-top:2px;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.dsph-cards{display:flex;flex-direction:column;gap:7px;margin-top:10px}',
      '.dsph-card{padding:6px 8px 7px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}',
      '.dsph-cardHead{display:flex;align-items:center;gap:6px;margin-bottom:2px}',
      '.dsph-model{font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dsph-tag{margin-left:auto;color:var(--dsw-alias-label-caption);font-size:10px;white-space:nowrap}',
      '.dsph-cols{display:grid;grid-template-columns:1fr 54px 54px;gap:6px;color:var(--dsw-alias-label-caption);font-size:9.5px}',
      '.dsph-cols span:not(:first-child){text-align:right}',
      '.dsph-row{display:grid;grid-template-columns:1fr 54px 54px;gap:6px;align-items:baseline;font-size:11px;line-height:17px}',
      '.dsph-rowLabel{color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dsph-price{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dsph-alt{text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-caption)}',
      '.dsph-foot{display:flex;align-items:center;gap:5px;margin-top:10px;color:var(--dsw-alias-label-caption);font-size:10px;flex-wrap:wrap}',
      '.dsph-link{color:var(--dsw-alias-link);text-decoration:none}',
      '.dsph-link:hover{text-decoration:underline}',
      '.dsph-warn{margin-top:6px;color:var(--dsw-alias-state-warn-label);font-size:10px}',
      '@keyframes dsph-in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}',
      '@media (prefers-reduced-motion:reduce){.dsph-panel{animation:none}}',
    ].join('')

    /** Re-render a component when the active locale or its dictionaries change. */
    function useLocaleRevision(locale) {
      const [revision, setRevision] = React.useState(() => locale.getSnapshot().revision)
      React.useEffect(() => locale.subscribe(() => setRevision(locale.getSnapshot().revision)), [locale])
      return revision
    }

    /** One price line inside a model card: active rate, then the other window's rate. */
    function PriceRow(props) {
      return h('div', { className: 'dsph-row' },
        h('span', { className: 'dsph-rowLabel', title: props.label }, props.label),
        h('span', { className: 'dsph-price' }, props.current),
        h('span', { className: 'dsph-alt' }, props.other),
      )
    }

    /** The expanded panel: status, local timeline, schedule and current prices. */
    function PeakPanel(props) {
      useLocaleRevision(props.locale)
      const t = props.locale.bind(NS)
      const language = props.locale.getSnapshot().active
      const instant = new Date(props.now)
      const status = props.status
      const day = daySegments(localDayStart(instant))
      const dayLength = day.endMs - day.startMs

      /** One instant's position inside the local day, as a percentage. */
      function ratioOfDay(ms) {
        return ((ms - day.startMs) / dayLength) * 100
      }

      const segmentNodes = day.segments.map((segment) => {
        const startText = formatClock(new Date(segment.start), language)
        const endText = formatClock(new Date(segment.end), language)
        return h('span', {
          key: segment.start,
          className: 'dsph-seg',
          'data-kind': segment.kind,
          style: { left: `${ratioOfDay(segment.start)}%`, width: `${ratioOfDay(segment.end) - ratioOfDay(segment.start)}%` },
          title: `${startText} – ${endText}`,
        })
      })

      const tickNodes = [0, 6, 12, 18, 24].map((hour) => {
        const at = hour === 24 ? day.endMs : day.startMs + hour * 3_600_000
        const percent = ratioOfDay(at)
        return h('span', {
          key: hour,
          className: 'dsph-tick',
          style: { left: `${percent}%`, transform: percent === 0 ? 'none' : percent === 100 ? 'translateX(-100%)' : 'translateX(-50%)' },
        }, formatClock(new Date(at), language))
      })

      const peakSegments = day.segments.filter((segment) => segment.kind === 'peak')
      const peakText = peakSegments.length === 0 ? t('noPeakToday') : t('localSchedule', { windows: peakSegments.map((segment) => t('timeRange', { start: formatClock(new Date(segment.start), language), end: formatClock(new Date(segment.end), language) })).join(' · ') })

      const currentKey = status.peak ? 'peak' : 'offPeak'
      const otherKey = status.peak ? 'offPeak' : 'peak'

      const cardNodes = MODELS.map((model) => h('div', { key: model.id, className: 'dsph-card' },
        h('div', { className: 'dsph-cardHead' },
          h('span', { className: 'dsph-model' }, model.id),
          h('span', { className: 'dsph-tag' }, t(status.peak ? 'peakTag' : 'offPeakTag')),
        ),
        h('div', { className: 'dsph-cols' },
          h('span', {}),
          h('span', {}, t('now')),
          h('span', {}, t(status.peak ? 'offPeakColumn' : 'peakColumn')),
        ),
        h(PriceRow, { label: t('rowCacheHit'), current: formatPrice(model.cacheHit[currentKey]), other: formatPrice(model.cacheHit[otherKey]) }),
        h(PriceRow, { label: t('rowCacheMiss'), current: formatPrice(model.cacheMiss[currentKey]), other: formatPrice(model.cacheMiss[otherKey]) }),
        h(PriceRow, { label: t('rowOutput'), current: formatPrice(model.output[currentKey]), other: formatPrice(model.output[otherKey]) }),
      ))

      const reasonLabel = t(REASON_KEYS[status.reason])
      const whenText = props.change === undefined ? '' : t('nextChange', { when: formatChange(props.change, language) })
      const subText = whenText === '' ? reasonLabel : `${reasonLabel} · ${whenText}`

      return h('div', {
        ref: props.panelRef,
        className: 'dsph-panel',
        role: 'dialog',
        'aria-label': t('title'),
        style: props.style,
      },
        h('div', { className: 'dsph-panelHead' },
          h('span', { className: 'dsph-panelTitle' }, t('title')),
          h('button', { type: 'button', className: 'dsph-close', 'aria-label': t('close'), title: t('close'), onClick: props.onClose }, '×'),
        ),
        h('div', { className: 'dsph-statusRow' },
          h('span', { className: 'dsph-dot', 'data-tone': status.peak ? 'peak' : 'offPeak' }),
          h('span', { className: 'dsph-statusBig' }, t(status.peak ? 'statusPeak' : 'statusOffPeak')),
          h('span', { className: 'dsph-badge', 'data-tone': status.peak ? 'peak' : 'offPeak' }, t(status.peak ? 'peakBadge' : 'offPeakBadge')),
          h('span', { className: 'dsph-remaining' }, props.countdown),
        ),
        h('div', { className: 'dsph-sub' }, subText),
        h('div', { className: 'dsph-sectionLabel' }, t('timelineLabel')),
        h('div', { className: 'dsph-track' },
          segmentNodes,
          h('span', { className: 'dsph-now', style: { left: `${ratioOfDay(props.now)}%` } }),
        ),
        h('div', { className: 'dsph-ticks' }, tickNodes),
        h('div', { className: 'dsph-schedule' }, peakText),
        h('div', { className: 'dsph-cards' }, cardNodes),
        h('div', { className: 'dsph-foot' },
          h('span', {}, t('perMillion')),
          h('span', { className: 'dsph-sep', 'aria-hidden': true }, '·'),
          h('a', { className: 'dsph-link', href: PRICING_SOURCE, target: '_blank', rel: 'noreferrer noopener' }, t('source')),
          h('span', { className: 'dsph-sep', 'aria-hidden': true }, '·'),
          h('span', {}, t('updated', { date: PRICING_UPDATED })),
        ),
        holidayYearsKnown(instant.getFullYear()) ? null : h('div', { className: 'dsph-warn' }, t('holidayUnknown', { year: instant.getFullYear() })),
      )
    }

    /** The status pill and, when open, its floating panel. */
    function PeakHoursPill(props) {
      useLocaleRevision(props.locale)
      const t = props.locale.bind(NS)
      const language = props.locale.getSnapshot().active
      const [now, setNow] = React.useState(() => Date.now())
      const [open, setOpen] = React.useState(false)
      const [position, setPosition] = React.useState(undefined)
      const buttonRef = React.useRef(null)
      const panelRef = React.useRef(null)

      React.useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(timer)
      }, [])

      const instant = new Date(now)
      const status = statusAt(instant)
      const change = nextChange(instant)
      const countdown = change === undefined ? '' : durationText(t, change.getTime() - now)
      const statusLabel = t(status.peak ? 'statusPeak' : 'statusOffPeak')
      const countdownLabel = countdown === '' ? '' : t(status.peak ? 'offPeakIn' : 'peakIn', { duration: countdown })
      const reasonLabel = t(REASON_KEYS[status.reason])
      const titleText = countdownLabel === '' ? `${statusLabel} · ${reasonLabel}` : `${statusLabel} · ${reasonLabel} · ${countdownLabel}`

      /** Anchor the floating panel to the pill, above it when there is room. */
      function placePanel() {
        const button = buttonRef.current
        if (button === null) return
        const rect = button.getBoundingClientRect()
        const width = Math.min(336, window.innerWidth - 16)
        const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
        if (rect.top > 260) setPosition({ left, width, bottom: window.innerHeight - rect.top + 6 })
        else setPosition({ left, width, top: rect.bottom + 6 })
      }

      function toggle() {
        if (open) {
          setOpen(false)
          return
        }
        placePanel()
        setOpen(true)
      }

      function closePanel() {
        setOpen(false)
        if (buttonRef.current !== null) buttonRef.current.focus()
      }

      React.useEffect(() => {
        if (!open) return undefined
        placePanel()
        function onPointerDown(event) {
          const target = event.target
          if (!(target instanceof Node)) return
          if (panelRef.current !== null && panelRef.current.contains(target)) return
          if (buttonRef.current !== null && buttonRef.current.contains(target)) return
          setOpen(false)
        }
        function onKeyDown(event) {
          if (event.key !== 'Escape') return
          setOpen(false)
          if (buttonRef.current !== null) buttonRef.current.focus()
        }
        window.addEventListener('resize', placePanel)
        window.addEventListener('scroll', placePanel, true)
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          window.removeEventListener('resize', placePanel)
          window.removeEventListener('scroll', placePanel, true)
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open])

      return h(React.Fragment, null,
        h('div', { className: 'dsph-root' },
          h('button', {
            ref: buttonRef,
            type: 'button',
            className: 'dsph-pill',
            'aria-haspopup': 'dialog',
            'aria-expanded': open ? 'true' : 'false',
            title: titleText,
            onClick: toggle,
          },
            h('span', { className: 'dsph-dot', 'data-tone': status.peak ? 'peak' : 'offPeak' }),
            h('span', { className: 'dsph-status' }, statusLabel),
            countdownLabel === '' ? null : h('span', { className: 'dsph-sep', 'aria-hidden': true }, '·'),
            countdownLabel === '' ? null : h('span', { className: 'dsph-count' }, countdownLabel),
          ),
        ),
        open && position !== undefined ? ReactDOM.createPortal(
          h(PeakPanel, {
            locale: props.locale,
            now,
            status,
            change,
            countdown: countdownLabel,
            style: position,
            onClose: closePanel,
            panelRef,
          }),
          document.body,
        ) : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = 'dsh-deepseek-peak-hours'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'deepseek-peak-hours: styles')
        ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'deepseek-peak-hours: dictionaries')
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'deepseek-peak-hours',
          order: 5,
        }, (props) => h(PeakHoursPill, { ...props, locale: ctx.locale })))
      },
    }
  },
})
