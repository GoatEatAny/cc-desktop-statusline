// cc-desktop-statusline: a band above the Claude Code prompt showing plan limits, this month's
// cost and activity, context use, session cost, what a cache miss would cost, and a /compact button.
//
// Everything is computed locally: scripts/usage.py reads the transcripts on disk,
// and the plan limits come from Claude Code itself. No network calls; the band itself makes no model calls.

import type { EngineInterface, Register } from 'claude-code'

// What scripts/usage.py prints. Costs are API-equivalent USD; `miss` is null when unknown.
type Period = 'session' | 'last' | 'month'
type Cache = { lastTs: number | null; miss: number | null }
type Usage = {
  usd: Record<Period, number>
  unpriced: Record<Period, boolean>
  daily: number[]
  day: number
  month: number
  tzOffsetSec: number
  cache: Cache
}
type Window = { percent: number; resetsAt?: string }
type Context = { tokens?: number; window: number; percent?: number }

// Why usage.py cannot run here, shown in the band instead of the numbers.
type Blocked = 'windows' | 'no-python' | 'failed'

// On a Claude subscription the conversation cache lives for one hour (it can be shorter past usage limits).
const CACHE_TTL_S = 60 * 60

// The monthly activity grid: one cell per day, right of this month's cost. Set to false to hide it.
const SHOW_ACTIVITY = true

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Decide once per session whether python3 can run. On macOS without the Command Line Tools,
// /usr/bin/python3 is a stub that opens an installer dialog on every call, so check for that first.
async function checkPython($: EngineInterface): Promise<Blocked | null> {
  if ((await $.env.get('OS')) === 'Windows_NT') return 'windows'
  try {
    const probe = 'p=$(command -v python3) || exit 1; '
      + 'if [ "$p" = /usr/bin/python3 ] && [ "$(uname)" = Darwin ]; then xcode-select -p >/dev/null 2>&1 || exit 1; fi'
    const { exitCode } = await $.process.run(['/bin/sh', '-c', probe], { timeoutMs: 5000 })
    return exitCode === 0 ? null : 'no-python'
  } catch {
    return 'no-python'
  }
}

// usage.py ships next to hooks/. Look beside $.plugin.root first, then one level up,
// in case the host reports the .claude-plugin/ directory as the root.
async function scriptPath($: EngineInterface): Promise<string> {
  const root = $.plugin.root
  const direct = `${root}/scripts/usage.py`
  return (await $.fs.exists(direct)) ? direct : `${root}/../scripts/usage.py`
}

async function readUsage($: EngineInterface, script: string): Promise<Usage | null> {
  try {
    const sid = await $.session.id()
    const { exitCode, stdout } = await $.process.run(['python3', script, sid], { timeoutMs: 120_000 })
    return exitCode === 0 ? (JSON.parse(stdout) as Usage) : null
  } catch {
    return null
  }
}

function limitOf(limits: readonly { kind: string; percentUsed: number; resetsAt?: string }[], kind: string): Window | null {
  const w = limits.find(l => l.kind === kind)
  return w === undefined ? null : { percent: w.percentUsed, resetsAt: w.resetsAt }
}

function usd(n: number): string {
  if (n >= 100) return `$${Math.round(n)}`
  if (n >= 10) return `$${n.toFixed(1)}`
  return `$${n.toFixed(2)}`
}

// A cost, marked with "?" when part of it came from a model the price table does not know.
function cost(u: Usage, period: Period): string {
  return usd(u.usd[period]) + (u.unpriced[period] ? '?' : '')
}

// Shift an instant into the local zone reported by usage.py, then read it with the UTC getters.
function local(ms: number, offsetSec: number): Date {
  return new Date(ms + offsetSec * 1000)
}

