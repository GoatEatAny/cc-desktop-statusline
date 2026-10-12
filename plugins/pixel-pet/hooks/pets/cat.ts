// The cat: a round chibi, side view, facing right, 16 x 12 pixels. Big eyes with a highlight,
// pink cheeks and nose. Four leg frames make the gallop and the tail bobs with them; asleep it
// tucks its legs in and lies down. Each coat recolors the same sprite.
//
// The model for a new pet: copy this file, redraw the art, keep the shape. The canvas and the
// letters are explained in ../pet-kit.ts.

import type { PetArt, PetSpec } from '../pet-kit.ts'

// The tail, from the back: up (standing, most poses), down (the run's other frame), and wrapped
// low (asleep).
const TAIL_UP = [
  '', '',
  'L...............',
  'L...............',
  '.L..............',
]
const TAIL_DOWN = [
  '', '', '',
  'L...............',
  '.L..............',
]
const TAIL_ASLEEP = [
  '', '', '', '', '', '', '',
  'L...............',
  '.L..............',
]

// Legs below the body: leg (L), then paw (P). Stretched, gathering, gathered, pushing off.
const LEGS = [
  [
    '', '', '', '', '', '', '', '', '', '',
    '.L.L.......L.L..',
    '.P.P.......P.P..',
  ],
  [
    '', '', '', '', '', '', '', '', '', '',
    '...LL.....LL....',
    '...PP.....PP....',
  ],
  [
    '', '', '', '', '', '', '', '', '', '',
    '..L.L.....L.L...',
    '..P.P.....P.P...',
  ],
  [
    '', '', '', '', '', '', '', '', '', '',
    '...L.L...L.L....',
    '...P.P...P.P....',
  ],
]

// Sitting: hind legs together at the back, one front leg.
const SITTING = [
  '', '', '', '', '', '', '', '', '', '',
  '...LL.....L.....',
  '...PP.....P.....',
]

// A front paw raised and waved: up past the face, then curled down (beckoning, big enough to
// read as a wave); or up at the mouth, licked up and down (grooming).
const BECKON_PAW: PetArt = { each: 0.4, frames: [
  [
    '', '', '', '',
    '................P',
    '................L',
    '...............L',
    '..............L.',
    '.............L..',
    '............L...',
  ],
  [
    '', '', '', '', '', '', '',
    '..............LLP',
    '.............L..',
    '............L...',
  ],
] }
const GROOM_PAW: PetArt = { each: 0.35, frames: [
  [
    '', '', '', '', '', '', '',
    '.............P..',
    '.............L..',
    '............L...',
  ],
  [
    '', '', '', '', '', '', '', '',
    '.............P..',
    '............LL..',
  ],
] }

