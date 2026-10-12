// A pet as data, and the kit that brings one to life.
//
// A pet is drawn, not programmed: a PetSpec holds its pixel art and its words, nothing else, so
// a new animal is one data file (see pets/cat.ts). The kit owns the choreography: how the body
// bobs as it runs, rocks on its back, sinks into sleep, chomps its reward; where each layer of
// art goes in each pose; the ultra coat; the theme colors. Every pet moves the same way and
// looks like itself.
//
// The canvas, the letters and every field: PixelPetSpec in ../types/index.d.ts, the contract
// pet packs are written against.

import type { PixelPetArt, PixelPetCell, PixelPetPoseArt, PixelPetSpec } from '../types'
import { flipBook, futonLeft, pixels, REWARD_MS, rng, type Mood, type Palette, type Pose, type Rows } from './sprite.ts'

export type PetSpec = PixelPetSpec
export type PetArt = PixelPetArt
export type PetPoseArt = PixelPetPoseArt
export type PetCell = PixelPetCell

export type Pet = {
  name: string
  /**
   * The pet's trunk for a mood: body and face, without legs or tail, in sprite pixels, facing
   * right. `coat` picks one of the pet's looks, so a herd is not all the same animal. Drawn
   * once per pet and reused by every pose, which keeps a herd's SVG small. `fat` (0-2) is how
   * full the context is: a fuller one makes a rounder pet.
   */
  trunk: (mood: Mood, coat: number, fat?: number) => string
  /**
   * The pet in a pose, facing right, at most `width` wide (a little more for reaching paws)
   * and 12 tall, drawing its trunk with `trunk` (a reference to the shared one). Asleep, the
   * pet lies down whatever the pose.
   */
  body: (mood: Mood, coat: number, pose: Pose, trunk: string, fat?: number) => string
  /** The sprite's width in sprite pixels; it turns around in place across this width. */
  width: number
  /** How many coats a herd draws from; the last is the ultra coat, where the pet has one. */
  coats: number
  /** Whether the last coat is the ultra coat (kept for a full herd). */
  ultra: boolean
  /** CSS the sprite's classes need for one coat (theme-dependent colors), or ''. `nowMs` lets
   *  timed effects continue across redraws instead of restarting. */
  css: (coat: number, nowMs: number) => string
  /** What sticks out of the futon, swishing, left of the canvas; '' for nothing. */
  futonTail: (coat: number) => string
  /** How far left of the canvas the futon and the tail reach, in sprite px. */
  futonReach: number
  /** The beckoning figurine, 16 x 12, self-contained (its own colors). */
  maneki: () => string
  lines: Record<Mood, string>
  face: Record<Mood, string>
}

// The stride: one loop of the run's legs and tail.
const STRIDE_S = 0.4
// The figurine's room beside the bubble, in sprite px.
const MANEKI_SLOT = 16
// Each stage of the reward holds for a share of its time, then the plate is empty.
const EAT_STAGES = [0, 0.3, 0.6, 0.8]

function art(a: PetArt, c: Palette): string {
  return 'frames' in a ? flipBook(a.frames.map(rows => pixels(rows, 0, 0, c)), a.each) : pixels(a, 0, 0, c)
}
function layers(list: readonly PetArt[] | undefined, c: Palette): string {
  return (list ?? []).map(a => art(a, c)).join('')
}

