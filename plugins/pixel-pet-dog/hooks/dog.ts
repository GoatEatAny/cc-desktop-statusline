// The dog: a floppy-eared puppy, side view, facing right, 16 x 12 pixels, drawn the way
// pixel-pet's cat is (see pixel-pet's README for the canvas and the letters). Its ears are
// patches of their own shade (a), so every coat names one; it has no grooming pose (it stands
// instead), no figurine of its own (its beckon pose stands in) and no ultra coat.

import type { PixelPetArt, PixelPetSpec } from 'pixel-pet'

// n empty rows: art below the top of the canvas starts after them.
const above = (n: number): string[] => Array(n).fill('')

const TAIL_UP = [...above(3), '.L..............', 'L...............', 'L...............', '.L..............']
const TAIL_UP2 = [...above(3), 'L...............', 'L...............', '.L..............', '.L..............']
const TAIL_DOWN = [...above(6), 'LL..............', 'L...............']
const TAIL_ASLEEP = [...above(8), 'L...............', '.L..............']
// Standing, the tail wags: a flipbook of two drawings.
const WAG: PixelPetArt = { each: 0.15, frames: [TAIL_UP, TAIL_UP2] }

// Legs below the body: leg (L), then paw (P). Stretched, gathering, gathered, pushing off.
const LEGS = [
  [...above(10), '.L.L.......L.L..', '.P.P.......P.P..'],
  [...above(10), '...LL.....LL....', '...PP.....PP....'],
  [...above(10), '..L.L.....L.L...', '..P.P.....P.P...'],
  [...above(10), '...L.L...L.L....', '...P.P...P.P....'],
]
// Sitting: hind legs together at the back, one front leg.
const SITTING = [...above(10), '...LL.....L.....', '...PP.....P.....']

export const DOG: PixelPetSpec = {
  name: '犬',
  width: 16,
  // tan, chocolate, cream, white, gray, black, dalmatian (spots in b)
  coats: [
    { k: '#3a2414', o: '#d9873f', w: '#fff4e6', p: '#f2788f', e: '#2a1a10', a: '#8a4a22' },
    { k: '#2a1a12', o: '#7b4a2e', w: '#e9d3bf', p: '#f2788f', e: '#1a0f0a', a: '#4e2c1a' },
    { k: '#5a4632', o: '#f0d29a', w: '#fff8ea', p: '#f2788f', e: '#3a2a1a', a: '#c9954f' },
    { k: '#6b5e52', o: '#f6f3ee', w: '#ffffff', p: '#f7a8c4', e: '#2b2b2f', a: '#e0d7ca' },
    { k: '#2f3337', o: '#9aa4ae', w: '#eef1f4', p: '#f2788f', e: '#1f2226', a: '#5f6872' },
    { k: '#121214', o: '#3b3b42', w: '#d9d4cc', p: '#f2788f', e: '#8a5a2b', a: '#26262b' },
    { k: '#2b2b2f', o: '#f7f5f0', w: '#ffffff', p: '#f48fb1', e: '#1c1c1c', a: '#2b2b2f', b: '#2b2b2f' },
  ],
  body: [
    '................',
    '......kkkkkkkk..',
    '....kkkoooooookk',
    '...kaakoooooooka',
    '...kaakoeoooeoka',
    '...kaakoeoooeoka',
    '..kkaakowwkwwoka',
    '.kooookkowpwokk.',
    '.kowwwwwkkkkkk..',
    '..kooooooooook..',
  ],
  fat: [
    [
      '................',
      '......kkkkkkkk..',
      '....kkkoooooookk',
      '...kaakoooooooka',
      '...kaakoeoooeoka',
      '...kaakoeoooeoka',
      '..kkaakowwkwwoka',
      '.kooookkowpwokk.',
      '.kowwwwwwkkkkk..',
      '.kowwwwwwwooook.',
      '..kkwwwwwwwkk...',
    ],
    [
      '................',
      '......kkkkkkkk..',
      '....kkkoooooookk',
      '...kaakoooooooka',
      '...kaakoeoooeoka',
      '..kkaakoeoooeoka',
      'kookaakowwkwwoka',
      'koooookkowpwokk.',
      'kowwwwwwwwkkkk..',
      'kowwwwwwwwwoook.',
      'kowwwwwwwwwwkk..',
      '.kkkkkkkkkkkk...',
    ],
  ],
  // Spots, for the coat that colors b (the dalmatian).
  patches: ['', '', '', '', '', '', '', '...b............', '................', '.....b...b......'],
  eyes: {
    cover: [...above(4), '........o...o...', '........o...o...'],
    happy: [...above(4), '........e...e...', '.......e.e.e.e..'],
    sleep: [...above(5), '.......eee.eee..'],
    reward: [...above(4), '........e...e...', '.......e.e.e.e..'],
  },
  poses: {
    run: { behind: [{ each: 0.1, frames: LEGS }], front: [{ each: 0.2, frames: [TAIL_UP, TAIL_DOWN] }] },
    stand: { behind: [LEGS[1]], front: [WAG] },
    sleep: { front: [TAIL_ASLEEP] },
    jump: { front: [TAIL_UP, LEGS[0]] },
    roll: {
      front: [
        { each: 0.3, frames: [
          ['...P..P..P..P...', '...L..L..L..L...', '................'],
          ['................', '....P.P..P.P....', '....L.L..L.L....'],
        ] },
        [...above(1), '.............LL.', '............L...'],
      ],
    },
    stretch: { front: [WAG, [...above(10), '...LL...........', '...PP.........LLP']] },
    scratch: {
      front: [
        WAG,
        [...above(10), '...LL...........', '...PP...........'],
        { each: 0.25, frames: [
          [...above(6), '................P', '...............L', '..............L', '..............LLP'],
          [...above(7), '................P', '..............LLP', '..............L'],
        ] },
      ],
    },
    eat: { behind: [LEGS[1]], front: [WAG] },
    beckon: {
      front: [
        WAG,
        SITTING,
        { each: 0.4, frames: [
          [...above(4), '................P', '................L', '...............L', '..............L', '.............L'],
          [...above(7), '................P', '..............LL', '.............L'],
        ] },
      ],
    },
  },
  // A bone on the ground before the nose: whole, gnawed, a stub, then gone.
  food: {
    colors: { f: '#f1e6cc', s: '#c8b48a' },
    frames: [
      [...above(7), '.............ff..ff', '..............ffff.', '.............ss..ss'],
      [...above(7), '................ff', '..............fff.', '................ss'],
      [...above(8), '................ff', '................ss'],
    ],
  },
  // The tail sticking out of the futon, wagging slowly even in its sleep.
  futonTail: [
    [...above(8), '.L..', 'L...', 'L...', '.LLL'],
    [...above(9), 'L...', 'L...', '.LLL'],
  ],
  lines: { reward: 'はぐはぐ（ごほうびの骨）', happy: 'ワン！おつかれさま', working: 'じっ…（見守り中）', sleep: 'くーくー', idle: 'しっぽふりふり' },
  face: { reward: 'U^ェ^U 骨', happy: 'U^ω^U', working: 'U・ェ・U …', sleep: 'U-ェ-U zz', idle: 'U・ェ・U' },
}
