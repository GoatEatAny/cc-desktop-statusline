// pixel-pet: a pixel-art pet in the band above the prompt. It cheers when a turn completes,
// runs to random spots along the band and rests in between, sends a heart now and then,
// watches while Claude works, and falls asleep when left alone. One button at the band's
// trailing edge swaps between the pet and whatever the band showed before.
//
// A pet is one data file (its pixel art and its words), brought to life by pet-kit.ts. The cat
// is built in (pets/cat.ts); other mods, pet packs, add theirs through $.pixelPet.pets, and
// /pet picks one. The band, the switch and the moods stay as they are.

import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { PixelPetMetric as Metric, PixelPetMode as Mode } from '../types'
import { buildPet, coatsFor, inspectPet, PET_ID, type Pet, type PetSpec } from './pet-kit.ts'
import { CAT } from './pets/cat.ts'
import { FUTON_W, futonLeft, pixels, REWARD_MS, rng, SCALE, VIEW_H, type Mood, type Pose } from './sprite.ts'

const mode = { plugin: 'pixel-pet', key: 'mode' } as const
const happyUntil = { plugin: 'pixel-pet', key: 'happyUntil' } as const
const lastActive = { plugin: 'pixel-pet', key: 'lastActive' } as const
const turns = { plugin: 'pixel-pet', key: 'turns' } as const
const cost = { plugin: 'pixel-pet', key: 'cost' } as const
const ctx = { plugin: 'pixel-pet', key: 'ctx' } as const
const rewardUntil = { plugin: 'pixel-pet', key: 'rewardUntil' } as const
const cacheTs = { plugin: 'pixel-pet', key: 'cacheTs' } as const
const cacheMiss = { plugin: 'pixel-pet', key: 'cacheMiss' } as const
const turnCost = { plugin: 'pixel-pet', key: 'turnCost' } as const
const turnAt = { plugin: 'pixel-pet', key: 'turnAt' } as const
const metric = { plugin: 'pixel-pet', key: 'metric' } as const
const efficiency = { plugin: 'pixel-pet', key: 'efficiency' } as const
const quota = { plugin: 'pixel-pet', key: 'quota' } as const
const menu = { plugin: 'pixel-pet', key: 'menu' } as const
const coatSeed = { plugin: 'pixel-pet', key: 'coatSeed' } as const
const shownPet = { plugin: 'pixel-pet', key: 'shownPet' } as const
const epoch = { plugin: 'pixel-pet', key: 'epoch' } as const
const shownHerd = { plugin: 'pixel-pet', key: 'shownHerd' } as const
const poofFrom = { plugin: 'pixel-pet', key: 'poofFrom' } as const
const poofAt = { plugin: 'pixel-pet', key: 'poofAt' } as const

const HAPPY_MS = 6_000
// After each turn, what it cost floats up beside the bar as a coin and fades, for this long:
// gray when small, yellow from `notable`, red from `high` (USD, API prices). Only a red one
// startles the herd: the cheering cats show a "!" instead of hearts. Seeing every turn's price
// builds a feel for which requests cost what.
const COIN_MS = 4_000
const TURN_USD = { notable: 0.5, high: 2 }
// When the context is this full (%), the herd gets heavy: chubby, slow and slumping; and the
// first cat leaves the herd, and a beckoning cat (maneki-neko) sits right of the bar saying
// "/compact" in a bubble; pressing it compacts. Every call re-reads the whole
// context, so this is where a session's cost climbs fastest.
const HEAVY_CONTEXT_PCT = 40
const SLEEP_AFTER_MS = 10 * 60_000
// How long the prompt cache keeps the conversation after the last API call. Claude Code here
// writes it with the 1-hour TTL (usage.py prices a miss the same way). Past this, the next
// message re-writes the whole context to the cache at twice the input price: the herd sleeps
// under a blanket, the band shows what that next message will cost, and when the context is
// heavy the beckoning cat suggests /clear (a new task is cheapest in a new conversation).
const CACHE_TTL_MS = 60 * 60_000
// Past the cache's expiry, the beckoning cat offers /clear when the next message would cost at
// least this much to carry on (whatever the context's size); below it, carrying on is fine.
const CLEAR_NUDGE_USD = 0.5

// ---- Sprite helpers, shared by every pet ------------------------------------------------------

// The sprite is drawn in a sandboxed frame (for SMIL). Without a color scheme of its own the
// frame paints an opaque backdrop under a dark app, so declare both schemes and no background.
const FRAME_STYLE = '<style>:root{color-scheme:light dark;background:transparent}</style>'

const HEART = ['pp.pp', 'ppppp', '.ppp.', '..p..']
const HEART_COLOR = '#e5534b'

// Room beside the sprite for the heart and the "z" (8 wide).
const AURA_W = 8

// A "z" drifting up just past the sprite's right edge, while it sleeps.
function sleepZ(x: number): string {
  return `<text x="${x}" y="5" font-family="ui-monospace,monospace" font-size="4" font-weight="700" fill="#8b949e">z`
    + '<animate attributeName="y" values="6;2" dur="2.4s" repeatCount="indefinite"/>'
    + '<animate attributeName="opacity" values="0;1;0" dur="2.4s" repeatCount="indefinite"/></text>'
}

// The futon over a sleeping pet once the cache has gone cold: pulled right over it, ears and
// all, into a round red daifuku, the same both ways, its shoulders rounded and its sides bulging
// low before tucking in at the foot, a white edge along the top and down the sides, a few
// lighter dots; puffing up slowly, a little wider and taller, as the pet breathes beneath it.
// 22 wide: 3 past the sprite on each side.
const BLANKET = [
  '',
  '........oooooo........',
  '.....ooowwwwwwooo.....',
  '...oowwwwwwwwwwwwoo...',
  '..owwwbbbbbbbbbbwwwo..',
  '.owwbbbbcbbbbbbbbbwwo.',
  '.owbbbbbbbbbbbcbbbbwo.',
  'owbbcbbbbbbbbbbbbbbbwo',
  'owbbbbbbbbbcbbbbbcbbwo',
  'owbbbbbbbbbbbbbbbbbbwo',
  '.owbbbcbbbbbbbbbbbbwo.',
  '..oooooooooooooooooo..',
]
const BLANKET_COLORS = { b: '#d0463e', c: '#ea7a70', w: '#f3eee6', o: '#9a2c27' }
// The futon is scaled up and down from the middle of its bottom edge, so it puffs out both ways
// without lifting off the ground (never flatter than at rest, or the ears would show over it);
// centred on a pet `width` wide. Only the pet's tail (`tail`) sticks out, from the futon's foot
// at its back.
function futon(tail: string, width: number): string {
  const mid = futonLeft(width) + FUTON_W / 2
  return `${tail}<g transform="translate(${mid} 12)"><g><animateTransform attributeName="transform" type="scale" values="1 1;1.05 1.03;1 1" dur="3s" repeatCount="indefinite"/>`
    + `<g transform="translate(${-mid} -12)">${pixels(BLANKET, futonLeft(width), 0, BLANKET_COLORS)}</g></g></g>`
}

// The speech bubble the beckoning cat says "/compact" in, drawn in device px: a rounded bubble
// in the band's own grays, its tail pointing at the cat's mouth, the word in a rainbow that keeps
// scrolling across it, the whole bubble bobbing a little. Only this word is rainbow, so it reads
// as special and as the thing to press.
const RAINBOW = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#9775fa']
const BUBBLE_W = 56
const BUBBLE_TAIL = 4
// With `price`, the bubble alternates every BUBBLE_SWAP_S: the price of carrying on (icy blue,
// as the cold cache's figure) and the cheaper way, the word.
const BUBBLE_SWAP_S = 1.5
function compactBubble(word: string, price = ''): string {
  const stops = [...RAINBOW, RAINBOW[0]].map((c, k) => `<stop offset="${(k / RAINBOW.length).toFixed(3)}" stop-color="${c}"/>`).join('')
  const gradient = `<defs><linearGradient id="mkg" gradientUnits="userSpaceOnUse" x2="24" spreadMethod="repeat">${stops}`
    + '<animateTransform attributeName="gradientTransform" type="translate" values="0 0;24 0" dur="1.2s" repeatCount="indefinite"/></linearGradient></defs>'
  const style = '<style>.bub{fill:#ffffff;stroke:#c8c8c4}.bpr{fill:#2f6db5}@media (prefers-color-scheme:dark){.bub{fill:#30302e;stroke:#7b7c79}.bpr{fill:#6cb6ff}}</style>'
  const w = BUBBLE_W, r = 4
  const outline = `M${r + 0.5} 1.5H${w - r + 0.5}Q${w + 0.5} 1.5 ${w + 0.5} ${r + 1.5}V7.5L${w + BUBBLE_TAIL + 0.5} 9.5L${w + 0.5} 11.5`
    + `V${16.5 - r}Q${w + 0.5} 16.5 ${w - r + 0.5} 16.5H${r + 0.5}Q0.5 16.5 0.5 ${16.5 - r}V${r + 1.5}Q0.5 1.5 ${r + 0.5} 1.5Z`
  const say = (body: string, paint: string) => `<text x="${w / 2 + 0.5}" y="12.6" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="10" font-weight="700" ${paint}>${body}</text>`
  const swap = (first: boolean) => `<animate attributeName="opacity" values="${first ? '1;0' : '0;1'}" keyTimes="0;.5" calcMode="discrete" dur="${BUBBLE_SWAP_S * 2}s" repeatCount="indefinite"/>`
  const text = price === '' ? say(word, 'fill="url(#mkg)"')
    : `<g>${say(price, 'class="bpr"')}${swap(true)}</g><g opacity="0">${say(word, 'fill="url(#mkg)"')}${swap(false)}</g>`
  return `${gradient}${style}<g><path class="bub" d="${outline}" stroke-width="1"/>${text}`
    + '<animateTransform attributeName="transform" type="translate" values="0 0;0 -.5;0 0" dur="1.2s" repeatCount="indefinite"/></g>'
}

