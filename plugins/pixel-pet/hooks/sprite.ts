// What the band and every pet share: the moods and poses, the canvas, and how pixel art turns
// into SVG.

import type { PixelPetMood } from '../types'

export type Mood = PixelPetMood
// What a pet does: run between spots or leap a short way (jump), or at a spot stand, slump
// (when the context is heavy), eat (its reward after a /compact), roll onto its back, stretch, groom,
// or (at the track's right end) scratch the bar.
export type Pose = 'run' | 'jump' | 'stand' | 'roll' | 'stretch' | 'groom' | 'scratch' | 'slump' | 'eat' | 'beckon'

// After a /compact the herd gets its own reward, a fish each, for this long.
export const REWARD_MS = 10_000

// Sprite pixels are drawn at 1.5 CSS px (3 device px on a Retina screen, so edges stay crisp).
// The canvas is exactly the sprite's 12 rows, 18 px: the status band's row measured about
// 17.5 px, and a taller canvas made the pet view a couple of px taller than the stats view.
// With no spare row, a happy hop lifts the ear tips out of view for a moment.
export const VIEW_H = 12
export const SCALE = 1.5

// The futon a pet sleeps under once the cache has gone cold is this wide, centred on the pet
// (for the 16-wide cat, 3 px past it on each side); its left edge, from the pet's.
export const FUTON_W = 22
export function futonLeft(petWidth: number): number {
  return Math.floor((petWidth - FUTON_W) / 2)
}

// Pixel art: one string per row, top to bottom, one letter per pixel; "." (or a letter the
// palette does not name) is transparent, and a short or empty row is transparent past its end.
export type Rows = readonly string[]
// Letters to colors. A value starting with "." names a CSS class, for a color that changes with
// the theme.
export type Palette = { readonly [letter: string]: string }

// Each color becomes one path of its runs (M x y h n v1 h-n z per run), which keeps a herd of
// ten under the size the desktop accepts for an Svg (131072 characters; see SVG_LIMIT).
export function pixels(rows: Rows, dx: number, dy: number, palette: Palette): string {
  const runs = new Map<string, string>()
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      let end = x + 1
      while (end < row.length && row[end] === row[x]) end++
      const fill = palette[row[x]]
      if (fill !== undefined) runs.set(fill, `${runs.get(fill) ?? ''}M${x + dx} ${y + dy}h${end - x}v1h-${end - x}z`)
      x = end
    }
  })
  return [...runs].map(([fill, d]) => `<path ${fill.startsWith('.') ? `class="${fill.slice(1)}"` : `fill="${fill}"`} d="${d}"/>`).join('')
}

// `frames` drawings shown in turn, each for `each` seconds.
export function flipBook(frames: string[], each: number): string {
  const dur = each * frames.length
  return frames.map((f, i) => {
    const values = frames.map((_, j) => (j === i ? 1 : 0)).join(';')
    return `<g opacity="${i === 0 ? 1 : 0}">${f}<animate attributeName="opacity" values="${values}" calcMode="discrete" dur="${dur}s" repeatCount="indefinite"/></g>`
  }).join('')
}

// ---- Randomness that repeats ------------------------------------------------------------------
// The same seed gives the same walk, so a redraw continues each pet's walk where it was
// instead of starting a new one. (mulberry32)
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
