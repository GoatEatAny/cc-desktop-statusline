// pixel-pet's contract: the values it keeps in $.state, and $.pixelPet, through which other mods
// (pet packs) add pets of their own.

export type PixelPetMode = 'stats' | 'pet'
export type PixelPetMetric = 'cost' | 'efficiency' | 'context' | 'turns' | 'quota'
export type PixelPetMood = 'reward' | 'happy' | 'working' | 'sleep' | 'idle'

// Pixel art: one string per row, top to bottom, one letter per pixel; "." (or a letter the
// palette does not name) is transparent, and a short or empty row is transparent past its end.
export type PixelPetRows = readonly string[]
// Letters to colors, as #hex (#rgb, #rrggbb; with alpha, #rgba, #rrggbbaa). A pack's palettes may
// not name L, P (the theme colors legs and paws) or u (the ultra coat).
export type PixelPetPalette = { readonly [letter: string]: string }
// A still layer, or a flipbook of layers shown in turn, each for `each` seconds.
export type PixelPetArt = PixelPetRows | { readonly frames: readonly PixelPetRows[]; readonly each: number }
// The layers of a pose, besides the body: drawn behind it (legs a belly hangs over) and in
// front of it (tail, paws), each in order.
export type PixelPetPoseArt = { readonly behind?: readonly PixelPetArt[]; readonly front?: readonly PixelPetArt[] }
export type PixelPetCell = readonly [number, number]

/**
 * A pet, as data: its pixel art and its words. pixel-pet moves it (runs, sleeps, rolls, eats)
 * the way it moves the cat; see pixel-pet's hooks/pets/cat.ts for a whole one, and its README.
 *
 * Canvas: `width` x 12 sprite pixels, facing right, its feet on the bottom row. Every piece of
 * art is drawn on that same canvas, from its top-left corner, so pieces line up by where they
 * are drawn (a few pixels past the right edge are fine, for a reaching paw).
 * Letters: k outline, o fur, w light fur (belly, muzzle), p pink (ears, nose, cheeks), e eyes,
 * a and b patches (a coat without them leaves them out); L leg or tail, P paw. A coat gives
 * colors to k o w p e (and a b); legs and paws take theirs from the coat, by the theme.
 */
export type PixelPetSpec = {
  /** Its name, as people call it: one line, up to 20 characters. */
  readonly name: string
  /** The canvas's width in sprite pixels, a whole number from 10 to 16 (the futon's and the
   *  figurine's room): the pet turns around in place across it. */
  readonly width: number
  /** The herd's coats, in letters to colors (k o w p e, and a b for patches); at least one. */
  readonly coats: readonly PixelPetPalette[]
  /** The body and face, without legs or tail, eyes open. */
  readonly body: PixelPetRows
  /** Rounder bodies as the context fills (40%, 70%); without them, it stays as it is. */
  readonly fat?: readonly [PixelPetRows, PixelPetRows]
  /** Patches over the body, in a and b, for the coats that color them. */
  readonly patches?: PixelPetRows
  /** Eyes by mood, drawn over `cover`, which paints out the open ones. A mood without eyes of
   *  its own keeps them open. */
  readonly eyes: { readonly cover: PixelPetRows } & { readonly [M in PixelPetMood]?: PixelPetRows }
  /**
   * Each pose's layers. run: behind are the legs' stride (a flipbook), in front the tail, and
   * the body bobs with them. stand: resting between runs. sleep: lying down, sinking two rows
   * and breathing (also worn out, when the context is heavy). jump: mid-leap. roll: on its
   * back, the body turned over, rocking (front: paws and tail). stretch: the body leans down to
   * the front, eyes shut happily. groom: eyes shut, a paw licked. scratch: at the track's end,
   * reaching up the bar. eat: its reward, the head chomping (`food` is put in front). beckon:
   * a paw waving. A pose left out is drawn as stand.
   */
  readonly poses: { readonly run: PixelPetPoseArt; readonly stand: PixelPetPoseArt; readonly sleep: PixelPetPoseArt }
    & { readonly [P in 'jump' | 'roll' | 'stretch' | 'groom' | 'scratch' | 'eat' | 'beckon']?: PixelPetPoseArt }
  /** The reward, eaten in up to three bites over its time, then gone; in its own colors. */
  readonly food?: { readonly frames: readonly PixelPetRows[]; readonly colors: PixelPetPalette }
  /** What sticks out of the futon it sleeps under once the cache has gone cold, in L, swishing:
   *  drawn against the futon's left (the pet's back), its right edge there. Its rows are as wide
   *  as the piece (not the canvas): the longest sets where it starts. */
  readonly futonTail?: readonly PixelPetRows[]
  /** The figurine beside the bar that beckons to /compact or /clear, seen from the front, 16 x 12,
   *  in its own colors: a body and a paw's flipbook. Without one, the pet's own beckon pose. */
  readonly maneki?: { readonly body: PixelPetRows; readonly paw: readonly PixelPetRows[]; readonly colors: PixelPetPalette }
  /** The ultra coat (the last, the full herd's reward), fitted to the body: eye highlights, the
   *  nose, a dozen brighter dots and five pairs of twinkling ones. Without it, no ultra coat. */
  readonly ultra?: {
    readonly shine: readonly PixelPetCell[]
    readonly nose: PixelPetCell
    readonly speckle: readonly PixelPetCell[]
    readonly twinkles: readonly (readonly [PixelPetCell, PixelPetCell])[]
    readonly knob?: readonly PixelPetCell[]
  }
  /** What it would say, by mood: the sprite's alt text, and the terminal's line (one line each,
   *  up to 80 characters). */
  readonly lines: { readonly [M in PixelPetMood]: string }
  /** Text-only stand-in where the surface draws no SVG (the terminal), by mood. */
  readonly face: { readonly [M in PixelPetMood]: string }
}

/**
 * pixel-pet on `$`. A pet pack (a mod listing "pixel-pet" under `dependencies`) adds its pets by
 * hooking this call, adding its own to what the rest answer:
 *
 *   on('pixelPet.pets', async ($, e, next) => {
 *     const answer = await next(e)   // { value } (or { deny })
 *     return answer.deny !== undefined ? answer : { value: { ...answer.value, dog: DOG } }
 *   })
 *
 * `/pet <id>` then picks one. pixel-pet asks at the session's start, on /pet and once a minute
 * (never while drawing), so a pack that loads, reloads or goes away is seen within a minute.
 * Ids are unique: a pack's pet under a built-in id (cat) is left out, and of two packs using
 * one id, one wins.
 */
export type PixelPet = {
  /** Every pet there is, by id (letters, digits, `-`): the built-in cat and each pack's. */
  pets: () => Promise<{ readonly [id: string]: PixelPetSpec }>
}

declare module 'claude-code' {
  interface EngineInterface {
    pixelPet: PixelPet
  }
  interface PluginState {
    'pixel-pet': { mode: PixelPetMode; cost: number | null; ctx: number | null; rewardUntil: number; happyUntil: number; lastActive: number; turns: number; cacheTs: number | null; cacheMiss: number | null; turnCost: number | null; turnAt: number; metric: PixelPetMetric; efficiency: number | null; quota: number | null; menu: boolean; coatSeed: number | null; shownPet: { id: string; spec: PixelPetSpec } | null; shownHerd: number | null; poofFrom: number; poofAt: number; epoch: number }
  }
}