// The beckoning figurine shown while the context is heavy (for the cat, a maneki-neko): the
// pet's own (`pet.maneki`), not one of the herd, a paw beckoning, saying the rainbow word
// /compact in a speech bubble. It sits right beside the bar, and a blank Button laid over it
// makes pressing it run /compact.
// The bubble, then the figurine (16 x 12 sprite px at SCALE), in device px.
const MANEKI_W = BUBBLE_W + BUBBLE_TAIL + 2 + 16 * SCALE
function manekiSvg(pet: Pet, word = '/compact', price = ''): string {
  const h = VIEW_H * SCALE
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${MANEKI_W}" height="${h}" viewBox="0 0 ${MANEKI_W} ${h}">`
    + `${FRAME_STYLE}${compactBubble(word, price)}`
    + `<g transform="translate(${BUBBLE_W + BUBBLE_TAIL + 2} 0) scale(${SCALE})" shape-rendering="crispEdges">${pet.maneki()}</g></svg>`
}

// keyTimes: five places, so short runs on a long loop never collapse onto their neighbor.
function kt(t: number, total: number): string {
  return (t / total).toFixed(5)
}

// ---- The stage: each pet runs to random spots and rests in between ---------------------------

const RUN_PX_PER_S = 40
// Runs in one loop of a pet's walk; the last one brings it back to where the loop began.
const RUNS_PER_LOOP = 8
// Shorter dashes look like twitching, so a run covers at least this much when there is room.
const MIN_RUN_PX = 40
const REST_S = { min: 0.6, max: 4 }

// What a pet may do when it stops, with how long it takes and how often (the rest stand).
const REST_ACTIONS: { pose: Pose; seconds: number; share: number }[] = [
  { pose: 'roll', seconds: 3.6, share: 0.05 },
  { pose: 'stretch', seconds: 2.2, share: 0.05 },
  { pose: 'groom', seconds: 3.0, share: 0.05 },
]
// How often a run heads for the track's right end to scratch the bar, and for how long.
const SCRATCH = { share: 0.05, seconds: 2.4 }
// How often a move is a leap instead of a run: a short hop forward, faster, in an arc.
const LEAP = { share: 0.05, minPx: 24, maxPx: 48, speedUp: 2.2, lift: 2.5 }

type Key = { t: number; x: number }
type Run = { start: number; end: number; right: boolean }
type Seg = { start: number; pose: Pose }
type Walk = { keys: Key[]; runs: Run[]; segs: Seg[]; total: number }

// One pet's loop on a track `range` px wide: positions over time (`keys`, in seconds and px),
// the runs among them, what it does when (`segs`), and the loop's length. `barX` is where it
// stands to scratch the bar: past `range`, by the room the others keep for hearts.
// Heavy (a full context): runs at about half speed, rests longer, half the rests slumped flat,
// and no leaps, scratching or rolling about.
const HEAVY = { speed: 0.55, rest: 1.8, slump: 0.5 }

function walkFor(seed: number, range: number, barX: number, heavy = false): Walk {
  const r = rng(seed)
  const speed = RUN_PX_PER_S * (0.8 + 0.4 * r()) * (heavy ? HEAVY.speed : 1)
  const home = r() * range
  let x = home
  let t = 0
  const keys: Key[] = [{ t: 0, x }]
  const runs: Run[] = []
  const segs: Seg[] = []
  for (let k = 0; k <= RUNS_PER_LOOP; k++) {
    const last = k === RUNS_PER_LOOP
    const scratch = !heavy && !last && range >= MIN_RUN_PX && r() < SCRATCH.share
    const leap = !heavy && !last && !scratch && range >= 2 * LEAP.maxPx && r() < LEAP.share
    let to = last ? home : scratch ? barX : r() * range
    if (leap) {
      // A short leap, toward whichever side has room.
      const span = LEAP.minPx + r() * (LEAP.maxPx - LEAP.minPx)
      to = x + span <= range ? x + span : x - span
    } else if (!last && !scratch && Math.abs(to - x) < MIN_RUN_PX && range >= 2 * MIN_RUN_PX) {
      const way = to >= x ? 1 : -1
      to = x + way * MIN_RUN_PX
      if (to < 0 || to > range) to = x - way * MIN_RUN_PX
    }
    if (Math.abs(to - x) > 0.5) {
      const took = Math.abs(to - x) / (leap ? speed * LEAP.speedUp : speed)
      runs.push({ start: t, end: t + took, right: to > x })
      segs.push({ start: t, pose: leap ? 'jump' : 'run' })
      t += took
      x = to
      keys.push({ t, x })
    }
    // At the spot: scratch if it came for the bar, else now and then one of the rest actions.
    let pose: Pose = 'stand'
    let rest = REST_S.min + r() * (REST_S.max - REST_S.min)
    if (scratch) {
      pose = 'scratch'
      rest = SCRATCH.seconds
    } else if (heavy) {
      rest *= HEAVY.rest
      if (r() < HEAVY.slump) pose = 'slump'
    } else if (!last) {
      let pick = r()
      for (const a of REST_ACTIONS) {
        if (pick < a.share) {
          pose = a.pose
          rest = a.seconds
          break
        }
        pick -= a.share
      }
    }
    segs.push({ start: t, pose })
    t += rest
    keys.push({ t, x })
  }
  return { keys, runs, segs, total: t }
}

// Where the walk has the pet `s` seconds into its loop, and which way it faces.
function walkAt(walk: Walk, s: number): { x: number; right: boolean } {
  let right = walk.runs[0]?.right ?? true
  for (const run of walk.runs) if (run.start <= s) right = run.right
  for (let k = 1; k < walk.keys.length; k++) {
    const a = walk.keys[k - 1]
    const b = walk.keys[k]
    if (s <= b.t) return { x: a.x + (b.x - a.x) * ((s - a.t) / Math.max(1e-6, b.t - a.t)), right }
  }
  return { x: walk.keys[walk.keys.length - 1].x, right }
}

function flip(right: boolean, w: number): string {
  return right ? '' : `translate(${w} 0) scale(-1 1)`
}

// One heart popping up and fading at each of `at` (seconds into a loop of `total`).
// Before, between and after, it is hidden.
function heartAnim(at: number[], total: number, timing: string): string {
  const points: [number, number, number][] = [[0, 0, 3]] // seconds, opacity, y
  for (const p of at.sort((a, b) => a - b)) {
    points.push([p, 0, 3], [p + 0.05, 1, 2.6], [p + 0.6, 1, 0.6], [p + 1, 0, -1], [p + 1.05, 0, 3])
  }
  points.push([total, 0, 3])
  const times = points.map(([t]) => kt(t, total)).join(';')
  const opacity = points.map(([, o]) => o).join(';')
  const rise = points.map(([, , y]) => `0 ${y}`).join(';')
  return `<g opacity="0">${pixels(HEART, 0, 0, { p: HEART_COLOR })}`
    + `<animate attributeName="opacity" values="${opacity}" keyTimes="${times}" ${timing}/>`
    + `<animateTransform attributeName="transform" type="translate" values="${rise}" keyTimes="${times}" ${timing}/></g>`
}

// `count` moments in [from, to) seconds, at least 1.3 s apart so hearts do not overlap.
function moments(r: () => number, count: number, from: number, to: number): number[] {
  const out: number[] = []
  for (let tries = 0; out.length < count && tries < 50; tries++) {
    const t = from + r() * (to - from)
    if (out.every(o => Math.abs(o - t) >= 1.3)) out.push(t)
  }
  return out
}

// Hearts at random moments. Right after a finished turn a few of the pets (CHEERERS) send one or
// two within the cheering; otherwise each now and then sends one on its own, in its own rhythm.
function hearts(seed: number, x: number, happy: boolean, cheers: boolean, nowMs: number): string {
  const r = rng(seed)
  let anim: string
  if (happy && !cheers) return ''
  if (happy) {
    const total = HAPPY_MS / 1000
    anim = heartAnim(moments(r, 1 + Math.floor(r() * 2), 0.1, total - 1.2), total, `dur="${total}s" begin="0s"`)
  } else {
    const total = 20 + r() * 25
    const phase = (nowMs / 1000) % total
    anim = heartAnim(moments(r, 1, 0.1, total - 1.2), total, `dur="${total.toFixed(2)}s" begin="-${phase.toFixed(2)}s" repeatCount="indefinite"`)
  }
  return `<g transform="translate(${x + 0.5} 0)">${anim}</g>`
}

