# pixel-pet

A herd of pixel-art pets in the band above the prompt. They cheer when a turn ends, nap when
left alone, grow rounder as the context fills, sleep under a futon once the prompt cache has
gone cold, and a beckoning figurine beside the bar offers `/compact` (or `/clear`). The cat
comes built in; other pets come from **pet packs**, small mods of their own.

- `/pet` lists the pets there are; `/pet <id>` puts one in the band (kept for later sessions).
- The ◒ / ◓ switch at the band's right end swaps between the status band (shown first) and the
  pets; the choice is kept for later sessions.

## Making a pet pack

A pet is data, not code: pixel art and a few words. pixel-pet moves every pet the same way
(runs, leaps, rolls, sleeps, eats its reward), so a new animal is one file of drawings.
[pixel-pet-dog](../pixel-pet-dog) is a complete pack to copy.

**1. The manifest** (`.claude-plugin/plugin.json`). List pixel-pet as a dependency:

```json
{ "name": "pixel-pet-dog", "version": "0.1.0", "description": "A dog for pixel-pet", "dependencies": ["pixel-pet"] }
```

A pack does not load without pixel-pet installed: its hook has nothing to add to.

**2. The hook** (`hooks/register.ts`, named in `hooks/hooks.json`). pixel-pet asks for its pets
at the session's start, on `/pet` and once a minute; add yours to what the others answer:

```ts
import type { Register } from 'claude-code'
import { DOG } from './dog.ts'

export const register: Register = on => {
  on('pixelPet.pets', async ($, e, next) => {
    const answer = await next(e)
    return answer.deny !== undefined ? answer : { value: { ...answer.value, dog: DOG } }
  })
}
```

A hook sees the call's answer wrapped, `{ value }` (or `{ deny }`): add to `value`, not beside
it, or pixel-pet never sees your pet. The id (`dog`) is what `/pet` takes: lowercase letters,
digits and `-`, unique (a pack's pet under a built-in id such as `cat` is left out; of two packs
using one id, one wins). Because pixel-pet asks rather than being told, a pack that loads,
reloads or is removed shows up (or goes) within a minute.

**3. The pet** (`hooks/dog.ts`): a `PixelPetSpec`, typed by pixel-pet's contract
([types/index.d.ts](types/index.d.ts), laid into your mod's `.claude-plugin/types/pixel-pet/`
when it loads, so `import type { PixelPetSpec } from 'pixel-pet'` works).

### Drawing

Everything is drawn on one canvas: `width` (10 to 16, usually 16) by 12 sprite pixels, facing right,
feet on the bottom row (rows 10–11 are the legs). Each piece is a list of row strings, one
letter per pixel, `.` for nothing; leave rows above a piece empty (`''`) so it sits where it
belongs. Pieces line up by where they are drawn, so a paw can reach a pixel or two past the
right edge.

| Letter | Means | Colored by |
|---|---|---|
| `k` | outline | the coat |
| `o` | fur | the coat |
| `w` | light fur (belly, muzzle) | the coat |
| `p` | pink (ears, nose, tongue) | the coat |
| `e` | eyes | the coat |
| `a`, `b` | patches, ears in another shade | coats that name them (others leave them out) |
| `L`, `P` | leg or tail, paw | the coat, by the theme (fur on dark, outline on light) |

Colors are `#hex` (`#rgb`, `#rrggbb`, or with alpha). Every coat names `k o w p e`; no palette
may name `L`, `P` or `u` (`u` marks the ultra coat).

| Field | Required | What to draw |
|---|---|---|
| `name`, `width`, `coats` | yes | up to 10 coats (9 with `ultra`); the herd deals them out |
| `body` | yes | body and face, no legs or tail, eyes open |
| `eyes` | yes | `cover` paints the open eyes out; then eyes per mood (`happy`, `sleep`, `reward`…) |
| `poses.run`, `.stand`, `.sleep` | yes | the layers around the body: `behind` (legs), `front` (tail, paws) |
| `poses.jump`, `.roll`, `.stretch`, `.groom`, `.scratch`, `.eat`, `.beckon` | no | left out, the pet stands instead (the dog has no `groom`); a missing `jump` runs, a missing `eat` eats standing |
| `fat` | no | three rounder bodies for 40%, 60%, 80% of the context |
| `patches` | no | `a`/`b` marks over the body |
| `food` | no | the reward after `/compact`, up to three bites, in its own colors |
| `futonTail` | no | what sticks out of the futon; rows as wide as the piece itself (up to 8) |
| `maneki` | no | the beckoning figurine, 16 × 12, own colors; without it, the pet's `beckon` pose, turned to face the bubble |
| `ultra` | no | where the Ultracode coat's dots sparkle; without it, no ultra coat |
| `lines`, `face` | yes | words per mood (alt text), and a kaomoji for the terminal: one line each, up to 80 characters (`name` up to 20) |

A layer is a list of rows, or a flipbook `{ frames: [rows, rows, …], each: seconds }`
(`each` from 0.05 to 5; the
dog's standing tail wags this way). The body bobs, sinks, rocks and chomps on its own; those
moves are pixel-pet's.

### Checks

Before drawing a pack's pet, pixel-pet checks it: every value of its kind (colors as `#hex`,
the width a whole number from 10 to 16, flipbook times and ultra cells numbers on the canvas,
words one short line), at most 12 rows per piece (each up to `width` + 4 wide) and 8 frames
per flipbook, and each pose about as small as the cat's, so a herd of ten fits in the band's
picture. A pet that fails, or that throws, is left out and the band keeps its pet; `/pet`
lists it with ✕ and the reason. A pack that never answers holds up only that asking, never
the band.

To see your pet before loading it, build it with `buildPet` from pixel-pet's
`hooks/pet-kit.ts` and put it on a page: `trunk(mood, coat, fat)` inside
`<defs><g id="t0">…</g></defs>`, then `body(mood, coat, pose, '<use href="#t0"/>', fat)`,
with `css(coat, 0)` in a `<style>`, in an `<svg>` 12 tall and `width` wide (a little more
for reaching paws). `inspectPet(spec)` says what the check above would say.