function localTime(iso: string, offsetSec: number): string {
  const d = local(Date.parse(iso), offsetSec)
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

function localDay(iso: string, offsetSec: number): string {
  const d = local(Date.parse(iso), offsetSec)
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

function cacheExpired(c: Cache, nowMs: number): boolean {
  return c.lastTs !== null && nowMs / 1000 - c.lastTs > CACHE_TTL_S
}

function missCost(c: Cache): string {
  return c.miss === null ? '-' : usd(c.miss)
}

function bar(ratio: number, cells: number): string {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * cells)
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

// Status colors (good / warning / critical). Always drawn next to the number, never alone.
function statusColor(percent: number): string {
  if (percent >= 80) return '#e5534b'
  if (percent >= 50) return '#d4a72c'
  return '#3fb950'
}

const SVG_STYLE = '<style>.t{stroke:#d0d7de}.i{stroke:#6e7781;fill:none}.it{fill:#6e7781}.a{stroke:#0969da}.at{fill:#0969da}'
  + '@media (prefers-color-scheme:dark){.t{stroke:#30363d}.i{stroke:#8b949e}.it{fill:#8b949e}.a{stroke:#4493f8}.at{fill:#4493f8}}</style>'

type Icon = 'context' | 'clock' | 'calendar' | 'dollar' | 'hourglass'

// An ~8px glyph drawn inside a ring. `stroke` and `fill` are the attributes that color its lines and solids.
function iconSvg(icon: Icon, stroke: string, fill: string): string {
  const line = `${stroke} stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"`
  switch (icon) {
    case 'context':
      return `<path ${line} d="M5.5 6H10.5M5.5 8H10.5M5.5 10H8.5"/>`
    case 'clock':
      return `<path ${line} d="M8 8V5.2M8 8H10.3"/>`
    case 'calendar':
      return `<rect ${line} x="5" y="5.6" width="6" height="5" rx="1"/><path ${line} d="M5 7.4H11M6.6 4.6V6M9.4 4.6V6"/>`
    case 'hourglass':
      // The cache only lasts so long.
      return `<path ${line} d="M5.6 4.8H10.4M5.6 11.2H10.4M6.3 4.8C6.3 7 9.7 8.9 9.7 11.2M9.7 4.8C9.7 7 6.3 9 6.3 11.2"/>`
    case 'dollar':
      return `<text x="8" y="10.9" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="8.5" font-weight="700" ${fill}>$</text>`
  }
}

// A 16px usage ring with a glyph inside. Fills clockwise from 12 o'clock; the glyph takes the ring's color.
function ringSvg(percent: number | undefined, icon: Icon): string {
  const color = percent === undefined ? undefined : statusColor(percent)
  const arc = percent === undefined ? ''
    : `<circle cx="8" cy="8" r="6.6" fill="none" stroke="${color}" stroke-width="1.8" pathLength="100" stroke-dasharray="${Math.max(0, Math.min(100, percent))} 100" stroke-linecap="round" transform="rotate(-90 8 8)"/>`
  const glyph = color === undefined ? iconSvg(icon, 'class="i"', 'class="it"') : iconSvg(icon, `stroke="${color}"`, `fill="${color}"`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">${SVG_STYLE}<circle class="t" cx="8" cy="8" r="6.6" fill="none" stroke-width="1.8"/>${arc}${glyph}</svg>`
}

// A marker for values that are not a share of anything: a closed ring in the accent color.
function badgeSvg(icon: Icon): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">${SVG_STYLE}<circle class="a" cx="8" cy="8" r="6.6" fill="none" stroke-width="1.8"/>${iconSvg(icon, 'class="a"', 'class="at"')}</svg>`
}

// This month's activity, one cell per day like GitHub's contribution graph: 3 rows,
// filled top to bottom then left to right. Shade = share of the month's busiest day, 4 steps.
// Blue rather than green, so it never reads as a status color. Today is lightened; days ahead are dimmed.
const HEAT_LIGHT = ['#e1e4e8', '#b6d4fe', '#6ea8fe', '#3d8bfd', '#0a58ca']
const HEAT_DARK = ['#444b55', '#1f4b8f', '#2f6fd0', '#4b90f0', '#8cc4ff']
const CELL = 5
const GAP = 1
const ROWS = 3
const HEAT_H = ROWS * (CELL + GAP) - GAP + 1

function heatLevel(v: number, peak: number): number {
  if (v <= 0 || peak <= 0) return 0
  const r = v / peak
  return r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1
}

function heatWidth(days: number): number {
  return Math.ceil(days / ROWS) * (CELL + GAP) - GAP + 1
}

function heatSvg(daily: number[], today: number): string {
  const peak = Math.max(0, ...daily)
  const css = HEAT_LIGHT.map((c, k) => `.h${k}{fill:${c}}`).join('')
    + `.f{fill:${HEAT_LIGHT[0]};opacity:.4}.o{fill:#fff;opacity:.35}`
    + '@media (prefers-color-scheme:dark){' + HEAT_DARK.map((c, k) => `.h${k}{fill:${c}}`).join('')
    + `.f{fill:${HEAT_DARK[0]};opacity:.4}.o{opacity:.3}}`
  const cells: string[] = []
  daily.forEach((v, k) => {
    const x = 0.5 + Math.floor(k / ROWS) * (CELL + GAP)
    const y = 0.5 + (k % ROWS) * (CELL + GAP)
    const cls = k + 1 > today ? 'f' : `h${heatLevel(v, peak)}`
    cells.push(`<rect class="${cls}" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="1"/>`)
    if (k + 1 === today) cells.push(`<rect class="o" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="1"/>`)
  })
  const w = heatWidth(daily.length)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${HEAT_H}" viewBox="0 0 ${w} ${HEAT_H}"><style>${css}</style>${cells.join('')}</svg>`
}

function blockedText(b: Blocked): string {
  switch (b) {
    case 'windows':
      return 'cc-desktop-statusline: Windows is not supported yet'
    case 'no-python':
      return 'cc-desktop-statusline: needs python3 (macOS: xcode-select --install)'
    case 'failed':
      return 'cc-desktop-statusline: could not read usage (run scripts/usage.py to see why)'
  }
}

type State = {
  usage: Usage | null
  ctx: Context | null
  window5h: Window | null
  window7d: Window | null
  blocked: Blocked | null
  script: string
  compacting: boolean
}

async function refresh($: EngineInterface, st: State): Promise<void> {
  const u = await $.session.usage()
  st.ctx = u.context
  st.window5h = limitOf(u.rateLimits, 'five_hour')
  st.window7d = limitOf(u.rateLimits, 'seven_day')
  if (st.blocked === null || st.blocked === 'failed') {
    if (st.script === '') st.script = await scriptPath($)
    st.usage = await readUsage($, st.script)
    st.blocked = st.usage === null ? 'failed' : null
  }
  $.ui.invalidate('ui.render')
}

// Runs /compact, exactly as if typed. Only offered between turns.
// ($.session.compact() is not available where Claude Code runs headless, as in the desktop app,
// and $.prompt.submit refuses slash commands, so the command itself is run.)
async function compact($: EngineInterface, st: State): Promise<void> {
  st.compacting = true
  $.ui.invalidate('ui.render')
  try {
    await $.command.run({ command: 'compact' })
  } catch (err) {
    $.ui.toast(`Could not compact (${err instanceof Error ? err.message : String(err)}). Type /compact instead.`)
  } finally {
    st.compacting = false
    await refresh($, st)
  }
}

async function tick($: EngineInterface, st: State): Promise<void> {
  const u = st.usage
  if (u !== null) {
    const d = local(await $.clock.now(), u.tzOffsetSec)
    if (d.getUTCDate() !== u.day || d.getUTCMonth() + 1 !== u.month) {
      await refresh($, st)
      return
    }
  }
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  const st: State = {
    usage: null, ctx: null, window5h: null, window7d: null, blocked: null, script: '', compacting: false,
  }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // Once a minute: redraw so an idle band notices the cache expiring, and re-read usage when the
    // local date has rolled over so the month and today's cell move on (local work only, no tokens).
    $.clock.every(60_000, () => tick($, st))
    st.blocked = await checkPython($)
    await refresh($, st)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($, st)
    return next(e)
  })

  // /clear starts over without a new session.start: drop the old session's figures and re-read.
  on('command.run', { command: 'clear' }, async ($, e, next) => {
    const result = await next(e)
    st.usage = null
    await refresh($, st)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { usage, ctx, window5h, window7d, blocked } = st
    // Before the first usage.py run, fall back to the machine's offset as seen by this environment.
    const offset = usage?.tzOffsetSec ?? -new Date().getTimezoneOffset() * 60
    const nowMs = await $.clock.now()
    const expired = usage !== null && cacheExpired(usage.cache, nowMs)
    const canCompact = !e.props.isWorking && !st.compacting
    const dash = '-'

    if (e.surface === 'desktop') {
      const { Box, Text, Svg, Button } = $.ui.resolve(e)
      const v = (x: string) => <Text bold dimColor={false}>{x}</Text>
      const monthName = MONTHS[(usage?.month ?? local(nowMs, offset).getUTCMonth() + 1) - 1]
      return (
        // Widest scope first: plan limits, this month, then this session ending in its action.
        <Box flexDirection="row" alignItems="center" flexWrap="wrap" columnGap={3}>
          <Box flexDirection="row" alignItems="center" columnGap={1}>
            <Svg source={ringSvg(window5h?.percent, 'clock')} width={16} height={16} alt={`5-hour limit ${window5h?.percent ?? dash}%`} />
            <Text dimColor>
              5h {v(window5h === null ? dash : `${window5h.percent}%`)}{window5h?.resetsAt === undefined ? '' : ` · ↻ ${localTime(window5h.resetsAt, offset)}`}
            </Text>
          </Box>
          <Box flexDirection="row" alignItems="center" columnGap={1}>
            <Svg source={ringSvg(window7d?.percent, 'calendar')} width={16} height={16} alt={`7-day limit ${window7d?.percent ?? dash}%`} />
            <Text dimColor>
              7d {v(window7d === null ? dash : `${window7d.percent}%`)}{window7d?.resetsAt === undefined ? '' : ` · ↻ ${localDay(window7d.resetsAt, offset)}`}
            </Text>
          </Box>
          {blocked !== null ? (
            <Text dimColor>{blockedText(blocked)}</Text>
          ) : (
            <Box flexDirection="row" alignItems="center" columnGap={1}>
              <Svg source={badgeSvg('dollar')} width={16} height={16} alt="API-equivalent cost this month" />
              <Text dimColor>{monthName} {v(usage === null ? dash : cost(usage, 'month'))}</Text>
              {usage === null || !SHOW_ACTIVITY ? null : (
                <Svg source={heatSvg(usage.daily, usage.day)} width={heatWidth(usage.daily.length)} height={HEAT_H} alt="Tokens per day this month" />
              )}
            </Box>
          )}
          <Text dimColor>|</Text>
          <Box flexDirection="row" alignItems="center" columnGap={1}>
            <Svg source={ringSvg(ctx?.percent, 'context')} width={16} height={16} alt={`Context ${ctx?.percent ?? dash}%`} />
            <Text dimColor>
              Sess {v(ctx?.percent === undefined ? dash : `${ctx.percent}%`)} · {usage === null ? dash : `${cost(usage, 'session')} (+${cost(usage, 'last')})`}
            </Text>
          </Box>
          <Box flexDirection="row" alignItems="center" columnGap={1}>
            {usage === null ? null : <Svg source={badgeSvg('hourglass')} width={16} height={16} alt="What a cache miss would cost" />}
            {usage === null ? null : expired
              ? <Text color="#d4a72c">Cache expired · next {missCost(usage.cache)}</Text>
              : <Text dimColor>Cache miss {v(missCost(usage.cache))}</Text>}
            {canCompact ? <Button key="compact" label="/compact" onPress={() => compact($, st)} /> : null}
            {st.compacting ? <Text dimColor>compacting…</Text> : null}
          </Box>
        </Box>
      )
    }

    // Other surfaces: one line of text, plus the /compact button.
    const { Box, Text, Button } = $.ui.resolve(e)
    const parts: string[] = []
    if (window5h !== null) parts.push(`5h ${bar(window5h.percent / 100, 8)} ${window5h.percent}%`)
    if (window7d !== null) parts.push(`7d ${bar(window7d.percent / 100, 8)} ${window7d.percent}%`)
    if (usage !== null) parts.push(`${MONTHS[usage.month - 1]} ${cost(usage, 'month')}`)
    if (blocked !== null) parts.push(blockedText(blocked))
    if (ctx?.percent !== undefined) parts.push(`Sess ${bar(ctx.percent / 100, 8)} ${ctx.percent}%`)
    if (usage !== null) {
      parts.push(`${cost(usage, 'session')} (+${cost(usage, 'last')})`)
      parts.push(expired ? `Cache expired · next ${missCost(usage.cache)}` : `Cache miss ${missCost(usage.cache)}`)
    }
    if (parts.length === 0) {
      return next(e)
    }
    return (
      <Box flexDirection="row" columnGap={1}>
        <Text dimColor wrap="truncate-end">{parts.join(' · ')}</Text>
        {canCompact ? <Button key="compact" label="/compact" onPress={() => compact($, st)} /> : null}
      </Box>
    )
  })
}
