import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { buildPet, checkPet, coatsFor, inspectPet, type PetSpec } from './pet-kit.ts'
import { CAT } from './pets/cat.ts'

const BAND = {
  plugin: 'pixel-pet',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const START = { cwd: '/tmp', surface: 'desktop', isInteractive: true } as const

// The engine's own answers, beneath the plugin.
// The status band beneath the pet, as a test draws it: by default a single line of text.
type Band = Parameters<On>[2]

// The readings the pet takes after a session starts or a turn ends run on the clock, just
// after; this lets them run.
let lastClock: ReturnType<typeof mock.clock>
// A /clear starts a conversation with no calls yet: usage.py then has no last call to report.
let cleared = false
const settle = () => lastClock.advance(1)

function engine(on: On, usd = 1.234, band?: Band, contextPct?: number) {
  const clock = mock.clock(on, { now: 1_000_000 })
  lastClock = clock
  cleared = false
  // Most tests are about the pets; a new install starts on the status band (tested below).
  mock.store(on, { mode: 'pet' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', band ?? (($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>status band</Text>
  }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  // A /compact lightens the context, as the real one does.
  let pct = contextPct
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: pct }, rateLimits: [{ kind: 'five_hour', percentUsed: 32 }], cost: { usd } } }) as never)
  on('command.run', ($, e) => {
    if (e.command === 'compact' && pct !== undefined) pct = Math.min(pct, 10)
    if (e.command === 'clear') cleared = true
    return { text: `ran /${e.command}` }
  })
  return clock
}

// The pet's mood on the desktop, read from the sprite's alt text (no line is drawn there).
async function mood(ui: { find: (q: { type: string }) => Promise<{ props: Record<string, unknown> } | undefined> }) {
  return String((await ui.find({ type: 'Svg' }))?.props.alt ?? '')
}

const TURN = { answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as const

test('the cat idles, cheers after a turn, and the button switches to stats and back', async ($, on) => {
  const clock = engine(on)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await mood(ui)).toMatch(/ごろごろ/)

  await $.turn.complete(TURN)
  await settle()
  expect(await mood(ui)).toMatch(/にゃーん/)
  // the session's cost, dollar sign only, as the status band writes it
  const pictures = (await ui.findAll({ type: 'Svg' })).map(p => String(p.props.source))
  expect(pictures.some(x => x.includes('>$1.23</text>'))).toBe(true)
  expect(await ui.find({ key: 'herd-label' })).toBeDefined()
  // no level any more: the herd size stands for how far the session has gone
  expect(await ui.find({ type: 'Text', text: /Lv\./ })).toBeUndefined()
  // the pet view carries no usage figures and no line of text beside the pet
  expect(await ui.find({ type: 'Text', text: /5h|Sess/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /にゃーん/ })).toBeUndefined()

  await clock.advance(7_000)
  expect(await mood(ui)).toMatch(/ごろごろ/)

  expect((await ui.find({ key: 'toggle-view' }))?.text).toBe('◒')
  await ui.press({ key: 'toggle-view' })
  expect((await ui.find({ key: 'toggle-view' }))?.text).toBe('◓')
  expect(await ui.find({ type: 'Text', text: /status band/ })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()

  await ui.press({ key: 'toggle-view' })
  expect(await mood(ui)).toMatch(/ごろごろ/)
  expect((await ui.find({ key: 'toggle-view' }))?.text).toBe('◒')
  await ui.unmount()
})

test('a subagent turn does not feed the cat', async ($, on) => {
  engine(on)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await $.turn.complete({ ...TURN, agentId: 'a1' })
  expect(await mood(ui)).toMatch(/ごろごろ/)
  await ui.unmount()
})

test('the terminal gets a kaomoji instead of the SVG', async ($, on) => {
  engine(on)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /=\^\.\^=/ })).toBeDefined()
  await ui.unmount()
})

test('left alone for ten minutes, the cat falls asleep', async ($, on) => {
  const clock = engine(on)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await clock.advance(11 * 60_000)
  expect(await mood(ui)).toMatch(/すやすや/)
  await ui.unmount()
})