export const CAT: PetSpec = {
  name: '猫',
  width: 16,
  // k outline, o fur, w white, p pink, e eyes
  coats: [
    { k: '#3a2a22', o: '#f2a541', w: '#fff7ec', p: '#f48fb1', e: '#3a2a22' }, // orange
    { k: '#2f3337', o: '#9aa4ae', w: '#f4f6f8', p: '#f48fb1', e: '#2f3337' }, // gray
    { k: '#16161a', o: '#3b3b42', w: '#e8e8e8', p: '#f48fb1', e: '#f2d14b' }, // black, yellow eyes
    { k: '#6b5e52', o: '#f3ede2', w: '#ffffff', p: '#f7a8c4', e: '#4a6fa5' }, // white, blue eyes
    { k: '#3a2414', o: '#a0704a', w: '#f1e3d3', p: '#f48fb1', e: '#3a2414' }, // brown
    { k: '#4a3a2e', o: '#e9dcc6', w: '#fffaf2', p: '#f48fb1', e: '#4a6fa5' }, // cream, blue eyes
    { k: '#3d4248', o: '#c9d0d6', w: '#ffffff', p: '#f48fb1', e: '#4f9a6a' }, // silver, green eyes
    { k: '#2a3340', o: '#6f8299', w: '#eef2f6', p: '#f48fb1', e: '#e8a33d' }, // blue-gray, orange eyes
    { k: '#5a4a3e', o: '#f7f3ec', w: '#ffffff', p: '#f48fb1', e: '#3a2a22', a: '#f2a541', b: '#2b2b2f' }, // calico: white with orange (a) and black (b) patches
  ],
  // No outline along the underside: the legs grow straight out of the fur, with no dark row
  // between them that reads as a gap on a dark background.
  body: [
    '.......k.....k..',
    '......kpk...kpk.',
    '......kookkkook.',
    '.....koooooooook',
    '...kkkooweooweok',
    '..koooooeeooeeok',
    '.kooooopooopoopk',
    '.koooooooooooook',
    '.kowwwwwwoooook.',
    '..kooooooooook..',
  ],
  // The heavier the context, the rounder the cat: its belly sags toward the ground (hiding more
  // of its legs), its body widens, and at the fullest its back rounds too.
  fat: [
    [
      '.......k.....k..',
      '......kpk...kpk.',
      '......kookkkook.',
      '.....koooooooook',
      '...kkkooweooweok',
      '..koooooeeooeeok',
      '.kooooopooopoopk',
      '.koooooooooooook',
      '.kowwwwwwwoooook',
      '.kowwwwwwwooook.',
      '..kkwwwwwwwkk...',
    ],
    [
      '.......k.....k..',
      '......kpk...kpk.',
      '......kookkkook.',
      '.....koooooooook',
      '...kkkooweooweok',
      '..koooooeeooeeok',
      'koooooopooopoopk',
      'kooooooooooooook',
      'kowwwwwwwwoooook',
      'kowwwwwwwwooook.',
      '.kwwwwwwwwwwkk..',
      '..kkkkkkkkkk....',
    ],
    [
      '.......k.....k..',
      '......kpk...kpk.',
      '......kookkkook.',
      '.....koooooooook',
      '..kkooooweooweok',
      '.kooooooeeooeeok',
      'koooooopooopoopk',
      'kooooooooooooook',
      'kowwwwwwwwwooook',
      'kowwwwwwwwwoook.',
      'kowwwwwwwwwwkk..',
      '.kkkkkkkkkkkk...',
    ],
  ],
  patches: [
    '', '',
    '.......aa.......',
    '..........bbb...',
    '',
    '...aaa..........',
    '..aaa...........',
    '.........bbb....',
  ],
  eyes: {
    cover: [
      '', '', '', '',
      '........oo..oo..',
      '........oo..oo..',
    ],
    // ^ ^
    happy: [
      '', '', '', '',
      '.........e...e..',
      '........e.e.e.e.',
    ],
    // - -
    sleep: [
      '', '', '', '', '',
      '........ee..ee..',
    ],
    // ^ ^ while it eats its reward
    reward: [
      '', '', '', '',
      '.........e...e..',
      '........e.e.e.e.',
    ],
  },
  poses: {
    run: { behind: [{ each: 0.1, frames: LEGS }], front: [{ each: 0.2, frames: [TAIL_UP, TAIL_DOWN] }] },
    stand: { behind: [LEGS[1]], front: [TAIL_UP] },
    sleep: { front: [TAIL_ASLEEP] },
    // Legs stretched out fore and aft, tail up.
    jump: { front: [TAIL_UP, LEGS[0]] },
    // Paws bent in over the belly and kneading, the tail curled round toward the head.
    roll: {
      front: [
        { each: 0.3, frames: [
          [
            '......P..P......',
            '....P.L..L.P....',
            '....L......L....',
          ],
          [
            '',
            '.....PP..PP.....',
            '.....LL..LL.....',
          ],
        ] },
        [
          '',
          '..............LL',
          '.............L..',
        ],
      ],
    },
    // Rear up, front paws pushed out ahead.
    stretch: { front: [TAIL_UP, [
      '', '', '', '', '', '', '', '', '', '',
      '...LL...........',
      '...PP.........LLP',
    ]] },
    groom: { front: [TAIL_UP, SITTING, GROOM_PAW] },
    // Hind legs planted, short front legs reaching up the bar just ahead of the face, in turn.
    scratch: {
      front: [
        TAIL_UP,
        [
          '', '', '', '', '', '', '', '', '', '',
          '...LL...........',
          '...PP...........',
        ],
        { each: 0.25, frames: [
          [
            '', '', '', '', '', '',
            '................P',
            '...............L',
            '..............L.',
            '..............LLP',
          ],
          [
            '', '', '', '', '', '', '',
            '................P',
            '..............LLP',
            '..............L.',
          ],
        ] },
      ],
    },
    eat: { behind: [LEGS[1]], front: [TAIL_UP] },
    beckon: { front: [TAIL_UP, SITTING, BECKON_PAW] },
  },
  // A fish, eaten bite by bite in front of the mouth: whole, half, bones, then gone.
  food: {
    colors: { f: '#8ec5e8', e: '#1c1926', b: '#d8d4cc' },
    frames: [
      [
        '', '', '', '', '', '', '',
        '...............fff.f',
        '..............efffff',
        '...............fff.f',
      ],
      [
        '', '', '', '', '', '', '',
        '.................f.f',
        '................ffff',
        '.................f.f',
      ],
      [
        '', '', '', '', '', '', '',
        '...............b.b.b',
        '..............bbbbbb',
        '...............b.b.b',
      ],
    ],
  },
  // Only the tail sticks out of the futon, swishing slowly: curled up, then laid along the ground.
  // 4 wide: its rows are as wide as the piece itself.
  futonTail: [
    [
      '', '', '', '', '', '', '', '',
      '..L.',
      '.L..',
      '.L..',
      '..LL',
    ],
    [
      '', '', '', '', '', '', '', '', '',
      'L...',
      'L...',
      '.LLL',
    ],
  ],
  // The beckoning cat (maneki-neko): seen from the front, white, calico ears with red insides,
  // happy closed eyes, a red collar with a gold bell, one front paw raised and beckoning down
  // and up. k outline, w white, a orange, b black, r red, g gold, y the bell's shine, e eyes,
  // p pink.
  maneki: {
    colors: { k: '#4a3a2e', w: '#ffffff', a: '#f2a541', b: '#2b2b2f', r: '#e03131', g: '#f5c518', y: '#fff3b0', e: '#3a2a22', p: '#f48fb1' },
    body: [
      '.kk......kk.....',
      'kark....krbk....',
      'kaarkkkkrbbk....',
      'kaawwwwwwbbk....',
      'kwwewwwwewwk....',
      'kwewewwewewk....',
      'kpwwwppwwwpk....',
      '.kwwwwwwwwk.....',
      '.krrrrrrrrk.....',
      'kwwwwgywwwwk....',
      'kwkwwggwwkwk....',
      '.kkkkkkkkkk.....',
    ],
    paw: [
      [
        '', '',
        '............kkk.',
        '...........kwwwk',
        '...........kwpwk',
        '...........kwwwk',
        '...........kwwk.',
        '..........kwwk..',
        '..........wwk...',
      ],
      [
        '', '', '', '',
        '............kkk.',
        '...........kwwwk',
        '...........kkkwk',
        '..........kwwk..',
        '..........wwk...',
      ],
    ],
  },
  ultra: {
    shine: [[8, 4], [12, 4]], // eye highlights
    nose: [14, 6],
    speckle: [[2, 7], [5, 5], [9, 3], [13, 3], [7, 4], [10, 5], [12, 6], [4, 9], [13, 6], [10, 8], [7, 7], [9, 9]],
    twinkles: [[[10, 3], [12, 8]], [[7, 2], [13, 7]], [[12, 2], [9, 7]], [[6, 4], [11, 9]], [[10, 6], [6, 7]]],
  },
  lines: { reward: 'もぐもぐ（ごほうびのお魚）', happy: 'にゃーん！おつかれさま', working: 'じーっ…（見守り中）', sleep: 'すやすや', idle: 'ごろごろ' },
  face: { reward: '=^ω^= ><>', happy: '=^▽^=', working: '=^.^= …', sleep: '=-.-= zz', idle: '=^.^=' },
}