// A red "!" over a startled pet, popping in and blinking for the length of the cheer.
function bang(x: number): string {
  const total = HAPPY_MS / 1000
  return `<g transform="translate(${x + 1.5} 0)" fill="#f85149" opacity="0"><rect width="1" height="3"/><rect y="4" width="1" height="1"/>`
    + `<animate attributeName="opacity" values="0;1;0;1;1;0" keyTimes="0;.04;.12;.2;.85;1" dur="${total}s" begin="0s" fill="freeze"/></g>`
}

// One member of the herd on a track `width` px wide. Its walk is seeded by its place in the
// herd and the track's width, and its place in the loop comes from the wall clock, so a redraw
// picks up where it was. Asleep, it lies down where it was.
// Which pets send hearts after a finished turn: two or three of the herd, drawn anew each turn.
function cheerers(herd: number, cheerSeed: number): Set<number> {
  const r = rng(cheerSeed + 7)
  const order = Array.from({ length: herd }, (_, i) => i).sort(() => r() - 0.5)
  return new Set(order.slice(0, Math.min(herd, 2 + Math.floor(r() * 2))))
}

function runner(pet: Pet, mood: Mood, width: number, nowMs: number, i: number, cheerSeed: number, cheers: boolean, heavy: boolean, cold = false, startled = false, coat = i, fat = 0): string {
  const w = pet.width
  const range = Math.max(0, width - (w + AURA_W) * SCALE)
  // To scratch, it stands with its face 2 px short of the bar (the bar is BAR_GAP_PX past the track).
  const walk = walkFor(7919 * (i + 1) + Math.round(range), range, range + AURA_W * SCALE + BAR_GAP_PX - 2, heavy)
  const phase = (nowMs / 1000) % walk.total
  const timing = `dur="${walk.total.toFixed(2)}s" begin="-${phase.toFixed(2)}s" repeatCount="indefinite"`

  // In sprite pixels from here: the body one row down, leaving room above for a hop.
  const hop = mood === 'happy'
    ? '<animateTransform attributeName="transform" type="translate" values="0 0;0 -1;0 0" keyTimes="0;0.4;1" dur="0.5s" repeatCount="indefinite"/>'
    : ''
  // The trunk is drawn once, in defs, and each pose refers to it.
  const defs = `<defs><g id="t${i}">${pet.trunk(mood, coat, fat)}</g></defs>`
  const pose = (p: Pose) => `<g>${pet.body(mood, coat, p, `<use href="#t${i}"/>`, fat)}${hop}</g>`
  const aura = mood === 'sleep' ? sleepZ(w)
    : mood === 'reward' ? ''
    : mood === 'happy' && startled ? (cheers ? bang(w) : '')
    : hearts(cheerSeed + 101 * i, w, mood === 'happy', cheers, nowMs)

  // Asleep or eating its reward, it stays where it was.
  if (mood === 'sleep' || mood === 'reward' || walk.runs.length === 0) {
    const at = walkAt(walk, phase)
    // Under a futon, kept clear of the track's left end, so its foot and the tail sticking out of
    // it are not cut off.
    const x = cold && mood === 'sleep' ? Math.max(at.x, Math.max(11, pet.futonReach + 4) * SCALE) : at.x
    return `${defs}<g transform="translate(${x.toFixed(1)} 0)"><g transform="scale(${SCALE})"><g transform="${flip(at.right, w)}">${pose(mood === 'reward' ? 'eat' : 'stand')}${cold && mood === 'sleep' ? futon(pet.futonTail(coat), w) : ''}</g>${aura}</g></g>`
  }

  const along = `<animateTransform attributeName="transform" type="translate" values="${walk.keys.map(k => `${k.x.toFixed(1)} 0`).join(';')}" keyTimes="${walk.keys.map(k => kt(k.t, walk.total)).join(';')}" ${timing}/>`

  // Which way it faces: set at the start of each run, kept through the rest after it.
  const turns = [{ t: 0, right: walk.runs[0].right }, ...walk.runs.filter(run => run.start > 0).map(run => ({ t: run.start, right: run.right }))]
  const turnAt = `keyTimes="${turns.map(x => kt(x.t, walk.total)).join(';')}" calcMode="discrete" ${timing}`
  const facing = (inner: string) => `<g><animateTransform attributeName="transform" type="translate" values="${turns.map(x => (x.right ? '0 0' : `${w} 0`)).join(';')}" ${turnAt}/>`
    + `<g><animateTransform attributeName="transform" type="scale" values="${turns.map(x => (x.right ? '1 1' : '-1 1')).join(';')}" ${turnAt}/>${inner}</g></g>`

  // One group per pose this pet uses, each shown only during its own stretches of the loop.
  const times = walk.segs.map(sg => kt(sg.start, walk.total)).join(';')
  const used = [...new Set(walk.segs.map(sg => sg.pose))]
  const body = used.map(p => `<g opacity="0"><animate attributeName="opacity" values="${walk.segs.map(sg => (sg.pose === p ? 1 : 0)).join(';')}" keyTimes="${times}" calcMode="discrete" ${timing}/>${pose(p)}</g>`).join('')

  // Leaps arc up and down: a lift over the loop, zero except during each jump.
  const arc: [number, number][] = [[0, 0]]
  walk.segs.forEach((sg, k) => {
    if (sg.pose !== 'jump') return
    const end = walk.segs[k + 1]?.start ?? walk.total
    const at = (t: number, y: number) => { if (t > arc[arc.length - 1][0] + 1e-3) arc.push([t, y]) }
    at(sg.start, 0)
    at((sg.start + end) / 2, -LEAP.lift)
    at(end, 0)
  })
  if (arc[arc.length - 1][0] < walk.total - 1e-3) arc.push([walk.total, 0])
  const lift = arc.length > 2
    ? `<animateTransform attributeName="transform" type="translate" values="${arc.map(([, y]) => `0 ${y}`).join(';')}" keyTimes="${arc.map(([t]) => kt(t, walk.total)).join(';')}" ${timing}/>`
    : ''

  return `${defs}<g>${along}<g>${lift}<g transform="scale(${SCALE})">${facing(body)}${aura}</g></g></g>`
}

// The label at the right end of the picture (the session's cost): 12 px system type, its width
// estimated per character, since nothing here can measure text.
const LABEL_PX = 11.5
const BAR_GAP_PX = 5