export function buildPet(spec: PetSpec): Pet {
  const coats: Palette[] = spec.ultra === undefined ? [...spec.coats] : [...spec.coats, ULTRA_COAT]

  // Legs, paws and tail (L, P) take their colors from classes, so they can change with the
  // theme: fur and white on a dark background, the outline color on a light one, where white
  // paws and pale legs would vanish.
  const coatOf = (i: number): Palette => {
    const j = i % coats.length
    return { ...coats[j], L: `.cl${j}`, P: `.cp${j}` }
  }

  const bodyRows = (fat: number): Rows => (fat > 0 && spec.fat !== undefined ? spec.fat[Math.min(2, fat) - 1] : spec.body)

  const body = (c: Palette, fat: number) => {
    if (c.u !== undefined && spec.ultra !== undefined) return ultraBody(spec.ultra, bodyRows(fat))
    return pixels(bodyRows(fat), 0, 0, c) + (spec.patches === undefined ? '' : pixels(spec.patches, 0, 0, c))
  }

  const face = (mood: Mood, c: Palette) => {
    const eyes = spec.eyes[mood]
    if (c.u !== undefined && spec.ultra !== undefined) return eyes === undefined ? '' : ultraFace(spec.eyes.cover, eyes)
    return eyes === undefined ? '' : pixels(spec.eyes.cover, 0, 0, c) + pixels(eyes, 0, 0, c)
  }

  const pose = (p: Pose, c: Palette, trunk: string, fat: number): string => {
    // A pose the pet has no drawing for borrows one: a leap is run through (rather than glided
    // standing still), the reward is eaten standing (its food still shown), the rest stand.
    const own = p === 'slump' ? spec.poses.sleep : spec.poses[p]
    const look = own ?? (p === 'jump' ? spec.poses.run : spec.poses.stand)
    const drawn = own !== undefined || p === 'eat' ? p : p === 'jump' ? 'run' : 'stand'
    const behind = layers(look.behind, c)
    const front = layers(look.front, c)
    switch (drawn) {
      case 'run': {
        // The body rises a little on the stretched frame.
        const bob = `<animateTransform attributeName="transform" type="translate" values="0 -0.5;0 0;0 0;0 -0.5" calcMode="discrete" dur="${STRIDE_S}s" repeatCount="indefinite"/>`
        // Legs first, so a chubby belly hangs in front of them.
        return `${behind}<g>${trunk}${front}${bob}</g>`
      }
      case 'sleep':
      case 'slump': {
        // Lying on the ground, breathing slowly. A chubby belly already reaches the ground, so
        // it sinks less (and none of it is cut off below the picture).
        const dy = 2 - Math.min(2, fat)
        const breathe = `<animateTransform attributeName="transform" type="translate" values="0 ${dy};0 ${dy - 0.4};0 ${dy}" dur="3s" repeatCount="indefinite"/>`
        return `<g transform="translate(0 ${dy})">${behind}${trunk}${front}${breathe}</g>`
      }
      case 'roll': {
        // On its back, curled up: the body turned over (back on the ground), squeezed a little
        // so it reads round, rocking side to side on its back.
        const mid = spec.width / 2
        const rock = `<animateTransform attributeName="transform" type="rotate" values="-14 ${mid} 11;14 ${mid} 11;-14 ${mid} 11" keyTimes="0;.5;1" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" dur="1.4s" repeatCount="indefinite"/>`
        return `<g>${rock}<g transform="translate(${mid} 0) scale(.88 1) translate(-${mid} 0)">${behind}<g transform="translate(0 12) scale(1 -1)">${trunk}</g>${front}</g></g>`
      }
      case 'stretch':
        // A big stretch: rear up, head and chest lowered, eyes shut happily.
        return `${behind}<g transform="skewY(8)">${trunk}${face('happy', c)}</g>${front}`
      case 'groom':
        return `${behind}${trunk}${face('sleep', c)}${front}`
      case 'eat': {
        const food = spec.food === undefined ? '' : spec.food.frames.map((rows, k) => {
          const values = EAT_STAGES.map((_, j) => (j === k ? 1 : 0)).join(';')
          return `<g opacity="${k === 0 ? 1 : 0}">${pixels(rows, 0, 0, spec.food!.colors)}`
            + `<animate attributeName="opacity" values="${values}" keyTimes="${EAT_STAGES.join(';')}" calcMode="discrete" dur="${REWARD_MS / 1000}s" begin="0s" fill="freeze"/></g>`
        }).join('')
        const chomp = '<animateTransform attributeName="transform" type="translate" values="0 0;0 .6" calcMode="discrete" dur=".5s" repeatCount="indefinite"/>'
        return `${behind}<g>${trunk}${chomp}</g>${front}${food}`
      }
      default:
        return `${behind}${trunk}${front}`
    }
  }

  const css = (i: number, nowMs: number) => {
    const j = i % coats.length
    const c = coats[j]
    if (c.u !== undefined && spec.ultra !== undefined) return ultraCss(spec.ultra, j, nowMs)
    return `.cl${j}{fill:${c.o}}.cp${j}{fill:${c.w}}@media (prefers-color-scheme:light){.cl${j},.cp${j}{fill:${c.k}}}`
  }

  const futonTail = (coat: number) => {
    const tail = spec.futonTail
    if (tail === undefined) return ''
    const w = Math.max(...tail.flat().map(r => r.length))
    return flipBook(tail.map(rows => pixels(rows, futonLeft(spec.width) - w, 0, { L: `.cl${coat % coats.length}` })), 0.9)
  }

  const maneki = () => {
    const m = spec.maneki
    if (m !== undefined) return pixels(m.body, 0, 0, m.colors) + flipBook(m.paw.map(r => pixels(r, 0, 0, m.colors)), 0.4)
    // The pet's own beckon pose, turned to face the bubble on its left, in the figurine's 16 px.
    const c = coatOf(0)
    const at = spec.width + Math.floor((MANEKI_SLOT - spec.width) / 2)
    return `<style>${css(0, 0)}</style><g transform="translate(${at} 0) scale(-1 1)">${pose('beckon', c, body(c, 0) + face('happy', c), 0)}</g>`
  }

  return {
    name: spec.name,
    width: spec.width,
    coats: coats.length,
    ultra: spec.ultra !== undefined,
    css,
    trunk: (mood, coat, fat = 0) => body(coatOf(coat), fat) + face(mood, coatOf(coat)),
    body: (mood, coat, p, trunk, fat = 0) => pose(mood === 'sleep' ? 'slump' : p, coatOf(coat), trunk, fat),
    futonTail,
    futonReach: -futonLeft(spec.width) + (spec.futonTail === undefined ? 0 : Math.max(...spec.futonTail.flat().map(r => r.length))),
    maneki,
    lines: spec.lines,
    face: spec.face,
  }
}

