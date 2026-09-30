import type * as THREE from 'three';
import type { Station } from './station';
import type { Player } from './player';
import type { UI } from './ui';
import type { Input } from './input';
import type { World } from './world';
import type { Audio } from './audio';

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
  /** Seconds of game time elapsed. */
  time: number;
  day: number;
};