// The herd grows as the session's cost passes each step ($0.5, $2.5, $5.5, $10, ... $50), ten at most.
for (const [usd, cats] of [[0, 1], [0.49, 1], [0.5, 2], [5.5, 4], [21.99, 6], [22, 7], [49.99, 9], [50, 10], [500, 10]] as const) {
  test(`at $${usd} the band shows ${cats} cat(s)`, async ($, on) => {
    engine(on, usd)
    await $.session.start(START)
  await settle()
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await mood(ui)).toMatch(new RegExp(`猫 ${cats}匹`))
    await ui.unmount()
  })
}

test('in the stats view, the status band\'s items are spaced one cell apart', async ($, on) => {
  engine(on, 1.234, (($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
        <Text>5h</Text>
        <Text>Oct</Text>
        <Text>|</Text>
        <Text>Sess</Text>
      </Box>
    )
  }) as Band)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'toggle-view' })
  const gaps = (await ui.findAll({ type: 'Box' })).map(b => b.props.columnGap)
  // the band's row now spaces every item, the "|" included, one cell apart
  expect(gaps).toContain(1)
  expect(gaps).not.toContain(3)
  expect(await ui.find({ type: 'Text', text: /^\|$/ })).toBeDefined()
  await ui.unmount()
})

test('after a finished turn only two or three of the herd send hearts', async ($, on) => {
  engine(on, 60)
  await $.session.start(START)
  await settle()
  await $.turn.complete(TURN)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  // each cheering pet's hearts carry one opacity and one rise animation that start at 0s
  const cheering = (source.match(/begin="-0\.00s"/g) ?? []).length / 2
  expect(await mood(ui)).toMatch(/10匹/)
  expect(cheering >= 2 && cheering <= 3).toBe(true)
  await ui.unmount()
})

test('a heavy context: a beckoning cat saying /compact in a bubble sits right of the bar, as the button', async ($, on) => {
  engine(on, 1.234, undefined, 72)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const pictures = await ui.findAll({ type: 'Svg' })
  const at = pictures.findIndex(p => String(p.props.alt).includes('招き猫') && String(p.props.source).includes('/compact</text>'))
  expect(at).toBeGreaterThan(0)
  // the bar ends the track picture; the cost follows the cat
  expect(String(pictures[at - 1].props.source)).toContain('class="bar"')
  expect(String(pictures[at + 1].props.source)).toContain('>$1.23</text>')
  expect(await ui.find({ key: 'maneki' })).toBeDefined()
  expect(await ui.find({ key: 'compact' })).toBeUndefined()
  await ui.unmount()
})

test('pressing the beckoning cat compacts and the herd gets its fish', async ($, on) => {
  // the spy sits above the engine's own answer, so it sees the run
  const ran: string[] = []
  on('command.run', { command: 'compact' }, ($, e, next) => { ran.push(e.command); return next(e) })
  engine(on, 1.234, undefined, 72)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'maneki' })
  expect(ran).toEqual(['compact'])
  expect(await mood(ui)).toMatch(/もぐもぐ/)
  expect(await ui.find({ key: 'maneki' })).toBeUndefined()
  await ui.unmount()
})

test('a light context: no ticket', async ($, on) => {
  engine(on, 1.234, undefined, 35)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.findAll({ type: 'Svg' })).some(p => String(p.props.alt).includes('招き猫'))).toBe(false)
  expect(await ui.find({ key: 'compact' })).toBeUndefined()
  await ui.unmount()
})

test('a typed /compact also earns the reward', async ($, on) => {
  const clock = engine(on, 1.234, undefined, 35)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await $.command.run({ command: 'compact', args: '' } as never)
  expect(await mood(ui)).toMatch(/もぐもぐ/)
  await clock.advance(11_000)
  expect(await mood(ui)).not.toMatch(/もぐもぐ/)
  await ui.unmount()
})

// usage.py, as the band runs it: the last API call at the clock's start, a miss costing $3.20.
function usageScript(on: On, last = 0) {
  on('env.get', () => ({ value: undefined }) as never)
  on('session.id', () => ({ value: 'sid' }) as never)
  on('fs.exists', () => ({ value: true }) as never)
  on('process.run', ($, e) => ({ value: e.argv[0] === 'python3'
    ? { exitCode: 0, stdout: JSON.stringify(cleared ? { usd: { session: 0, last: 0 }, cache: { lastTs: null, miss: null } } : { usd: { session: 1.234, last }, cache: { lastTs: 1_000, miss: 3.2 } }), stderr: '' }
    : { exitCode: 0, stdout: '', stderr: '' } }) as never)
}