// Which coat each of the herd's ten places wears: the ordinary coats in a random order (dealt
// round again where a pet has fewer than ten), so a pet that joins wears one not yet seen, at
// random; the ultra coat, where the pet has one, only the tenth, the reward for a full herd.
// Worked out from the session's seed and the pet each time, so a pet keeps its coat through
// the session, and a switch of pet (here or in another session) deals that pet's coats.
export const HERD_MAX = 10
export function coatsFor(seed: number, pet: Pet): number[] {
  const r = rng(seed)
  const ordinary = pet.ultra ? pet.coats - 1 : pet.coats
  const coats = Array.from({ length: ordinary }, (_, i) => i)
  for (let i = coats.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [coats[i], coats[j]] = [coats[j], coats[i]]
  }
  return Array.from({ length: HERD_MAX }, (_, i) => (pet.ultra && i === HERD_MAX - 1 ? ordinary : coats[i % ordinary]))
}

// A pack's pet is checked before the band draws it, so a broken or oversized one is left out
// rather than blanking the band: every value is of its kind (colors as #hex, numbers finite,
// cells on the canvas, text one short line), every drawing within bounds, and it builds and
// draws each pose, mood, coat and roundness without throwing, each part about as small as the
// cat's, so a herd of ten stays within the band's picture limit. The width is at most 16, the
// room the futon and the figurine have.
const PET_LIMITS = { width: [10, 16], rows: 12, frames: 8, coats: 10, cells: 32, trunk: 2800, pose: 2000, figurine: 2600, name: 20, line: 80 } as const
export const PET_ID = /^[a-z0-9-]{1,32}$/
const COLOR = /^#[0-9a-f]{3,8}$/i
const MOODS: readonly Mood[] = ['reward', 'happy', 'working', 'sleep', 'idle']
const POSES: readonly Pose[] = ['run', 'jump', 'stand', 'roll', 'stretch', 'groom', 'scratch', 'slump', 'eat', 'beckon']
// Letters a pack's palette may not name: legs and paws are colored by the theme, and u marks the
// ultra coat.
const RESERVED = new Set(['L', 'P', 'u', '.'])

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v)

