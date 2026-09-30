# Orbital

A quiet first-person zero-gravity space station game. Built with Three.js + Vite + TypeScript.

```
npm install
npm run dev      # play at http://localhost:5173
npm run build    # static build into dist/
```

## Controls

| Key | Action |
| --- | --- |
| Mouse | look |
| W | push off: every push adds one unit of speed, no limit. Holding pushes steadily; tapping pushes again sooner |
| S | grab: each cycle takes off one unit of speed; once stopped, keep holding to push backwards |
| A / D | push off left / right |
| Space / Shift | push off up / down (relative to your view) |
| Q / E | roll |
| Left click | use |
| Right click | grab / place / let go |
| R | read the paper you are holding |
| T or left click | clip tether to the yellow ring you are looking at (spacewalk) |
| F (hold) | reel in tether |

## How it plays

You live alone on a small station orbiting the Earth. There are no computers and no radio: everything
travels on paper.

- **Science.** The LAB has three experiment racks (crystal furnace, plant habitat, fluid physics). They don't explain
  themselves; each has a written procedure stuck to the lab walls. Advancing an experiment prints a result slip
  (or ejects a film canister) worth science points.
- **Mail.** A cargo vehicle is docked when you arrive. Anything you leave inside it goes to the ground when it
  leaves during the night: slips and film are credited as points, and the order form is filled against your
  balance. The next morning a new vehicle waits 35 m out with a statement, a fresh order form and whatever you
  ordered, until you fly it in from the DOCKING CONTROL periscope.
- **Things to buy.** Corridor and cupola modules, two further experiments (radiation dosimetry and Earth
  photography), spare parts, and decorations.
- **Building.** Every rack can be unbolted into a crate and installed on any free wall. Module kits are installed
  from outside: suit up, cycle the airlock, and deploy the kit against a bare hull wall. Empty, closed-off modules
  can be packed back up.
- **Spacewalks.** The airlock won't pump down with the inner hatch open or with an unsuited occupant. Outside, your
  tether allows 10 m from whichever yellow ring it is clipped to.
- **Faults.** From day 3 things go wrong: a hull leak, a contaminated solar wing, a blown fuse, a spent CO₂
  cartridge. None is dangerous, but each stops something (science, a module, or sleep). The gauges and the Station
  Operations Manual are all you have to work out what is wrong.

The game saves every morning and whenever you leave the page. "Start over" on the pause screen begins again.

## Code map

| File | What |
| --- | --- |
| `src/main.ts` | setup, new-game layout, interaction, main loop |
| `src/player.ts` | zero-g push-off movement |
| `src/station.ts` | module grid, hatches, collision boxes |
| `src/racks.ts`, `src/controls.ts` | movable wall racks and their buttons, dials, gauges |
| `src/experiments.ts`, `src/experiments2.ts` | the five experiments and their procedures |
| `src/items.ts`, `src/docs.ts` | loose items, papers and stock documents |
| `src/cargo.ts`, `src/catalog.ts` | cargo vehicles, docking, mail, the order form |
| `src/eva.ts`, `src/construction.ts` | airlock, suit, tether; deploying and packing modules |
| `src/power.ts`, `src/life.ts` | solar arrays, fuses, air, faults, the operations manual |
| `src/world.ts` | Earth, sun and orbit |
| `src/save.ts` | save/restore |

Append `?test` to the URL to drive the game from the console without pointer lock (`sim(frames, heldKeys, pressedKeys)`).