// The label's width in px, from rough widths of the system font's glyphs (in em): erring a
// little wide, since the text is set from its left end and any excess falls to its right.
function labelWidth(label: string): number {
  const em = (c: string) => /[　-鿿＀-￯]/.test(c) ? 1
    : /[.,:;|'!il]/.test(c) ? 0.27
    : c === ' ' ? 0.28
    : /[tfrj]/.test(c) ? 0.38
    : /[%mwMW]/.test(c) ? 0.88
    : /[A-Z]/.test(c) ? 0.68
    : 0.6
  return [...label].reduce((n, c) => n + em(c) * LABEL_PX, 0) * 1.04
}

// The whole band's picture, `width` px wide: the pets' track, then a thin bar that ends it,
// then the label tight against the bar. One picture, so the bar sits exactly where the track
// ends and right by the label, whatever the band's layout does around it.
// The desktop takes an Svg source of at most 131072 characters; ten cats with a cloud of smoke
// for each newcomer, hearts and a coin come near it on a very wide band. Past this, the smoke
// goes first, then the cheering.
const SVG_LIMIT = 128_000

// `since`: how long ago the herd's current moment (its cheer, or its reward) began, in ms, so
// a redraw part way through carries those animations on rather than starting them over.
function stage(pet: Pet, mood: Mood, width: number, nowMs: number, herd: number, cheerSeed: number, label: string, heavy = false, next = '', cold = false, turn: Turn | null = null, order: readonly number[] = [], poof: Poof | null = null, since = 0, quiet = false, fat = 0, lifted = false, startled = false): string {
  const out = drawStage(pet, mood, width, nowMs, herd, cheerSeed, label, heavy, next, cold, turn, order, poof, quiet, fat, lifted, startled)
    .split('begin="0s"').join(`begin="-${(Math.max(0, since) / 1000).toFixed(2)}s"`)
  if (out.length <= SVG_LIMIT) return out
  if (poof !== null) return stage(pet, mood, width, nowMs, herd, cheerSeed, label, heavy, next, cold, turn, order, null, since, quiet, fat, lifted, startled)
  if (!quiet) return stage(pet, mood, width, nowMs, herd, cheerSeed, label, heavy, next, cold, turn, order, null, since, true, fat, lifted, startled)
  // Still too big (a pack's pet drawn near its limits): one pet fewer, until it fits.
  if (herd > 1) return stage(pet, mood, width, nowMs, herd - 1, cheerSeed, label, heavy, next, cold, turn, order, null, since, true, fat, lifted, startled)
  return out
}

function drawStage(pet: Pet, mood: Mood, width: number, nowMs: number, herd: number, cheerSeed: number, label: string, heavy: boolean, next: string, cold: boolean, turn: Turn | null, order: readonly number[], poof: Poof | null, quiet: boolean, fat: number, lifted: boolean, startled: boolean): string {
  const coatAt = (i: number) => order[i] ?? i
  const h = VIEW_H * SCALE
  const all = withNext(label, next)
  const textW = all === '' ? 0 : labelWidth(all)
  const barX = Math.round(width - 1 - textW - (all === '' ? 0 : BAR_GAP_PX)) - 0.5
  const track = Math.max(0, barX - BAR_GAP_PX)
  const cheering = quiet ? new Set<number>() : cheerers(herd, cheerSeed)
  // While the beckoning cat sits beside the band, the first pet is it, not on the track.
  // Just after the herd changed size, the cats that came or went do so in a puff of smoke: a
  // newcomer appears out of it, a leaver vanishes into it.
  const drawn = Math.max(herd, poof?.from ?? 0)
  const runners = Array.from({ length: drawn }, (_, i) => i)
    .filter(i => !(lifted && i === 0))
    .map(i => {
      const cat = runner(pet, mood, track, nowMs, i, cheerSeed, cheering.has(i), heavy, cold, startled, coatAt(i), fat)
      const came = poof !== null && i >= poof.from && i < herd
      const went = poof !== null && i >= herd
      if (!came && !went) return cat
      const x = catX(pet, track, nowMs, i, heavy) + pet.width * SCALE / 2
      return poofed(cat, came, poof.agoMs) + smoke(x, poof.agoMs)
    }).join('')
  const coats = `<style>${SMOKE_INK}${Array.from({ length: drawn }, (_, i) => pet.css(coatAt(i), nowMs)).join('')}</style>`
  const ink = INK
  // On the desktop the bar is a picture of its own (barSvg), so it stays still while this one
  // is redrawn; drawn here only beside a label.
  const bar = all === '' ? '' : `<path class="bar" d="M${barX} 3V${h - 3}" stroke-width="1" fill="none"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" shape-rendering="crispEdges">`
    + `${FRAME_STYLE}${ink}${coats}${runners}${bar}${turn === null ? '' : coin(turn, barX - 6)}${labelText(label, width, next)}</svg>`
}

// The last turn's cost and how long ago it ended.
type Turn = { usd: number; agoMs: number }

// The herd's size before its last change, and how long ago that was.
type Poof = { from: number; agoMs: number }
const POOF_MS = 900

// Where a pet stands now, in px from the track's left: the same walk the runner draws.
function catX(pet: Pet, width: number, nowMs: number, i: number, heavy: boolean): number {
  const range = Math.max(0, width - (pet.width + AURA_W) * SCALE)
  const walk = walkFor(7919 * (i + 1) + Math.round(range), range, range + AURA_W * SCALE + BAR_GAP_PX - 2, heavy)
  return walk.runs.length === 0 ? 0 : walkAt(walk, (nowMs / 1000) % walk.total).x
}

// A ninja's "doron", in the cats' own pixels: a small puff, a big billowing cloud with a swirl or
// two, the cloud torn into scraps, a few last specks; drifting up a little as it goes, timed
// from the change so a redraw does not restart it. Each frame is a union of discs snapped to the
// pixel grid (a bumpy outline), shaded toward the lower right of each disc.
const SMOKE_INK = '.smk{fill:#b8b8b3}.smd{fill:#8c8c88}.smw{fill:#6e6e6b}'
  + '@media (prefers-color-scheme:dark){.smk{fill:#ecece8}.smd{fill:#b9b9b5}.smw{fill:#8c8c88}}'
type Disc = [number, number, number] // centre x, centre y (sprite px from the cloud's centre), radius
const SMOKE_FRAMES: { discs: Disc[]; swirls: [number, number][]; until: number }[] = [
  { discs: [[0, 0, 2.6], [2, -1, 2]], swirls: [], until: 0.15 },
  { discs: [[0, 0, 4], [-5, 1, 3.4], [5, 1, 3.4], [-2.5, -2.5, 3], [2.5, -2.5, 3], [0, 2.5, 3]], swirls: [[-4, 0], [2, -1]], until: 0.45 },
  { discs: [[-6.5, 0, 2.8], [6, -1, 2.8], [0, -3.5, 2.5], [-2.5, 3, 2.3], [3, 3, 2.2]], swirls: [[6, -1]], until: 0.7 },
  { discs: [[-8, -1, 1.3], [7.5, -2, 1.3], [0, -5, 1.2], [-3, 4, 1.1], [4, 4, 1.1], [9, 2, 1]], swirls: [], until: 1 },
]
// A small curl, as manga draws one in smoke: 5 x 4.
const SWIRL = ['.ww.', 'w..w', 'w.ww', '.w..']

function cloudRows(discs: Disc[]): { rows: string[]; ox: number; oy: number } {
  const ox = -12, oy = -7
  const rows = Array.from({ length: 15 }, (_, j) => Array.from({ length: 25 }, (_, i) => {
    const x = i + ox + 0.5, y = j + oy + 0.5
    let best: { depth: number; shade: number } | null = null
    for (const [cx, cy, r] of discs) {
      const d = Math.hypot(x - cx, y - cy)
      if (d > r) continue
      const depth = r - d
      if (best === null || depth > best.depth) best = { depth, shade: ((x - cx) + (y - cy)) / (r * 1.41) }
    }
    return best === null ? '.' : best.shade > 0.3 ? 'd' : 's'
  }))
  // An outline round the cloud, in the swirls' gray, so its bumps read at this size.
  const out = rows.map((row, j) => row.map((c, i) => c !== '.' ? c
    : [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([di, dj]) => (rows[j + dj]?.[i + di] ?? '.') !== '.' && (rows[j + dj]?.[i + di] ?? '.') !== 'o') ? 'o' : '.').join(''))
  return { rows: out, ox, oy }
}

function smoke(cx: number, agoMs: number): string {
  const total = 0.7
  const timing = `dur="${total}s" begin="-${(agoMs / 1000).toFixed(2)}s" fill="freeze"`
  let from = 0
  const frames = SMOKE_FRAMES.map(({ discs, swirls, until }, k) => {
    const { rows, ox, oy } = cloudRows(discs)
    const curls = swirls.map(([sx, sy]) => pixels(SWIRL, sx - ox - 2, sy - oy - 2, { w: '.smw' })).join('')
    const shown = k === 0 ? `values="1;0" keyTimes="0;${until}"` : `values="0;1;0" keyTimes="0;${from};${until}"`
    from = until
    return `<g opacity="${k === 0 ? 1 : 0}" transform="translate(${ox} ${oy})">${pixels(rows, 0, 0, { s: '.smk', d: '.smd', o: '.smw' })}${curls}`
      + `<animate attributeName="opacity" ${shown} calcMode="discrete" ${timing}/></g>`
  }).join('')
  // In sprite pixels about the cloud's centre, at the band's middle; rising 1 px.
  return `<g transform="translate(${cx.toFixed(1)} ${VIEW_H * SCALE / 2}) scale(${SCALE})"><g>${frames}`
    + `<animateTransform attributeName="transform" type="translate" values="0 0;0 -1" ${timing}/></g></g>`
}

// A cat that came shows once the smoke is thick; one that went is gone by then.
function poofed(cat: string, came: boolean, agoMs: number): string {
  const values = came ? '0;1' : '1;0'
  return `<g opacity="${came ? 0 : 1}">${cat}<animate attributeName="opacity" values="${values}" keyTimes="0;.3" calcMode="discrete" dur=".7s" begin="-${(agoMs / 1000).toFixed(2)}s" fill="freeze"/></g>`
}

// The coin: a small gold disc and "+$0.42", ending at `right`, rising from the bottom of the
// band and fading out, timed from when the turn ended so a redraw does not restart it.
const COIN_INK = '<style>.cn0{fill:#6e6e6b}.cn1{fill:#b08800}.cn2{fill:#cf222e}'
  + '@media (prefers-color-scheme:dark){.cn0{fill:#9a9a96}.cn1{fill:#e3b341}.cn2{fill:#f85149}}</style>'
function coin(turn: Turn, right: number): string {
  const tier = turn.usd >= TURN_USD.high ? 2 : turn.usd >= TURN_USD.notable ? 1 : 0
  const text = `+${usd(turn.usd)}`
  const size = 10
  const left = right - labelWidth(text) * size / LABEL_PX
  const total = COIN_MS / 1000
  const timing = `dur="${total}s" begin="-${(turn.agoMs / 1000).toFixed(2)}s" fill="freeze"`
  return `${COIN_INK}<g opacity="0" shape-rendering="geometricPrecision">`
    + `<circle cx="${(left - 4.5).toFixed(1)}" cy="9" r="3.5" fill="#f2c94c" stroke="#b08800" stroke-width="1"/>`
    + `<text class="cn${tier}" x="${right}" y="12.5" text-anchor="end" font-family="system-ui,-apple-system,sans-serif" font-size="${size}" font-weight="600">${text}</text>`
    + `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.1;.7;1" ${timing}/>`
    + `<animateTransform attributeName="transform" type="translate" values="0 4;0 0;0 -2" keyTimes="0;.25;1" ${timing}/></g>`
}

// Matched to the status band's dim text: a neutral gray, regular weight. The bar is stroked
// and the text only filled, in classes of their own: a stroke rule shared with the text
// outlined every glyph and made it read bold (CSS outranks a stroke="none" attribute).
// The bar that ends the track, alone: its source never changes, so a redraw of the band (every
// minute, after each turn) leaves it as it is. Inside the herd's picture, which is drawn anew each
// time, it blinked.
function barSvg(): string {
  const h = VIEW_H * SCALE
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="${h}" viewBox="0 0 2 ${h}" shape-rendering="crispEdges">${FRAME_STYLE}${INK}`
    + `<path class="bar" d="M0.5 3V${h - 3}" stroke-width="1" fill="none"/></svg>`
}

// The next message's cost after the cache has gone cold is in an icy blue.
const INK = '<style>.bar{stroke:#6e6e6b}.txt{fill:#6e6e6b;stroke:none;font-weight:400;-webkit-font-smoothing:antialiased}.ice{fill:#2f6db5}'
  + '@media (prefers-color-scheme:dark){.bar{stroke:#7b7c79}.txt{fill:#7b7c79}.ice{fill:#6cb6ff}}</style>'

function withNext(label: string, next: string): string {
  return next === '' ? label : label === '' ? next : `${label} ${next}`
}

function labelText(label: string, right: number, next = ''): string {
  if (label === '' && next === '') return ''
  const ice = next === '' ? '' : `<tspan class="ice">${label === '' ? '' : ' '}${next}</tspan>`
  // Set from its left end, so it starts the same gap after the bar whatever the estimate.
  const left = right - 1 - labelWidth(withNext(label, next))
  return `<text class="txt" x="${left.toFixed(1)}" y="${(VIEW_H * SCALE / 2 + LABEL_PX * 0.36).toFixed(1)}" font-family="system-ui,-apple-system,sans-serif" font-size="${LABEL_PX}">${label}${ice}</text>`
}

// The label on its own, for when the beckoning cat sits between the bar and it.
// `gap`: the room left of the text: the bar's gap, or less beside the beckoning cat.
function costWidth(label: string, next = '', gap = BAR_GAP_PX): number {
  const all = withNext(label, next)
  return all === '' ? 0 : Math.ceil(gap + labelWidth(all) + 1)
}
function costSvg(label: string, next = '', gap = BAR_GAP_PX): string {
  const w = costWidth(label, next, gap), h = VIEW_H * SCALE
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${FRAME_STYLE}${INK}${labelText(label, w, next)}</svg>`
}

// How many pets run, by what this session has cost at API prices: one more as the cost passes
// each step, ten at most. Each API call re-reads the whole context, so a session's cost grows
// roughly with the square of how full the context is. On Opus 5.5 one session went from 80K
// to 476K tokens of context for $18, which puts a 1M window at 80% near $50. The steps are
// $50 x ((n - 1) / 9)^2, rounded, so the herd grows about evenly as the context fills and the
// tenth pet arrives near 80%.
const HERD_STEPS_USD = [0, 0.5, 2.5, 5.5, 10, 15, 22, 30, 40, 50]

function herdFor(usd: number | null): number {
  return usd === null ? 1 : HERD_STEPS_USD.filter(step => usd >= step).length
}

// What the herd's size stands for, picked by the person from the select beside the bar (no one
// measure says it all): the session's cost; how efficiently the last 7 days went (the share of
// cost that went to new work rather than re-reading the context); how full the context is; how
// many turns the person and the pet have had together; what is left of the 5-hour usage limit.
const METRICS: { id: Metric; name: string }[] = [
  { id: 'cost', name: 'Cost' },
  { id: 'efficiency', name: 'Efficiency' },
  { id: 'context', name: 'Context' },
  { id: 'turns', name: 'Turns' },
  { id: 'quota', name: 'Quota' },
]
// Turns together, over every session, for each cat past the first.
const HERD_STEPS_TURNS = [0, 10, 25, 50, 100, 200, 350, 500, 750, 1000]
// Efficiency from 20% (one cat) to 70% (ten): the last two weeks here ran 32-68% a day.
const EFFICIENCY_RANGE = { low: 0.2, high: 0.7 }

type Reading = { cost: number | null; efficiency: number | null; context: number | null; turns: number; quota: number | null }

function herdBy(m: Metric, r: Reading): number {
  const clamp = (n: number) => Math.max(1, Math.min(10, n))
  switch (m) {
    case 'cost': return herdFor(r.cost)
    case 'efficiency': return r.efficiency === null ? 1
      : clamp(1 + Math.floor((r.efficiency - EFFICIENCY_RANGE.low) / (EFFICIENCY_RANGE.high - EFFICIENCY_RANGE.low) * 9))
    case 'context': return r.context === null ? 1 : clamp(1 + Math.floor(r.context / 10))
    case 'turns': return HERD_STEPS_TURNS.filter(step => r.turns >= step).length
    case 'quota': return r.quota === null ? 1 : clamp(1 + Math.floor(r.quota / 100 * 9))
  }
}

// The reading as the band shows it beside the bar: short, in the band's own terms.
function metricLabel(m: Metric, r: Reading): string {
  const pct = (n: number | null) => (n === null ? '-' : `${Math.round(n)}%`)
  switch (m) {
    case 'cost': return r.cost === null ? '$-' : usd(r.cost)
    case 'efficiency': return `eff ${pct(r.efficiency === null ? null : r.efficiency * 100)}`
    case 'context': return `ctx ${pct(r.context)}`
    case 'turns': return `${r.turns} turns`
    case 'quota': return `5h ${pct(r.quota)} left`
  }
}

// How wide the track can be: the band's width in cells, less what sits right of the bar
// (the cost and the switch, each a desktop button with padding of its own). The desktop does
// not say how many px a cell is; 8.5 px matches a band of 119 cells measured at about 1010 px.
// Too wide, and the row wraps onto a second line; so the estimate errs short, and the track is
// laid against the bar on the right, where an error would show: it only leaves a little room
// at the band's left edge.
const CELL_PX = 8.5

function cellsOf(text: string): number {
  // Full-width characters (Japanese) take two cells.
  return [...text].reduce((n, c) => n + (/[　-鿿＀-￯]/.test(c) ? 2 : 1), 0)
}

// The picture's width: the track as measured to fit, plus the bar and the label.
function stageWidth(bodyColumns: number, label: string): number {
  const track = Math.max(40, Math.floor((bodyColumns - cellsOf(label) - 16) * CELL_PX))
  return Math.ceil(track + 2 * BAR_GAP_PX + labelWidth(label))
}

// How full the context is, as how round the pets are: rounder from each of these (%) on.
const FAT_FROM_PCT = [40, 60, 80]

function fatOf(contextPct: number | null): number {
  return contextPct === null ? 0 : FAT_FROM_PCT.filter(p => contextPct >= p).length
}

// The pets that come with pixel-pet; packs add theirs on top (see $.pixelPet.pets).
const BUILT_IN: Record<string, PetSpec> = { cat: CAT }
const DEFAULT_PET = 'cat'

const CAT_PET = buildPet(CAT)
const CAT_JSON = JSON.stringify(CAT)

// Pets built from specs, by id and the spec they were built from, so a pet is checked once,
// not on every draw (a spec arrives as a fresh copy each time).
type Checked = { pet: Pet } | { problem: string }
const built = new Map<string, { key: string; got: Checked }>()
function petOf(id: string, spec: PetSpec): Checked {
  const key = JSON.stringify(spec)
  if (id === DEFAULT_PET && key === CAT_JSON) return { pet: CAT_PET }
  const hit = built.get(id)
  if (hit?.key === key) return hit.got
  const got = inspectPet(spec)
  built.set(id, { key, got })
  return got
}

type PetList = { specs: Record<string, PetSpec>; pets: Record<string, Pet>; left: Record<string, string> }

// Every pet there is, by id: the built-in ones and each pack's; those that draw in `pets` (with
// their specs), the rest in `left` with why. Asked of $.pixelPet, so each pack adds its own;
// where asking fails, the built-in ones. Never while drawing: a pack that is slow to answer
// holds up only this.
async function allPets($: EngineInterface): Promise<PetList> {
  const out: PetList = { specs: Object.create(null), pets: Object.create(null), left: Object.create(null) }
  let answer: Record<string, unknown> = { ...BUILT_IN }
  try {
    answer = { ...(await $.pixelPet.pets()) }
  } catch {
    answer = { ...BUILT_IN }
  }
  for (const [id, spec] of Object.entries(answer)) {
    const name = id.slice(0, 32)
    try {
      if (!PET_ID.test(id)) {
        out.left[name] = 'id に使えない文字がある'
        continue
      }
      if (BUILT_IN[id] !== undefined && JSON.stringify(spec) !== JSON.stringify(BUILT_IN[id])) {
        out.left[name] = '標準のペットと同じ id'
        continue
      }
      const got = petOf(id, spec as PetSpec)
      if ('pet' in got) {
        out.pets[id] = got.pet
        out.specs[id] = spec as PetSpec
      } else {
        out.left[name] = got.problem
      }
    } catch {
      out.left[name] = '読めないデータ'
    }
  }
  for (const [id, spec] of Object.entries(BUILT_IN)) {
    if (out.pets[id] === undefined) {
      out.pets[id] = buildPet(spec)
      out.specs[id] = spec
    }
  }
  return out
}

// The pet the person picked (`/pet`), as kept across sessions, where it is there; else the cat.
async function pickedPet($: EngineInterface, list: PetList): Promise<string> {
  const saved = await $.store.get('pet')
  return typeof saved === 'string' && Object.hasOwn(list.pets, saved) ? saved : DEFAULT_PET
}

// Ask for the pets again and keep the picked one's spec for drawing (null for the cat). Run at
// the start, once a minute and on /pet, so a pack that loads, reloads or goes away, or a pick
// made in another session, shows within a minute.
async function refreshPet($: EngineInterface): Promise<void> {
  const list = await allPets($)
  const id = await pickedPet($, list)
  const want = id === DEFAULT_PET ? null : { id, spec: list.specs[id] }
  const { value: had = null } = await $.state.get(shownPet)
  if (JSON.stringify(had) !== JSON.stringify(want)) await $.state.set(shownPet, want)
}

// The pet to draw, from what refreshPet kept: pure, so the band never waits on a pack.
async function currentPet($: EngineInterface): Promise<Pet> {
  const { value: shown = null } = await $.state.get(shownPet)
  if (shown === null) return CAT_PET
  const got = petOf(shown.id, shown.spec)
  return 'pet' in got ? got.pet : CAT_PET
}

// ---- The band ---------------------------------------------------------------------------------

// The session's API-equivalent cost, written as the status band writes it.
function usd(n: number): string {
  if (n >= 100) return `$${Math.round(n)}`
  if (n >= 10) return `$${n.toFixed(1)}`
  return `$${n.toFixed(2)}`
}

// The session's cost is counted the way the status band counts it, by the same script
// (scripts/usage.py, copied from cc-desktop-statusline): API prices summed over this session's
// transcripts on disk. /cost totals it differently, so its figure would not match the band's.

// Whether python3 can run. On macOS without the Command Line Tools, /usr/bin/python3 is a stub
// that opens an installer dialog on every call, so look for that first.
async function canRunPython($: EngineInterface): Promise<boolean> {
  try {
    if ((await $.env.get('OS')) === 'Windows_NT') return false
    const probe = 'p=$(command -v python3) || exit 1; '
      + 'if [ "$p" = /usr/bin/python3 ] && [ "$(uname)" = Darwin ]; then xcode-select -p >/dev/null 2>&1 || exit 1; fi'
    const { exitCode } = await $.process.run(['/bin/sh', '-c', probe], { timeoutMs: 5000 })
    return exitCode === 0
  } catch {
    return false
  }
}

// usage.py ships next to hooks/. Look beside $.plugin.root first, then one level up, in case
// the host reports the .claude-plugin/ directory as the root.
async function usageScript($: EngineInterface): Promise<string> {
  const direct = `${$.plugin.root}/scripts/usage.py`
  return (await $.fs.exists(direct)) ? direct : `${$.plugin.root}/../scripts/usage.py`
}

// The session's cost as usage.py counts it, or null when it cannot run.
type ScriptUsage = { usd: number | null; last: number | null; lastTs: number | null; miss: number | null; efficiency: number | null }

async function scriptUsage($: EngineInterface): Promise<ScriptUsage | null> {
  try {
    if (!(await canRunPython($))) return null
    const sid = await $.session.id()
    const { exitCode, stdout } = await $.process.run(['python3', await usageScript($), sid], { timeoutMs: 120_000 })
    if (exitCode !== 0) return null
    const out = JSON.parse(stdout) as { usd?: { session?: unknown; last?: unknown }; cache?: { lastTs?: unknown; miss?: unknown }; efficiency?: unknown }
    const num = (v: unknown) => (typeof v === 'number' ? v : null)
    const lastTs = num(out.cache?.lastTs)
    return { usd: num(out.usd?.session), last: num(out.usd?.last), lastTs: lastTs === null ? null : lastTs * 1000, miss: num(out.cache?.miss), efficiency: num(out.efficiency) }
  } catch {
    return null
  }
}

// Re-read the session's cost. Where usage.py cannot run, fall back to /cost's figure rather
// than show nothing.
// `since`: the epoch the read was started in; if anything that resets the readings (a turn's
// end, /clear, /compact, a new session) came while usage.py ran, its figures are stale and none
// are written.
async function readCost($: EngineInterface, since?: number): Promise<ScriptUsage | null> {
  const got = await scriptUsage($)
  if (since !== undefined && (await $.state.get(epoch)).value !== since) return null
  let usd = got?.usd ?? null
  // When the cache was last written, and what re-writing it would cost. Without python, the time
  // of this read stands in for the last call; if usage.py failed, the last known time stands;
  // with it, a session that has made no call yet has no cache to go cold.
  if (got !== null) await $.state.set(cacheTs, got.lastTs)
  else if (!(await canRunPython($))) await $.state.set(cacheTs, await $.clock.now())
  await $.state.set(cacheMiss, got?.miss ?? null)
  await $.state.set(efficiency, got?.efficiency ?? null)
  if (usd === null) {
    try {
      usd = (await $.session.usage()).cost?.usd ?? null
    } catch {
      usd = null
    }
  }
  await $.state.set(cost, usd)
  return got
}

// A new epoch: readings started before it are dropped when they arrive.
async function bump($: EngineInterface): Promise<number> {
  const { value: was = 0 } = await $.state.get(epoch)
  await $.state.set(epoch, was + 1)
  return was + 1
}

// How full the context is (%), as the status band's Sess figure shows it; null when unknown.
async function readCtx($: EngineInterface): Promise<void> {
  try {
    const now = await $.session.usage()
    await $.state.set(ctx, now.context.percent ?? null)
    // What is left of the 5-hour limit; none off a subscription.
    const five = now.rateLimits.find(l => l.kind === 'five_hour')
    await $.state.set(quota, five === undefined ? null : Math.max(0, 100 - five.percentUsed))
  } catch {
    await $.state.set(ctx, null)
    await $.state.set(quota, null)
  }
}

async function startReward($: EngineInterface): Promise<void> {
  await $.state.set(rewardUntil, (await $.clock.now()) + REWARD_MS)
  $.clock.after(REWARD_MS + 100, () => $.ui.invalidate('ui.render'))
}

// Runs /compact exactly as if typed (the status band does the same), then the reward. A run
// this plugin starts is dispatched beneath its own hooks, so the command.run hook (which
// catches a typed /compact, or the status band's button) does not see it.
async function compact($: EngineInterface): Promise<void> {
  try {
    const { value: before = null } = await $.state.get(ctx)
    await $.command.run({ command: 'compact', args: '' })
    await afterCompact($, before)
  } catch (err) {
    $.ui.toast(`Could not compact (${err instanceof Error ? err.message : String(err)}). Type /compact instead.`)
  }
}

// A compaction is itself an API call, and leaves a fresh, small cache behind. The fish only
// when the context did get lighter: a /compact that failed or had nothing to do earns none.
async function afterCompact($: EngineInterface, before: number | null): Promise<void> {
  await bump($)
  await readCtx($)
  const { value: after = null } = await $.state.get(ctx)
  const lighter = before === null || after === null || after < before
  if (lighter) {
    await $.state.set(cacheTs, await $.clock.now())
    await $.state.set(cacheMiss, null)
  }
  await notePoof($)
  if (lighter) await startReward($)
}

// Starts a new conversation, as if /clear were typed: nothing is left to re-read.
async function clear($: EngineInterface): Promise<void> {
  try {
    await $.command.run({ command: 'clear', args: '' })
    await afterClear($)
  } catch (err) {
    $.ui.toast(`Could not clear (${err instanceof Error ? err.message : String(err)}). Type /clear instead.`)
  }
}

// A new conversation: its own cost (usually none yet), no cache, no last turn to price.
async function afterClear($: EngineInterface): Promise<void> {
  const now = await bump($)
  await $.state.set(cacheTs, null)
  await $.state.set(cacheMiss, null)
  await $.state.set(turnCost, null)
  await readCtx($)
  await notePoof($)
  // The new conversation's cost, after the hook has answered (usage.py can take a while).
  background($, async () => {
    await readCost($, now)
    await notePoof($)
  })
}

// Work that reads usage.py (it can take seconds on a cold parse cache) runs on the clock, just
// after the hook has answered, so it never holds up the session's start or the end of a turn.
function background($: EngineInterface, work: () => Promise<void>): void {
  $.clock.after(0, () => work().catch(() => undefined))
}

// The status band's row spaces its items (5h, 7d, this month, "|", the session, the cache)
// 3 cells apart, which can push it onto a second line. Space them one cell apart instead.
// Only a row with the "|" is touched; any other tree (another band, a changed layout) passes.
const ITEM_GAP_CELLS = 1

function tightenRow(tree: RenderElement): RenderElement {
  if (tree.type !== 'Box' || !Array.isArray(tree.children)) return tree
  const hasBar = tree.children.some(k => typeof k === 'object' && k !== null && 'type' in k && k.type === 'Text'
    && Array.isArray(k.children) && k.children.length === 1 && k.children[0] === '|')
  return hasBar ? { ...tree, props: { ...tree.props, columnGap: ITEM_GAP_CELLS } } : tree
}

// A blank label about `px` wide, for a Button laid over a drawing: figure spaces (as wide as a
// digit), then punctuation spaces (as wide as a period) to come within a few px. Plain spaces
// collapse into one on the desktop, and no-break spaces are narrow. Widths are the desktop
// Button's 12 px system font, measured; its padding (both sides together) was worked out from
// which labels' first letters could and could not be pressed.
const FIGURE_SPACE_PX = 7.56
const PUNCT_SPACE_PX = 3.56
const BUTTON_PAD_PX = 13.8
function blank(px: number, roundUp = true): string {
  const figures = Math.max(0, Math.floor(px / FIGURE_SPACE_PX))
  const left = (px - figures * FIGURE_SPACE_PX) / PUNCT_SPACE_PX
  const rest = roundUp ? Math.ceil(left - 0.05) : Math.floor(left)
  return '\u2007'.repeat(figures) + '\u2008'.repeat(Math.max(figures === 0 ? 1 : 0, rest))
}

async function setMetric($: EngineInterface, m: string): Promise<void> {
  const picked = METRICS.find(x => x.id === m)?.id ?? 'cost'
  await $.state.set(metric, picked)
  await $.store.set('metric', picked)
  await $.state.set(menu, false)
  await notePoof($)
}

// The herd's size from the readings as they stand.
async function readHerd($: EngineInterface): Promise<number> {
  const { value: by = 'cost' } = await $.state.get(metric)
  const { value: spent = null } = await $.state.get(cost)
  const { value: eff = null } = await $.state.get(efficiency)
  const { value: fill = null } = await $.state.get(ctx)
  const { value: together = 0 } = await $.state.get(turns)
  const { value: left = null } = await $.state.get(quota)
  return herdBy(by, { cost: spent, efficiency: eff, context: fill, turns: together, quota: left })
}

// After anything that can change the herd's size: if it changed, note from what and when, so
// the next drawings show the smoke (drawing itself may not write). The first count is only noted.
async function notePoof($: EngineInterface): Promise<void> {
  const herd = await readHerd($)
  const { value: shown = null } = await $.state.get(shownHerd)
  if (shown === herd) return
  await $.state.set(shownHerd, herd)
  if (shown === null) return
  await $.state.set(poofFrom, shown)
  await $.state.set(poofAt, await $.clock.now())
  $.clock.after(POOF_MS + 100, () => $.ui.invalidate('ui.render'))
}

async function setMode($: EngineInterface, m: Mode): Promise<void> {
  await $.state.set(mode, m)
  await $.store.set('mode', m)
}

// /pet: with an id, that pet takes over the band (and keeps it in later sessions); without one,
// the pets there are, and those left out with why.
async function petCommand($: EngineInterface, args: string): Promise<{ text: string }> {
  const list = await allPets($)
  const current = await pickedPet($, list)
  const words = args.trim().toLowerCase().split(/\s+/).filter(w => w !== '')
  const show = () => [
    ...Object.entries(list.pets).map(([id, p]) => `${id === current ? '●' : '○'} ${id}（${p.name}）${BUILT_IN[id] === undefined ? '' : ' 標準'}`),
    ...Object.entries(list.left).map(([id, why]) => `✕ ${id}（読み込めません: ${why}）`),
  ].join('\n')
  if (words.length === 0) return { text: `ペット一覧（/pet <id> で切り替え）\n${show()}` }
  if (words.length > 1) return { text: `ペットは1つだけ選べます（例: /pet ${Object.keys(list.pets).find(id => id !== current) ?? DEFAULT_PET}）。\n${show()}` }
  const want = words[0].slice(0, 32)
  if (Object.hasOwn(list.left, want)) return { text: `「${want}」は読み込めません: ${list.left[want]}\n${show()}` }
  if (!Object.hasOwn(list.pets, want)) return { text: `「${want}」というペットはいません。\n${show()}` }
  const pet = list.pets[want]
  if (want === current) return { text: `今のペットは ${want}（${pet.name}）です。` }
  await $.store.set('pet', want)
  await $.state.set(shownPet, want === DEFAULT_PET ? null : { id: want, spec: list.specs[want] })
  return { text: `ペットを ${want}（${pet.name}）にしました。` }
}

export const register: Register = on => {
  // $.pixelPet: the pets there are. pixel-pet answers its own; each pet pack's hook adds its pets
  // to that answer.
  on('engine.create', async ($, e, next) => {
    const done = await next(e)
    return { ...done, pixelPet: { pets: async () => ({ ...BUILT_IN }) } }
  })

  on('command.run', { command: 'pet' }, async ($, e) => petCommand($, e.args))

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // Where the command cannot be added, the pet still runs; it only cannot be switched.
    await $.command.register({ name: 'pet', description: 'Pick the pet in the band (pixel-pet); no id lists them', argumentHint: '[id]' }).catch(() => undefined)
    const savedMode = await $.store.get('mode')
    const savedTurns = Number((await $.store.get('turns')) ?? 0)
    // The status band first; the pets once the person has switched to them (kept from then on).
    await $.state.set(mode, savedMode === 'pet' ? 'pet' : 'stats')
    // A reload of the mod keeps the session's coats; a new session deals them anew.
    const { value: dealt = null } = await $.state.get(coatSeed)
    if (dealt === null) await $.state.set(coatSeed, await $.clock.now())
    const savedMetric = await $.store.get('metric')
    await $.state.set(metric, METRICS.find(x => x.id === savedMetric)?.id ?? 'cost')
    await $.state.set(shownHerd, null)
    await $.state.set(turns, savedTurns)
    // A reload of the mod does not wake a sleeping herd; a new session starts awake.
    const { value: active = 0 } = await $.state.get(lastActive)
    if (active === 0) await $.state.set(lastActive, await $.clock.now())
    await $.state.set(menu, false)
    const now = await bump($)
    background($, async () => {
      await refreshPet($)
      await readCost($, now)
      await readCtx($)
      await notePoof($)
    })
    // Once a minute: re-read the context and the 5-hour limit (they move while idle too: the
    // limit resets), and redraw so an idle pet falls asleep and a cold cache shows.
    $.clock.every(60_000, () => {
      void (async () => {
        await readCtx($)
        await notePoof($)
        await refreshPet($)
      })().catch(() => undefined).finally(() => $.ui.invalidate('ui.render'))
    })
    return started
  })

  // Never hold up a prompt over the pet: if this hook fails, the prompt goes through as typed.
  on('prompt.submit', async ($, e, next) => {
    await $.state.set(lastActive, await $.clock.now())
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Subagents' turns are not the conversation's.
    if (e.agentId !== undefined) return result
    // Cheer only for a finished answer; but every turn of the conversation (an interrupted one
    // too) made calls, so the readings are refreshed whatever the reason.
    const answered = e.reason === 'answer'
    await $.state.set(lastActive, await $.clock.now())
    if (answered) {
      const { value: before = 0 } = await $.state.get(turns)
      await $.state.set(turns, before + 1)
      await $.store.set('turns', before + 1)
      // Counting turns, the herd may grow now: its smoke should not wait for usage.py.
      await notePoof($)
    }
    const { value: was = null } = await $.state.get(cost)
    const at = await bump($)
    background($, async () => {
      // The turn's cost: usage.py's count since the turn's prompt, else how far the session's
      // cost moved. The cheer starts once it is known, so the coin, the hearts and (for a costly
      // turn) the startled "!" all begin together.
      const got = await readCost($, at)
      if ((await $.state.get(epoch)).value !== at) return
      if (answered) {
        const { value: is = null } = await $.state.get(cost)
        const now = await $.clock.now()
        await $.state.set(turnCost, got?.last ?? (was !== null && is !== null ? Math.max(0, is - was) : null))
        await $.state.set(turnAt, now)
        await $.state.set(happyUntil, now + HAPPY_MS)
        // Calm down again once the cheering is over.
        $.clock.after(HAPPY_MS + 100, () => $.ui.invalidate('ui.render'))
      }
      await readCtx($)
      await notePoof($)
      $.ui.invalidate('ui.render')
    })
    return result
  })

  // A finished /compact, typed or from the status band's button: the context is light again,
  // and the herd gets its reward.
  on('command.run', { command: 'compact' }, async ($, e, next) => {
    const { value: before = null } = await $.state.get(ctx)
    const result = await next(e)
    await afterCompact($, before)
    return result
  })

  // A typed /clear: a new conversation, with no cache to go cold.
  on('command.run', { command: 'clear' }, async ($, e, next) => {
    const result = await next(e)
    await afterClear($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const { value: current = 'stats' } = await $.state.get(mode)

    // One glyph, a half-filled circle: two stacked page dots with no gap between them.
    // Top half filled is stats, bottom half is the pet. One cell wide and one row tall, so it
    // never pushes the status band onto a second line or makes the band taller. It names no
    // animal, so a new pet needs no new control.
    const toggle = (
      <Button
        key="toggle-view"
        label={current === 'pet' ? '◒' : '◓'}
        plain
        dimColor
        onPress={() => setMode($, current === 'pet' ? 'stats' : 'pet')}
      />
    )

    if (current === 'stats') {
      const inner = tightenRow(await next(e))
      // The switch keeps the band's right edge however narrow the window gets, and sits halfway
      // down it: when the status band wraps onto a second line, in the room left of the switch,
      // the switch stays centred on both lines rather than riding the top one.
      return (
        <Box flexDirection="row" alignItems="center">
          <Box flexGrow={1} flexShrink={1} marginRight={2}>{inner}</Box>
          <Box flexShrink={0}>{toggle}</Box>
        </Box>
      )
    }

    const pet = await currentPet($)
    const now = await $.clock.now()
    const { value: until = 0 } = await $.state.get(happyUntil)
    const { value: active = 0 } = await $.state.get(lastActive)
    const { value: rewarded = 0 } = await $.state.get(rewardUntil)
    const { value: fill = null } = await $.state.get(ctx)
    const { value: wrote = null } = await $.state.get(cacheTs)
    const { value: miss = null } = await $.state.get(cacheMiss)
    // The cache has expired: between turns, an hour past the last call.
    const cold = !e.props.isWorking && now >= rewarded && now >= until && wrote !== null && now - wrote > CACHE_TTL_MS
    const mood: Mood = now < rewarded ? 'reward'
      : now < until ? 'happy'
      : e.props.isWorking ? 'working'
      : cold || (active > 0 && now - active > SLEEP_AFTER_MS) ? 'sleep'
      : 'idle'
    const { value: spent = null } = await $.state.get(cost)
    const info = spent === null ? '' : usd(spent)
    const { value: lastTurn = null } = await $.state.get(turnCost)
    const { value: endedAt = 0 } = await $.state.get(turnAt)
    const turn: Turn | null = lastTurn !== null && lastTurn >= 0.005 && now - endedAt < COIN_MS ? { usd: lastTurn, agoMs: now - endedAt } : null
    // What carrying on would cost after the cache went cold, said in the beckoning cat's bubble.
    const price = cold && miss !== null ? `+${usd(miss)}` : ''
    const { value: by = 'cost' } = await $.state.get(metric)
    const { value: eff = null } = await $.state.get(efficiency)
    const { value: left = null } = await $.state.get(quota)
    const { value: together = 0 } = await $.state.get(turns)
    const reading: Reading = { cost: spent, efficiency: eff, context: fill, turns: together, quota: left }
    const label = metricLabel(by, reading)
    const herd = herdBy(by, reading)
    const { value: seed = 0 } = await $.state.get(coatSeed)
    const order = coatsFor(seed ?? 0, pet)
    const { value: poofedAt = 0 } = await $.state.get(poofAt)
    const { value: was = 0 } = await $.state.get(poofFrom)
    const poof: Poof | null = now - poofedAt < POOF_MS ? { from: was, agoMs: now - poofedAt } : null
    const { value: menuOpen = false } = await $.state.get(menu)
    const openMenu = () => $.state.set(menu, !menuOpen)
    // The open menu: every measure's figure, as the band shows it beside the bar (with names the
    // menu did not fit on one line), the one in use bright, the rest dim. Picking
    // one makes it the herd's measure and closes the menu.
    const choices = METRICS.map(x => (
      <Button key={`metric-${x.id}`} label={metricLabel(x.id, reading)} plain dimColor={x.id !== by} onPress={() => setMetric($, x.id)} />
    ))
    const full = fill !== null && fill >= HEAVY_CONTEXT_PCT
    // The herd moves heavily (slow, slumping) only while awake; it is chubby asleep too.
    const heavy = full && mood !== 'reward' && mood !== 'sleep'
    // The beckoning cat is the button, between turns only, asleep or awake: /compact while the
    // context is heavy; /clear, with the price of carrying on, once the cache has gone cold and
    // that price is worth avoiding (without a price, on a heavy context).
    const canClear = cold && (miss !== null ? miss >= CLEAR_NUDGE_USD : full)
    const canCompact = full && mood !== 'reward' && !e.props.isWorking
    const word = canClear ? '/clear' : '/compact'
    let beckon = canClear || (full && mood !== 'reward')
    // A costly turn startles the cheering cats ("!" instead of hearts), for that cheer alone.
    const startled = mood === 'happy' && lastTurn !== null && lastTurn >= TURN_USD.high && endedAt >= until - HAPPY_MS
    // How long ago the cheer or the reward began, for animations that run from it.
    const since = mood === 'reward' ? now - (rewarded - REWARD_MS) : mood === 'happy' ? now - (until - HAPPY_MS) : 0
    const press = () => (canClear ? clear($) : compact($))

    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      // The menu takes the band while it is open: the cats step aside for the five measures.
      if (menuOpen) {
        return (
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1}>
            <Box flexGrow={1} />
            {choices}
            {toggle}
          </Box>
        )
      }
      // Room for the beckoning cat and its bubble (about 11 cells), then the figure and the next
      // message's price after a cold cache, drawn together right of the bar. On a band too narrow
      // for all of it beside a short track, the next price goes, then the beckoning cat.
      const room = (cat: boolean) => (cat ? Math.ceil(MANEKI_W / CELL_PX) + 1 : 0) + cellsOf(label) + 1
      if (e.props.bodyColumns - room(beckon) < 16 + 12) beckon = false
      const reserve = room(beckon)
      const width = stageWidth(e.props.bodyColumns - reserve, '')
      const alt = `${pet.name} ${herd}匹: ${pet.lines[mood]}${cold ? '（キャッシュ切れ）' : ''} (${label})`
      // Beside the beckoning cat the figure sits closer than it would to the bar.
      const gap = beckon ? 2 : BAR_GAP_PX
      const figureW = costWidth(label, '', gap)
      // The Svg sits directly in the row: wrapped in a Box, its frame gains a line's
      // descender below it and the band grows taller than the status row. The spacer takes
      // whatever the width estimate leaves, at the band's left edge. The track ends at the bar;
      // right of it, with no gaps, the beckoning cat when there is one, then the figure, in the
      // status band's own type. A blank plain Button is laid over the cat and over the figure
      // (a drawing cannot be pressed, a Button can): pressing the cat runs /compact or /clear,
      // pressing the figure opens the menu of measures.
      return (
        <Box flexDirection="row" flexWrap="nowrap" alignItems="center" columnGap={0}>
          <Box flexGrow={1} />
          <Svg source={stage(pet, mood, width, now, herd, Math.round(until), '', heavy, '', cold, turn, order, poof, since, false, fatOf(fill), beckon, startled)} width={width} height={VIEW_H * SCALE} alt={alt} isInteractive />
          <Svg source={barSvg()} width={2} height={VIEW_H * SCALE} alt="|" />
          {beckon ? (
            <Box position="relative" flexShrink={0}>
              <Svg source={manekiSvg(pet, word, canClear ? price : '')} width={MANEKI_W} height={VIEW_H * SCALE} alt={`${pet.name === '猫' ? '招き猫' : `手招きする${pet.name}`}が吹き出しで「${canClear && price !== '' ? `${price} / ` : ''}${word}」と手招き`} isInteractive />
              {canClear || canCompact ? (
                <Box position="absolute" top={0} left={0}>
                  <Button key="maneki" label={blank(MANEKI_W - BUTTON_PAD_PX, false)} plain onPress={press} />
                </Box>
              ) : null}
            </Box>
          ) : null}
          <Box position="relative" flexShrink={0}>
            <Svg source={costSvg(label, '', gap)} width={figureW} height={VIEW_H * SCALE} alt={label} />
            {/* Over the figure's text alone: set against the picture's right end (the text ends
                a few px short of it), its blank cut by the Button's own padding, so neither the
                gap after the bar nor the one before the switch can be pressed. */}
            <Box position="absolute" top={0} right={0}>
              <Button key="herd-label" label={blank(labelWidth(label) + (beckon ? 0 : 2) - BUTTON_PAD_PX)} plain onPress={openMenu} />
            </Box>
          </Box>
          {toggle}
        </Box>
      )
    }

    return (
      <Box flexDirection="row" columnGap={1}>
        <Text>{pet.face[mood]}</Text>
        <Text>{pet.lines[mood]}</Text>
        {menuOpen ? choices : <Button key="herd-label" label={label} plain dimColor onPress={openMenu} />}
        {turn === null ? null : <Text dimColor wrap="truncate-end">{`+${usd(turn.usd)}`}</Text>}
        {canClear || canCompact ? <Button key="compact" label={canClear && price !== '' ? `${word} (${price})` : word} onPress={press} /> : null}
        {toggle}
      </Box>
    )
  })
}