// The pet, or why it cannot be drawn (in a few words, for /pet's list).
export function inspectPet(spec: PetSpec): { pet: Pet } | { problem: string } {
  try {
    const s = spec as unknown as Record<string, unknown>
    if (!isObject(s)) return { problem: 'ペットのデータでない' }
    const [minW, maxW] = PET_LIMITS.width
    if (!isText(s.name, PET_LIMITS.name)) return { problem: `name が ${PET_LIMITS.name} 字までの1行でない` }
    if (!Number.isInteger(s.width) || (s.width as number) < minW || (s.width as number) > maxW) return { problem: `width が ${minW}〜${maxW} の整数でない` }
    const width = s.width as number

    const palette = (v: unknown, need: string) => isObject(v)
      && Object.entries(v).every(([k, c]) => k.length === 1 && !RESERVED.has(k) && typeof c === 'string' && COLOR.test(c))
      && [...need].every(k => k in v)
    if (!Array.isArray(s.coats) || s.coats.length < 1 || s.coats.length > PET_LIMITS.coats - (s.ultra === undefined ? 0 : 1)) return { problem: '毛色の数が合わない' }
    if (!s.coats.every(c => palette(c, 'kowpe'))) return { problem: '毛色は k o w p e を #色 で（L P u は使えない）' }

    const rows = (v: unknown, wide = maxW + 4) => Array.isArray(v) && v.length <= PET_LIMITS.rows && v.every(r => typeof r === 'string' && r.length <= wide)
    const art = (v: unknown) => rows(v) || (isObject(v) && Array.isArray(v.frames) && v.frames.length >= 1 && v.frames.length <= PET_LIMITS.frames
      && v.frames.every(f => rows(f)) && typeof v.each === 'number' && v.each >= 0.05 && v.each <= 5)
    const poseArt = (v: unknown) => isObject(v) && ['behind', 'front'].every(k => v[k] === undefined || (Array.isArray(v[k]) && (v[k] as unknown[]).length <= 6 && (v[k] as unknown[]).every(art)))
    if (!rows(s.body)) return { problem: `body が ${PET_LIMITS.rows} 行・幅 ${maxW + 4} を超える` }
    if (s.fat !== undefined && !(Array.isArray(s.fat) && s.fat.length === 2 && s.fat.every(b => rows(b)))) return { problem: 'fat は2つの体' }
    if (s.patches !== undefined && !rows(s.patches)) return { problem: 'patches の絵が大きすぎる' }
    const eyes = s.eyes
    if (!isObject(eyes) || !rows(eyes.cover) || !Object.entries(eyes).every(([k, v]) => (k === 'cover' || MOODS.includes(k as Mood)) && rows(v))) return { problem: 'eyes は cover と気分ごとの絵' }
    const poses = s.poses
    if (!isObject(poses) || !['run', 'stand', 'sleep'].every(k => k in poses)) return { problem: 'poses に run・stand・sleep がない' }
    if (!Object.entries(poses).every(([k, v]) => [...POSES, 'sleep'].includes(k as Pose) && poseArt(v))) return { problem: 'poses の絵が大きすぎるか、知らないポーズがある' }
    const food = s.food
    if (food !== undefined && !(isObject(food) && palette(food.colors, '') && Array.isArray(food.frames) && food.frames.length >= 1 && food.frames.length <= 3 && food.frames.every(f => rows(f)))) return { problem: 'food は3コマまでの絵と #色' }
    if (s.futonTail !== undefined && !(Array.isArray(s.futonTail) && s.futonTail.length >= 1 && s.futonTail.length <= PET_LIMITS.frames && s.futonTail.every(f => rows(f, 8)))) return { problem: 'futonTail の絵が大きすぎる（幅 8 まで）' }
    const maneki = s.maneki
    if (maneki !== undefined && !(isObject(maneki) && palette(maneki.colors, '') && rows(maneki.body, MANEKI_SLOT)
      && Array.isArray(maneki.paw) && maneki.paw.length >= 1 && maneki.paw.length <= PET_LIMITS.frames && maneki.paw.every(f => rows(f, MANEKI_SLOT)))) return { problem: 'maneki は 16×12 までの絵と #色' }
    const ultra = s.ultra
    if (ultra !== undefined) {
      const cell = (c: unknown) => Array.isArray(c) && c.length === 2 && Number.isInteger(c[0]) && Number.isInteger(c[1]) && c[0] >= 0 && c[0] < width + 4 && c[1] >= 0 && c[1] < 12
      const cells = (v: unknown) => Array.isArray(v) && v.length <= PET_LIMITS.cells && v.every(cell)
      if (!(isObject(ultra) && cells(ultra.shine) && cell(ultra.nose) && cells(ultra.speckle) && (ultra.knob === undefined || cells(ultra.knob))
        && Array.isArray(ultra.twinkles) && ultra.twinkles.length <= 8 && ultra.twinkles.every(t => Array.isArray(t) && t.length === 2 && t.every(cell)))) return { problem: 'ultra のマスが方眼の外か多すぎる' }
    }
    for (const k of ['lines', 'face'] as const) {
      const words = s[k]
      if (!isObject(words) || !MOODS.every(m => isText(words[m], PET_LIMITS.line))) return { problem: `${k} が気分ごとに ${PET_LIMITS.line} 字までの1行でない` }
    }

    const pet = buildPet(spec)
    for (let coat = 0; coat < pet.coats; coat++) {
      if (pet.css(coat, 0).length > PET_LIMITS.trunk || pet.futonTail(coat).length > PET_LIMITS.pose) return { problem: '絵が大きすぎる' }
      for (const m of MOODS) for (let fat = 0; fat <= 2; fat++) {
        if (pet.trunk(m, coat, fat).length > PET_LIMITS.trunk) return { problem: '体の絵が大きすぎる' }
        for (const p of POSES) if (pet.body(m, coat, p, '<use href="#t0"/>', fat).length > PET_LIMITS.pose) return { problem: `${p} の絵が大きすぎる` }
      }
    }
    if (pet.maneki().length > PET_LIMITS.figurine) return { problem: '手招きの絵が大きすぎる' }
    return { pet }
  } catch (err) {
    return { problem: `描けない（${err instanceof Error ? err.message : String(err)}）`.slice(0, 120) }
  }
}