test('an hour after the last call the cache is cold: the herd sleeps under futons, and the beckoning cat prices carrying on against /clear', async ($, on) => {
  const clock = engine(on, 1.234, undefined, 20)
  usageScript(on)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await mood(ui)).not.toMatch(/キャッシュ切れ/)
  expect(await ui.find({ key: 'maneki' })).toBeUndefined()
  await clock.advance(61 * 60_000)
  expect(await mood(ui)).toMatch(/キャッシュ切れ/)
  const sources = (await ui.findAll({ type: 'Svg' })).map(p => String(p.props.source))
  expect(sources[0]).toContain('#d0463e')
  // a light context, but $3.20 to carry on: worth offering /clear, the price in the bubble
  const bubble = sources.find(x => x.includes('/clear</text>'))
  expect(bubble).toContain('>+$3.20</text>')
  expect(sources.some(x => x.includes('next +'))).toBe(false)
  expect(await ui.find({ key: 'maneki' })).toBeDefined()
  await ui.unmount()
})

test('a cold cache on a heavy context: the beckoning cat says /clear, and pressing it clears', async ($, on) => {
  const ran: string[] = []
  on('command.run', { command: 'clear' }, ($, e, next) => { ran.push(e.command); return next(e) })
  const clock = engine(on, 1.234, undefined, 72)
  usageScript(on)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await clock.advance(61 * 60_000)
  const pictures = await ui.findAll({ type: 'Svg' })
  expect(pictures.some(p => String(p.props.source).includes('/clear</text>'))).toBe(true)
  await ui.press({ key: 'maneki' })
  expect(ran).toEqual(['clear'])
  expect(await mood(ui)).not.toMatch(/キャッシュ切れ/)
  await ui.unmount()
})

for (const [last, tier, startled] of [[0.42, 'cn0', false], [0.8, 'cn1', false], [2.5, 'cn2', true]] as const) {
  test(`a $${last} turn: its cost floats up as a ${tier} coin${startled ? ', and the cheering cats are startled' : ''}`, async ($, on) => {
    const clock = engine(on)
    usageScript(on, last)
    await $.session.start(START)
  await settle()
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    await $.turn.complete(TURN)
  await settle()
    const source = String((await ui.find({ type: 'Svg' }))?.props.source)
    expect(source).toContain(`class="${tier}"`)
    expect(source).toContain(`>+$${last.toFixed(2)}</text>`)
    expect(source.includes('fill="#f85149" opacity="0"')).toBe(startled)
    await clock.advance(7_000)
    expect(String((await ui.find({ type: 'Svg' }))?.props.source)).not.toContain(`>+$${last.toFixed(2)}</text>`)
    await ui.unmount()
  })
}

test('pressing the figure beside the bar opens a menu of measures; a pick sets the herd size and is kept', async ($, on) => {
  engine(on, 1.234, undefined, 45)
  usageScript(on)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await mood(ui)).toMatch(/ 2匹/)
  await ui.press({ key: 'herd-label' })
  const items = []
  for (const id of ['cost', 'efficiency', 'context', 'turns', 'quota']) items.push((await ui.find({ key: `metric-${id}` }))?.text)
  expect(items).toEqual(['$1.23', 'eff -', 'ctx 45%', '0 turns', '5h 68% left'])
  // the cats step aside while the menu is open
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.press({ key: 'metric-quota' })
  expect(await ui.find({ key: 'metric-quota' })).toBeUndefined()
  // 68% left of the 5-hour limit: 1 + floor(0.68 x 9) = 7 cats
  expect(await mood(ui)).toMatch(/ 7匹/)
  expect((await ui.findAll({ type: 'Svg' })).some(p => String(p.props.source).includes('>5h 68% left</text>'))).toBe(true)
  await ui.press({ key: 'herd-label' })
  await ui.press({ key: 'metric-context' })
  expect(await mood(ui)).toMatch(/ 5匹/)
  await ui.unmount()
  // kept across sessions
  await $.session.start(START)
  await settle()
  const again = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await mood(again)).toMatch(/ 5匹/)
  await again.unmount()
})

