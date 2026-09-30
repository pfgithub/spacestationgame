import * as THREE from 'three';
import { G } from './game';
import { boxMesh } from './station';
import { aabb } from './physics';
import { solarTexture } from './textures';

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

  /** Solar output as a fraction of nominal. */
  output() {
    return (this.wings[0] + this.wings[1]) / 2;
  }

  available() {
    return this.voltage >= 24;
  }

  update(dt: number) {
    this.grime.forEach((g, i) => ((g.material as THREE.MeshStandardMaterial).opacity = (1 - this.wings[i]) * 0.95));
    const target = 16 + 12 * this.output();
    this.voltage += (target - this.voltage) * Math.min(1, dt * 0.5);
    for (const m of G.station.modules.values()) {
      const lit = m.powered && this.voltage > 12;
      m.light.intensity = lit ? 2.2 * Math.min(1, (this.voltage - 10) / 16) : 0;
    }
  }
}