export function checkPet(spec: PetSpec): Pet | null {
  const got = inspectPet(spec)
  return 'pet' in got ? got.pet : null
}

// ---- The ultra coat: Claude Code's Ultracode effort slider, as a pet -------------------------
// The slider's track is a dot matrix: small square dots on a dark pill, dim gray at one end
// brightening to lavender at the other, a few dots brighter than their neighbours, a white
// knob at the bright end. So the fur is drawn as that matrix: each sprite pixel a 2/3-size dot
// (2 device px with a 1 px gap on Retina) on a dark track, gray at the tail to lavender at the
// head, twelve dots a little brighter and ten twinkling. The colors keep moving: the head's
// lavender drifts through periwinkle and orchid, and a band of light sweeps tail to head.
// Where its dots go is the pet's (`ultra`).
type CellRun = [number, number, number] // x, y, length

const ULTRA_INK = '#1c1926'
// o, w and p here are only its representative colors; u marks it.
const ULTRA_COAT: Palette = { k: ULTRA_INK, o: '#958bcc', w: '#d9d3fa', p: '#eaa2d6', e: ULTRA_INK, u: 'ultra' }
// The twinkling pairs' periods and phases, each pair on its own so together they never visibly
// repeat.
const ULTRA_TWINKLE_TIMES: [number, number][] = [[1.9, 0.3], [2.3, 1.1], [2.9, 2.0], [3.1, 0.6], [3.7, 2.7]]
const ULTRA_SWEEP_S = 1.8
const ULTRA_HUE_S = 4
const ULTRA_DEFS = '<defs><linearGradient id="ucg" gradientUnits="userSpaceOnUse" x2="16"><stop class="ug0"/><stop offset=".3" class="ug1"/><stop offset=".6" class="ug2"/><stop offset=".9" class="ug3"/></linearGradient>'
  + '<linearGradient id="ucb" gradientUnits="userSpaceOnUse" x2="16"><stop class="ub0"/><stop offset=".9" class="ub1"/></linearGradient>'
  // A band of light sweeping tail to head over the dots, like the slider being dragged up to
  // Ultracode: transparent but for a soft bright stripe, moved along by its transform.
  + `<linearGradient id="ush" gradientUnits="userSpaceOnUse" x2="16"><stop offset=".25" class="sh0"/><stop offset=".5" class="sh1"/><stop offset=".75" class="sh0"/>`
  + `<animateTransform attributeName="gradientTransform" type="translate" values="-12 0;16 0" dur="${ULTRA_SWEEP_S}s" repeatCount="indefinite"/></linearGradient></defs>`