test('coats are dealt at random each session, nine ordinary ones first and the ultra coat tenth', async ($, on) => {
  const coatsAt = async (usd: number) => {
    engine(on, usd)
    await $.session.start(START)
  await settle()
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const source = String((await ui.find({ type: 'Svg' }))?.props.source)
    await ui.unmount()
    return [...source.matchAll(/\.cl(\d)\{/g)].map(m => Number(m[1]))
  }
  const four = await coatsAt(5.5)
  expect(four.length).toBe(4)
  expect(new Set(four).size).toBe(4)
  expect(four.includes(9)).toBe(false)
})

test('when the herd grows or shrinks, the cats that come or go do so in a puff of smoke', async ($, on) => {
  const clock = engine(on, 1.234, undefined, 45)
  usageScript(on)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const smoky = async () => String((await ui.find({ type: 'Svg' }))?.props.source).includes('class="smk"')
  expect(await smoky()).toBe(false)
  // Context at 45%: 5 cats, up from 2
  await ui.press({ key: 'herd-label' })
  await ui.press({ key: 'metric-context' })
  expect(await mood(ui)).toMatch(/ 5匹/)
  expect(await smoky()).toBe(true)
  await clock.advance(1_000)
  expect(await smoky()).toBe(false)
  // and back down to 2
  await ui.press({ key: 'herd-label' })
  await ui.press({ key: 'metric-cost' })
  expect(await smoky()).toBe(true)
  await ui.unmount()
})

test('an interrupted turn made calls too: it keeps the cache warm, without a cheer', async ($, on) => {
  const clock = engine(on, 1.234, undefined, 20)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await clock.advance(50 * 60_000)
  await $.turn.complete({ ...TURN, reason: 'aborted' })
  await settle()
  expect(await mood(ui)).not.toMatch(/にゃーん/)
  await clock.advance(15 * 60_000)
  expect(await mood(ui)).not.toMatch(/キャッシュ切れ/)
  await ui.unmount()
})

test('asleep on a heavy context, the beckoning cat still offers /compact', async ($, on) => {
  const clock = engine(on, 1.234, undefined, 72)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await clock.advance(15 * 60_000)
  expect(await mood(ui)).toMatch(/すやすや/)
  expect(await ui.find({ key: 'maneki' })).toBeDefined()
  expect((await ui.findAll({ type: 'Svg' })).some(p => String(p.props.source).includes('/compact</text>'))).toBe(true)
  await ui.unmount()
})

test('ten cats cheering, with smoke, on a very wide band stay within the desktop picture limit', async ($, on) => {
  engine(on, 500, undefined, 20)
  usageScript(on)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, bodyColumns: 420 } })
  // down to 1 cat (no turns yet) and back up to 10: smoke for nine newcomers
  await ui.press({ key: 'herd-label' })
  await ui.press({ key: 'metric-turns' })
  await ui.press({ key: 'herd-label' })
  await ui.press({ key: 'metric-cost' })
  await $.turn.complete(TURN)
  await settle()
  for (const p of await ui.findAll({ type: 'Svg' })) expect(String(p.props.source).length).toBeLessThanOrEqual(131_072)
  await ui.unmount()
})

// the belly reaching row 11 (the ground) only from 60%; the back rounding at row 4 from 80%
for (const [pct, ground, back] of [[20, false, false], [65, true, false], [85, true, true]] as const) {
  test(`at ${pct}% context the cats are ${ground ? (back ? 'round' : 'chubby') : 'slim'}`, async ($, on) => {
    engine(on, 1.234, undefined, pct)
    await $.session.start(START)
    await settle()
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const source = String((await ui.find({ type: 'Svg' }))?.props.source)
    const trunk = source.slice(source.indexOf('<g id="t'), source.indexOf('</defs>'))
    expect(/M\d+ 11h/.test(trunk)).toBe(ground)
    expect(/M2 4h2/.test(trunk)).toBe(back)
    await ui.unmount()
  })
}

test('a /clear right after a turn: the turn\'s late readings do not bring the old conversation back', async ($, on) => {
  const clock = engine(on, 1.234, undefined, 20)
  usageScript(on)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await $.turn.complete(TURN)
  // the turn's usage.py read has not come back yet
  await $.command.run({ command: 'clear', args: '' } as never)
  await settle()
  await clock.advance(61 * 60_000)
  expect(await mood(ui)).not.toMatch(/キャッシュ切れ/)
  expect(await ui.find({ key: 'maneki' })).toBeUndefined()
  await ui.unmount()
})

