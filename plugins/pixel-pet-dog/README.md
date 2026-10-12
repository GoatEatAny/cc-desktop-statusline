# pixel-pet-dog

A pet pack for [pixel-pet](../pixel-pet): a floppy-eared puppy in seven coats (tan, chocolate,
cream, white, gray, black and dalmatian). It wags its tail while it stands, gnaws a bone after
`/compact`, and its tail sticks out of the futon while it sleeps.

## Install

```bash
claude plugin install pixel-pet-dog@cc-desktop-statusline
```

This brings pixel-pet too, if it is not installed yet. Start a new session, then type
`/pet dog` to put the dog in the band (and `/pet cat` to go back).

## Use it as a template

This pack is also the example to copy when you make a pet of your own:

- [hooks/dog.ts](hooks/dog.ts) is the whole dog: its drawings, colors and words.
- [hooks/register.ts](hooks/register.ts) is the one hook that hands it to pixel-pet, under the
  id `dog`.

Copy the folder, rename the pack and the id, then redraw the art. The steps are in pixel-pet's
[Making your own pet](../pixel-pet/README.md#making-your-own-pet).