// Runs of the cells in `rows` whose letter is one of `letters`, leaving out `except`.
function runsOf(rows: Rows, letters: string, except: PetCell[] = []): CellRun[] {
  const out: CellRun[] = []
  rows.forEach((row, y) => {
    let start = -1
    for (let x = 0; x <= row.length; x++) {
      const on = x < row.length && letters.includes(row[x]) && !except.some(([cx, cy]) => cx === x && cy === y)
      if (on && start < 0) start = x
      if (!on && start >= 0) {
        out.push([start, y, x - start])
        start = -1
      }
    }
  })
  return out
}

const single = (cells: PetCell[]): CellRun[] => cells.map(([x, y]) => [x, y, 1])
// Whole cells, as the other coats draw them.
const blocks = (runs: CellRun[]) => runs.map(([x, y, n]) => `M${x} ${y}h${n}v1h-${n}z`).join('')
// The dots: one dashed stroke per run, the dash restarting at each run, so n cells give n dots.
const dots = (runs: CellRun[]) => runs.map(([x, y, n]) => `M${x} ${y + 0.333}h${n}`).join('')

function ultraBody(u: NonNullable<PetSpec['ultra']>, body: Rows): string {
  const knob = u.knob ?? []
  return ULTRA_DEFS
    + `<path fill="${ULTRA_INK}" d="${blocks(runsOf(body, 'ke'))}"/>`
    + `<path class="ut" d="${blocks(runsOf(body, 'owp', [...u.shine, u.nose]))}"/>`
    + `<path class="ud uf" d="${dots(runsOf(body, 'o', knob))}"/>`
    + `<path class="ud ush" d="${dots(runsOf(body, 'ow', [...knob, ...u.shine]))}"/>`
    + `<path class="ud ub" d="${dots(runsOf(body, 'w', u.shine))}"/>`
    + `<path class="ud up" d="${dots(runsOf(body, 'p', [u.nose]))}"/>`
    + `<path class="ud ux" d="${dots(single(u.speckle))}"/>`
    + `<path class="uk" d="${blocks(single([...knob, ...u.shine]))}"/>`
    + `<path class="un" d="${blocks(single([u.nose]))}"/>`
    + u.twinkles.map((cells, i) => `<path class="ud us u${i}" d="${dots(single(cells))}"/>`).join('')
}

// Happy and sleepy eyes: the open eyes covered with track and dots, then the mood's eyes.
function ultraFace(cover: Rows, eyes: Rows): string {
  const under = runsOf(cover, 'o')
  return `<path class="ut" d="${blocks(under)}"/><path class="ud uf" d="${dots(under)}"/>` + pixels(eyes, 0, 0, { e: ULTRA_INK })
}

