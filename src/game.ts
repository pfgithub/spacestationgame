import type * as THREE from 'three';
import type { Station } from './station';
import type { Player } from './player';
import type { UI } from './ui';
import type { Input } from './input';
import type { World } from './world';
import type { Audio } from './audio';
import type { Items } from './items';
import type { Racks } from './racks';
import type { Days } from './days';
import type { Power } from './power';
import type { Science } from './science';
import type { Cargo } from './cargo';
import type { EVA } from './eva';
import type { LifeSupport } from './life';

/** Global game context, filled in by main.ts. */
export const G = {} as {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  station: Station;
  player: Player;
  ui: UI;
  input: Input;
  world: World;
  audio: Audio | undefined;
  items: Items;
  racks: Racks;
  days: Days;
  power: Power;
  science: Science;
  cargo: Cargo;
  eva: EVA;
  life: LifeSupport;
  /** Seconds of game time elapsed. */
  time: number;
  day: number;
  /** Set while starting over, so nothing gets saved on the way out. */
  resetting?: boolean;
};
