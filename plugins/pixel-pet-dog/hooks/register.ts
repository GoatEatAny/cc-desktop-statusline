// pixel-pet-dog: a pet pack. It adds a dog to pixel-pet's pets; `/pet dog` puts it in the band.
// The dog itself is all in dog.ts, pixel art and words; pixel-pet moves it.

import type { Register } from 'claude-code'

import { DOG } from './dog.ts'

export const register: Register = on => {
  // pixel-pet asks for its pets whenever it draws; add the dog to what the others answer.
  // Hooks on a call see its answer wrapped, as `{ value }` (or `{ deny }`, passed on as it is).
  on('pixelPet.pets', async ($, e, next) => {
    const answer = await next(e)
    return answer.deny !== undefined ? answer : { value: { ...answer.value, dog: DOG } }
  })
}