// Dark colors first, then the light theme's: there "brighter" means deeper ink, since pale dots
// would vanish on a light band. Legs, tail and paws follow the herd's rule (outline color on
// light). Twinkle phases come from the wall clock, so a redraw continues them.
function ultraCss(u: NonNullable<PetSpec['ultra']>, j: number, nowMs: number): string {
  const twinkles = u.twinkles.map((_, i) => {
    const [period, offset] = ULTRA_TWINKLE_TIMES[i % ULTRA_TWINKLE_TIMES.length]
    return `.u${i}{opacity:0;animation:tw ${period}s step-end -${((nowMs / 1000 + offset) % period).toFixed(2)}s infinite}`
  }).join('')
  return '.ud{fill:none;stroke-width:.667;stroke-dasharray:.667 .333}.uf{stroke:url(#ucg)}.ub{stroke:url(#ucb)}'
    + '.up{stroke:#eaa2d6}.ux{stroke:#fff;stroke-opacity:.26}.uk{fill:#fff}.un{fill:#f4a9d2}.ut{fill:#37363e}.us{stroke:#e6e1ff}'
    + '.ush{stroke:url(#ush)}.sh0{stop-color:#fff;stop-opacity:0}.sh1{stop-color:#fff;stop-opacity:.9}'
    // The front of the gradient drifts through periwinkle and orchid, the head ahead of the body.
    + `@keyframes uh2{0%,100%{stop-color:#958bcc}33%{stop-color:#6f8fe0}66%{stop-color:#b07ad8}}`
    + `@keyframes uh3{0%,100%{stop-color:#b5abf0}33%{stop-color:#8fb0ff}66%{stop-color:#d39cf5}}`
    + `.ug2{animation:uh2 ${ULTRA_HUE_S}s linear infinite}.ug3{animation:uh3 ${ULTRA_HUE_S}s linear -0.6s infinite}`
    + '.ug0{stop-color:#5c5b64}.ug1{stop-color:#6b6783}.ug2{stop-color:#958bcc}.ug3{stop-color:#b5abf0}.ub0{stop-color:#77768a}.ub1{stop-color:#d9d3fa}'
    + '@keyframes tw{0%,18%,100%{opacity:0}4%,14%{opacity:.5}8%{opacity:1}}' + twinkles
    + `.cl${j}{fill:#77748a}.cp${j}{fill:#d9d3fa}`
    + '@media (prefers-color-scheme:light){.ut{fill:#e4e1f1}.ug0{stop-color:#9c9ba3}.ug1{stop-color:#948fb4}.ug2{stop-color:#8172d6}'
    + '.ug3{stop-color:#6a55e2}.ub0{stop-color:#c4c3cc}.ub1{stop-color:#b0a5f2}.ux{stroke:#2a1f8a}.us{stroke:#4a33e0}.up{stroke:#d77fb8}'
    + `.un{fill:#e58ab9}.sh0,.sh1{stop-color:#3a22d8}.sh1{stop-opacity:.75}.cl${j},.cp${j}{fill:${ULTRA_INK}}`
    + `.ug2{animation-name:uh2l}.ug3{animation-name:uh3l}}`
    + '@keyframes uh2l{0%,100%{stop-color:#8172d6}33%{stop-color:#5a7fd8}66%{stop-color:#9a5fcf}}'
    + '@keyframes uh3l{0%,100%{stop-color:#6a55e2}33%{stop-color:#3d6ff0}66%{stop-color:#a446d8}}'
    + '@media (prefers-reduced-motion:reduce){.us,.ug2,.ug3{animation:none}.ush{display:none}}'
    // At 1x the 2/3 dots would blur into stripes anyway; draw solid gradient rows there.
    + '@media (max-resolution:1.5dppx){.ud{stroke-dasharray:none}}'
}