test('on a band too narrow for the beckoning cat, the one cat stays on the track', async ($, on) => {
  engine(on, 0.2, undefined, 72)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, bodyColumns: 40 } })
  expect(await ui.find({ key: 'maneki' })).toBeUndefined()
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('<g id="t0">')
  await ui.unmount()
})

test('counting turns, a newcomer arrives in smoke at once, not when usage.py answers', async ($, on) => {
  engine(on, 1.234, undefined, 20)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'herd-label' })
  await ui.press({ key: 'metric-turns' })
  // 9 turns in: the 10th is the second cat
  for (let k = 0; k < 9; k++) { await $.turn.complete(TURN); await settle() }
  await lastClock.advance(2_000)
  await $.turn.complete(TURN)
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('class="smk"')
  await ui.unmount()
})

test('a chubby cat asleep lies on the ground without sinking below the picture', async ($, on) => {
  const clock = engine(on, 1.234, undefined, 85)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await clock.advance(15 * 60_000)
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('<g transform="translate(0 0)"><use')
  expect(source).not.toContain('<g transform="translate(0 2)"><use')
  await ui.unmount()
})

// The cat was moved from code to a data file (pets/cat.ts) drawn by pet-kit.ts. Every pose, mood,
// coat and roundness, its colors, its figurine and its futon tail hash to what the code drew
// before the move, so new pets or kit changes cannot quietly change how the cat looks.
const fnv = (s: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16)
}
const MOODS = ['reward', 'happy', 'working', 'sleep', 'idle'] as const
const POSES = ['run', 'jump', 'stand', 'roll', 'stretch', 'groom', 'scratch', 'slump', 'eat', 'beckon'] as const

test('the cat, drawn from its data, looks exactly as it did', () => {
  const cat = buildPet(CAT)
  let all = ''
  for (let coat = 0; coat < 10; coat++) {
    all += cat.css(coat, 1000)
    for (const m of MOODS) for (let fat = 0; fat <= 3; fat++) {
      all += cat.trunk(m, coat, fat)
      for (const p of POSES) all += cat.body(m, coat, p, '<use href="#t0"/>', fat)
    }
  }
  let extra = cat.maneki()
  for (let c = 0; c < 10; c++) extra += cat.futonTail(c)
  expect(cat.coats).toBe(10)
  expect(fnv(all)).toBe('4adc4d47')
  expect(fnv(extra)).toBe('95c79f4d')
})

test('a pet drawn with only the required art still has every pose, a figurine and no ultra coat', () => {
  const legs = ['', '', '', '', '', '', '', '', '', '', '..L......L......', '..P......P......']
  const spec: PetSpec = {
    name: 'blob',
    width: 16,
    coats: [{ k: '#222', o: '#8c8', w: '#fff', p: '#f9c', e: '#222' }],
    body: ['', '', '', '', '....kkkkkk......', '...koooooek.....', '...kowwwook.....', '....kkkkkk......'],
    eyes: { cover: [] },
    poses: { run: { behind: [{ each: 0.2, frames: [legs, legs] }] }, stand: { behind: [legs] }, sleep: {} },
    lines: { reward: '', happy: '', working: '', sleep: '', idle: '' },
    face: { reward: '', happy: '', working: '', sleep: '', idle: '' },
  }
  const blob = buildPet(spec)
  expect(blob.coats).toBe(1)
  expect(blob.ultra).toBe(false)
  for (const p of POSES) expect(blob.body('idle', 0, p, '<use href="#t0"/>').length).toBeGreaterThan(0)
  expect(blob.maneki()).toContain('class="cl0"')
  expect(blob.futonTail(0)).toBe('')
})

