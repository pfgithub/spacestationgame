import * as THREE from 'three';

/** Size of one station grid cell (metres). */
export const CELL = 4;
/** Half extent of a module's pressurised interior. */
export const HALF_IN = 1.6;
/** Half extent of a module's outer hull. */
export const HALF_OUT = 2.0;
/** Half size of the square doorway between modules. */
export const HOLE = 0.7;

/** Face directions: 0:+x 1:-x 2:+y 3:-y 4:+z 5:-z */
export type Dir = 0 | 1 | 2 | 3 | 4 | 5;
export const ALL_DIRS: Dir[] = [0, 1, 2, 3, 4, 5];
export const DIR_VECS: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
export const DIR_NAMES = ['starboard', 'port', 'zenith', 'nadir', 'aft', 'forward'];

export const opposite = (d: Dir): Dir => (d ^ 1) as Dir;
export const axisOf = (d: Dir) => d >> 1;
export const signOf = (d: Dir) => (d & 1 ? -1 : 1);
export const dirVec = (d: Dir) => new THREE.Vector3(...DIR_VECS[d]);

export type Cell = [number, number, number];
export const cellKey = (c: Cell) => `${c[0]},${c[1]},${c[2]}`;
export const cellAdd = (c: Cell, d: Dir): Cell => [c[0] + DIR_VECS[d][0], c[1] + DIR_VECS[d][1], c[2] + DIR_VECS[d][2]];
export const cellCenter = (c: Cell) => new THREE.Vector3(c[0] * CELL, c[1] * CELL, c[2] * CELL);
export const worldToCell = (p: THREE.Vector3): Cell => [
  Math.round(p.x / CELL),
  Math.round(p.y / CELL),
  Math.round(p.z / CELL),
];

/** Returns a vector with component `axis` set to a, and the two tangent axes set to u, v. */
export function faceVec(d: Dir, a: number, u: number, v: number) {
  const out = [0, 0, 0];
  const ax = axisOf(d);
  out[ax] = a * signOf(d);
  out[(ax + 1) % 3] = u;
  out[(ax + 2) % 3] = v;
  return new THREE.Vector3(out[0], out[1], out[2]);
}

/** Orientation that maps local +z to point inwards from face d, and local +y to a sensible "up". */
export function faceQuat(d: Dir) {
  const inward = dirVec(d).negate();
  const up = axisOf(d) === 1 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4();
  const x = new THREE.Vector3().crossVectors(up, inward).normalize();
  const y = new THREE.Vector3().crossVectors(inward, x).normalize();
  m.makeBasis(x, y, inward);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

export const SPEED_UNIT = 1.3;
