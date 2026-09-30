import * as THREE from 'three';

export interface AABB {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export const aabb = (min: THREE.Vector3, max: THREE.Vector3): AABB => ({ min, max });

const tmp = new THREE.Vector3();

/** Distance from point to box surface (0 if inside). */
export function distToBox(p: THREE.Vector3, b: AABB) {
  tmp.copy(p).clamp(b.min, b.max);
  return tmp.distanceTo(p);
}

/**
 * Resolves a sphere against a list of boxes. Mutates pos and vel.
 * Returns the largest impact speed (for bump feedback).
 */
export function collideSphere(pos: THREE.Vector3, vel: THREE.Vector3, r: number, boxes: AABB[], restitution = 0.25) {
  let impact = 0;
  for (let iter = 0; iter < 3; iter++) {
    let any = false;
    for (const b of boxes) {
      if (
        pos.x + r < b.min.x || pos.x - r > b.max.x ||
        pos.y + r < b.min.y || pos.y - r > b.max.y ||
        pos.z + r < b.min.z || pos.z - r > b.max.z
      ) continue;
      tmp.copy(pos).clamp(b.min, b.max);
      const d = tmp.distanceTo(pos);
      if (d >= r) continue;
      let n: THREE.Vector3;
      if (d > 1e-6) {
        n = pos.clone().sub(tmp).divideScalar(d);
      } else {
        // centre inside the box: push out along the shallowest axis
        const dx1 = pos.x - b.min.x, dx2 = b.max.x - pos.x;
        const dy1 = pos.y - b.min.y, dy2 = b.max.y - pos.y;
        const dz1 = pos.z - b.min.z, dz2 = b.max.z - pos.z;
        const m = Math.min(dx1, dx2, dy1, dy2, dz1, dz2);
        n = new THREE.Vector3(
          m === dx1 ? -1 : m === dx2 ? 1 : 0,
          m === dy1 ? -1 : m === dy2 ? 1 : 0,
          m === dz1 ? -1 : m === dz2 ? 1 : 0,
        ).normalize();
        pos.addScaledVector(n, m);
      }
      pos.addScaledVector(n, r - Math.max(d, 0));
      const vn = vel.dot(n);
      if (vn < 0) {
        impact = Math.max(impact, -vn);
        vel.addScaledVector(n, -(1 + restitution) * vn);
        // a little friction along the surface
        const tangential = vel.clone().addScaledVector(n, -vel.dot(n));
        vel.addScaledVector(tangential, -0.15);
      }
      any = true;
    }
    if (!any) break;
  }
  return impact;
}

export function nearestSurfaceDist(p: THREE.Vector3, boxes: AABB[]) {
  let best = Infinity;
  for (const b of boxes) best = Math.min(best, distToBox(p, b));
  return best;
}

/** Ray vs AABB, returns t or null. */
export function rayBox(o: THREE.Vector3, d: THREE.Vector3, b: AABB): number | null {
  let tmin = -Infinity, tmax = Infinity;
  for (const ax of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[ax]) < 1e-9) {
      if (o[ax] < b.min[ax] || o[ax] > b.max[ax]) return null;
    } else {
      let t1 = (b.min[ax] - o[ax]) / d[ax];
      let t2 = (b.max[ax] - o[ax]) / d[ax];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return Math.max(tmin, 0);
}