test('/pet lists the pets, and an id that is not one changes nothing', async ($, on) => {
  engine(on)
  await $.session.start(START)
  await settle()
  const listed = await $.command.run({ command: 'pet', args: '' })
  expect(JSON.stringify(listed)).toContain('● cat（猫）')
  const wrong = await $.command.run({ command: 'pet', args: 'dragon' })
  expect(JSON.stringify(wrong)).toContain('「dragon」というペットはいません')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await mood(ui)).toMatch(/ごろごろ/)
  const picked = await $.command.run({ command: 'pet', args: 'cat' })
  expect(JSON.stringify(picked)).toContain('今のペットは cat（猫）です')
  // names every object has are not pets, and the band keeps its cat
  for (const odd of ['constructor', '__proto__', 'tostring']) {
    expect(JSON.stringify(await $.command.run({ command: 'pet', args: odd }))).toContain('というペットはいません')
  }
  expect(JSON.stringify(await $.command.run({ command: 'pet', args: 'cat dog' }))).toContain('1つだけ')
  expect(await mood(ui)).toMatch(/ごろごろ/)
  await ui.unmount()
})

test('a pet pack\'s pet that is broken or too big is left out, not drawn', () => {
  expect(checkPet(CAT)).not.toBeNull()
  const broken: unknown[] = [
    { ...CAT, width: 40 },
    { ...CAT, coats: [] },
    { ...CAT, body: [42] },
    { ...CAT, body: Array(30).fill('kkkk') },
    { ...CAT, poses: { ...CAT.poses, run: { behind: [{ each: 0.1, frames: Array(50).fill(['L']) }] } } },
    { ...CAT, lines: { idle: 'only one' } },
    { ...CAT, poses: undefined },
    // values that would break the picture: a color closing the attribute or the CSS rule, a
    // width as text, a flipbook's time as text, a palette naming the theme's or ultra's letters
    { ...CAT, coats: [{ ...CAT.coats[0], o: 'red"/><g x="' }] },
    { ...CAT, coats: [{ ...CAT.coats[0], o: '#fff}svg{display:none' }] },
    { ...CAT, coats: [{ ...CAT.coats[0], u: '#ffffff' }] },
    { ...CAT, coats: [{ k: '#000', o: '#888' }] },
    { ...CAT, width: '16' },
    { ...CAT, poses: { ...CAT.poses, stand: { front: [{ each: '1" x="', frames: [['L']] }] } } },
    // and things too big to have been drawn in: eyes, a name, a line of words
    { ...CAT, eyes: { ...CAT.eyes, happy: ['.'.repeat(400_000)] } },
    { ...CAT, name: '猫'.repeat(100) },
    { ...CAT, lines: { ...CAT.lines, idle: 'a\nb' } },
    { ...CAT, ultra: { ...CAT.ultra, nose: [1.5, 2] } },
  ]
  for (const spec of broken) expect(checkPet(spec as PetSpec)).toBeNull()
  expect(inspectPet({ ...CAT, width: 40 })).toEqual({ problem: 'width が 10〜16 の整数でない' })
})

test('coats: a herd of ten, the ultra coat only tenth, whatever the pet\'s number of coats', () => {
  const cat = buildPet(CAT)
  const cats = coatsFor(42, cat)
  expect(cats.length).toBe(10)
  expect(cats[9]).toBe(9)
  expect([...cats.slice(0, 9)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  const few = buildPet({ ...CAT, coats: CAT.coats.slice(0, 2) })
  const dealt = coatsFor(42, few)
  expect(dealt.filter(c => c === 2)).toEqual([2])
  expect(dealt[9]).toBe(2)
  const plain = buildPet({ ...CAT, coats: CAT.coats.slice(0, 3), ultra: undefined })
  expect(coatsFor(7, plain).every(c => c < 3)).toBe(true)
})

test('a pet without a leap runs through it, and one without an eating pose still eats its food', () => {
  const { jump: _j, eat: _e, ...rest } = CAT.poses
  const pet = buildPet({ ...CAT, poses: rest })
  expect(pet.body('idle', 0, 'jump', '<use/>')).toBe(pet.body('idle', 0, 'run', '<use/>'))
  expect(pet.body('reward', 0, 'eat', '<use/>')).toContain('#8ec5e8')
})

test('a new install starts on the status band, and the switch turns to the pets', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>status band</Text>
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 10 }, rateLimits: [], cost: { usd: 1 } } }) as never)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /status band/ })).toBeDefined()
  expect((await ui.find({ key: 'toggle-view' }))?.text).toBe('◓')
  await ui.press({ key: 'toggle-view' })
  expect((await ui.find({ key: 'toggle-view' }))?.text).toBe('◒')
  await ui.unmount()
})
