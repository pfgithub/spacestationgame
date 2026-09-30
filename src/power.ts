import * as THREE from 'three';
import { G } from './game';
import { boxMesh } from './station';
import { aabb } from './physics';
import { solarTexture } from './textures';
import { setInteract } from './interact';
import type { Module } from './station';

export const CIRCUITS = ['NODE', 'LAB', 'HAB', 'AIRLOCK', 'DOCK', 'AUX'] as const;
export type Circuit = (typeof CIRCUITS)[number];

export function circuitOf(m: Module): Circuit | null {
  switch (m.type) {
    case 'node': return 'NODE';
    case 'lab': return 'LAB';
    case 'hab': return 'HAB';
    case 'airlock': return 'AIRLOCK';
    case 'dock': return 'DOCK';
    case 'ship': return null; // the cargo vehicle has its own batteries
    default: return 'AUX';
  }
}

function grimeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = Math.random() * 10 + 2;
    g.fillStyle = `rgba(${120 + Math.random() * 40},${100 + Math.random() * 30},${70 + Math.random() * 20},${Math.random() * 0.5 + 0.3})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  return t;
}

/**
 * Electrical power. The solar arrays feed a main bus; racks that need power only work while the bus is healthy.
 * Malfunctions (dirty arrays, tripped breakers) are layered on top of this.
 */
export class Power {
  /** 0..1 cleanliness of each solar wing. */
  wings = [1, 1];
  /** Bus voltage in volts, nominal 28. Batteries smooth over orbital night. */
  voltage = 28;
  grime: THREE.Mesh[] = [];
  /** Fuse state per circuit: 'ok', 'blown' or 'empty'. */
  fuses: Record<Circuit, 'ok' | 'blown' | 'empty'> = { NODE: 'ok', LAB: 'ok', HAB: 'ok', AIRLOCK: 'ok', DOCK: 'ok', AUX: 'ok' };
  wingMeshes: THREE.Mesh[] = [];

  /** Builds the two solar wings on the mast above NODE 1. */
  buildArrays() {
    const st = G.station;
    const mat = new THREE.MeshStandardMaterial({ map: solarTexture(), roughness: 0.25, metalness: 0.5 });
    const grimeTex = grimeTexture();
    for (const [i, s] of [[0, 1], [1, -1]] as const) {
      const x0 = s * 1.2, x1 = s * 11;
      const min = new THREE.Vector3(Math.min(x0, x1), 10.2, -1.8);
      const max = new THREE.Vector3(Math.max(x0, x1), 10.26, 1.8);
      const wing = boxMesh(min, max, mat, 3.6);
      st.exterior.add(wing);
      st.extraBoxes.push(aabb(min, max));
      this.wingMeshes[i] = wing;
      setInteract(wing, {
        label: () => {
          if (G.items.held?.kind !== 'brush') return null;
          return this.wings[i] >= 0.999 ? 'The panel is clean' : 'Brush the panel clean';
        },
        use: () => {
          if (G.items.held?.kind !== 'brush') return;
          this.wings[i] = Math.min(1, this.wings[i] + 0.125);
          G.audio?.paper();
          if (this.wings[i] >= 1) G.ui.toast('That wing looks clean now');
        },
        range: 3,
      });
      const grime = new THREE.Mesh(
        new THREE.PlaneGeometry(9.8, 3.6),
        new THREE.MeshStandardMaterial({ map: grimeTex, transparent: true, opacity: 0, depthWrite: false, roughness: 1 }),
      );
      grime.rotation.x = -Math.PI / 2;
      grime.position.set((x0 + x1) / 2, 10.265, 0);
      grime.userData.solid = false;
      st.exterior.add(grime);
      this.grime[i] = grime;
    }
    st.rebuild();
  }

  /** Solar output as a fraction of nominal (averaged over the orbit: batteries cover the night). */
  output() {
    return (this.wings[0] + this.wings[1]) / 2;
  }

  /** What an ammeter on wing i reads right now, 0..1 (nothing during orbital night). */
  wingCurrent(i: number) {
    return G.world.sunlit ? this.wings[i] : 0;
  }

  circuitOk(m: Module) {
    const c = circuitOf(m);
    return !c || this.fuses[c] === 'ok';
  }

  available() {
    return this.voltage >= 24;
  }

  update(dt: number) {
    this.grime.forEach((g, i) => ((g.material as THREE.MeshStandardMaterial).opacity = (1 - this.wings[i]) * 0.95));
    const target = 16 + 12 * this.output();
    this.voltage += (target - this.voltage) * Math.min(1, dt * 0.5);
    for (const m of G.station.modules.values()) {
      m.powered = this.circuitOk(m);
      const lit = m.powered && this.voltage > 12;
      m.light.intensity = lit ? 2.2 * Math.min(1, (this.voltage - 10) / 16) : 0;
    }
  }
}
