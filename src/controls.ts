import * as THREE from 'three';
import { setInteract } from './interact';
import { labelMesh } from './textures';
import { G } from './game';

/** Small library of panel controls used on racks. All positions are in rack-local space (z out of the wall). */

const M = {
  metal: new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: 0.5, metalness: 0.6 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.6 }),
  white: new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 }),
};

export function text(parent: THREE.Object3D, str: string, x: number, y: number, w: number, h: number, fg = '#1a1a1a', bg?: string) {
  const l = labelMesh(str, w, h, { fg, bg });
  l.position.set(x, y, 0.052);
  l.userData.solid = false;
  parent.add(l);
  return l;
}

/** A flat panel face, returns the mesh. */
export function plate(parent: THREE.Object3D, x: number, y: number, w: number, h: number, color = 0xd4d6d8, depth = 0.05) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  m.position.set(x, y, depth / 2);
  parent.add(m);
  return m;
}

export function button(parent: THREE.Object3D, x: number, y: number, label: string, color: number, onPress: () => void, prompt?: () => string | null) {
  const g = new THREE.Group();
  g.position.set(x, y, 0.05);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 16), M.metal);
  base.rotation.x = Math.PI / 2;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 16), new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
  cap.rotation.x = Math.PI / 2;
  cap.position.z = 0.02;
  g.add(base, cap);
  if (label) text(g, label, 0, -0.1, 0.24, 0.05).position.z = 0;
  parent.add(g);
  setInteract(g, {
    label: prompt ?? (() => `Press ${label}`),
    use: () => {
      cap.position.z = 0.005;
      setTimeout(() => (cap.position.z = 0.02), 150);
      G.audio?.click();
      onPress();
    },
  });
  return g;
}

/** Two-position toggle switch. */
export function toggle(parent: THREE.Object3D, x: number, y: number, label: string, get: () => boolean, set: (v: boolean) => void) {
  const g = new THREE.Group();
  g.position.set(x, y, 0.05);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.02), M.metal);
  const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.09, 8), M.white);
  bat.position.z = 0.04;
  g.add(base, bat);
  if (label) text(g, label, 0, -0.12, 0.26, 0.05).position.z = 0;
  text(g, 'ON', 0, 0.09, 0.1, 0.04).position.z = 0;
  parent.add(g);
  const sync = () => {
    bat.rotation.x = get() ? -Math.PI / 2 + 0.5 : -Math.PI / 2 - 0.5;
  };
  sync();
  setInteract(g, {
    label: () => `Flip ${label} ${get() ? 'off' : 'on'}`,
    use: () => {
      set(!get());
      G.audio?.click();
      sync();
    },
  });
  return { sync };
}

/** Rotary dial with n positions labelled 1..n (or custom). Each click turns it one step, wrapping round. */
export function dial(parent: THREE.Object3D, x: number, y: number, label: string, n: number, get: () => number, set: (v: number) => void, names?: string[]) {
  const g = new THREE.Group();
  g.position.set(x, y, 0.05);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.04, 20), M.dark);
  knob.rotation.x = Math.PI / 2;
  knob.position.z = 0.02;
  const pointer = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.04, 0.01), M.white);
  pointer.position.set(0, 0.025, 0.045);
  const pivot = new THREE.Group();
  pivot.add(knob, pointer);
  g.add(pivot);
  const span = Math.PI * 1.4;
  for (let i = 0; i < n; i++) {
    const a = span / 2 - (i / Math.max(1, n - 1)) * span;
    const t = text(g, names?.[i] ?? String(i + 1), -Math.sin(a) * 0.1, Math.cos(a) * 0.1, 0.06, 0.035);
    t.position.z = 0;
  }
  if (label) text(g, label, 0, -0.13, 0.26, 0.05).position.z = 0;
  parent.add(g);
  const sync = () => {
    const a = span / 2 - (get() / Math.max(1, n - 1)) * span;
    pivot.rotation.z = a;
  };
  sync();
  const nm = (v: number) => names?.[v] ?? String(v + 1);
  setInteract(g, {
    // one click per step; past the last position it comes back round to the first
    label: () => `Turn ${label} (at ${nm(get())}) to ${nm((get() + 1) % n)}`,
    use: () => {
      set((get() + 1) % n);
      G.audio?.click();
      sync();
    },
  });
  return { sync };
}

export function lamp(parent: THREE.Object3D, x: number, y: number, color: number, label?: string) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: 0 });
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), mat);
  m.position.set(x, y, 0.055);
  parent.add(m);
  if (label) text(parent, label, x, y - 0.06, 0.22, 0.04);
  let on = false;
  return {
    set(v: boolean) {
      if (v === on) return;
      on = v;
      mat.emissiveIntensity = v ? 2.2 : 0;
      mat.color.setHex(v ? color : 0x222222);
    },
    get on() {
      return on;
    },
  };
}

/** Analogue gauge with a needle, value 0..1. */
export function gauge(parent: THREE.Object3D, x: number, y: number, label: string, ticks = 5) {
  const g = new THREE.Group();
  g.position.set(x, y, 0.05);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), M.white);
  face.position.z = 0.002;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.008, 6, 24), M.metal);
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.085, 0.004), new THREE.MeshBasicMaterial({ color: 0xcc2211 }));
  needle.geometry.translate(0, 0.04, 0);
  needle.position.z = 0.01;
  g.add(face, rim, needle);
  const span = Math.PI * 1.2;
  for (let i = 0; i <= ticks; i++) {
    const a = span / 2 - (i / ticks) * span;
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.018, 0.002), M.dark);
    t.position.set(-Math.sin(a) * 0.085, Math.cos(a) * 0.085, 0.004);
    t.rotation.z = a;
    g.add(t);
    const n = labelMesh(String(i), 0.03, 0.03, { fg: '#222' });
    n.position.set(-Math.sin(a) * 0.06, Math.cos(a) * 0.06, 0.004);
    g.add(n);
  }
  if (label) text(g, label, 0, -0.14, 0.26, 0.05).position.z = 0;
  parent.add(g);
  let cur = 0;
  let target = 0;
  return {
    set(v: number) {
      target = Math.max(0, Math.min(1, v));
    },
    update(dt: number) {
      cur += (target - cur) * Math.min(1, dt * 4);
      needle.rotation.z = span / 2 - cur * span;
    },
    get value() {
      return target;
    },
  };
}

/**
 * A slot that things are put into and taken out of. Both are right click, like picking up and letting go:
 * `accept` handles putting the held item in, `take` taking something out into empty hands.
 */
export function slot(parent: THREE.Object3D, x: number, y: number, w: number, h: number, label: string,
  accept: (item: import('./items').Item) => string | null, onAccept: (item: import('./items').Item) => void,
  take: { label: () => string | null; use: () => void } | null = null) {
  const g = new THREE.Group();
  g.position.set(x, y, 0.05);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), M.metal);
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, h * 0.5), new THREE.MeshBasicMaterial({ color: 0x050505 }));
  hole.position.z = 0.016;
  g.add(frame, hole);
  if (label) text(g, label, 0, -h / 2 - 0.04, Math.max(w, 0.3), 0.05).position.z = 0;
  parent.add(g);
  setInteract(g, {
    altLabel: take?.label,
    alt: take?.use,
    acceptLabel: accept,
    accept: onAccept,
  });
  return g;
}

// segments: a b c d e f g (top, top-right, bottom-right, bottom, bottom-left, top-left, middle)
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc',
  '8': 'abcdefg', '9': 'abcdfg', E: 'adefg', P: 'abefg', d: 'bcdeg', '-': 'g', ' ': '', r: 'eg', L: 'def', A: 'abcefg', F: 'aefg',
};

/** A red 7-segment LED display: the station's idea of a screen. */
export function sevenSeg(parent: THREE.Object3D, x: number, y: number, digits: number, height = 0.12) {
  const DW = 40, DH = 64, PAD = 8;
  const c = document.createElement('canvas');
  c.width = digits * DW + PAD * 2;
  c.height = DH + PAD * 2;
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const w = height * c.width / c.height;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, height), new THREE.MeshBasicMaterial({ map: tex }));
  m.position.set(x, y, 0.052);
  m.userData.solid = false;
  parent.add(m);
  const seg = (ox: number, s: string, on: boolean) => {
    g.fillStyle = on ? '#ff3a1a' : '#3a0d08';
    const t = 6, L = DW - 14, H = (DH - 6) / 2;
    const x0 = ox + 7, y0 = PAD + 3;
    const rects: Record<string, [number, number, number, number]> = {
      a: [x0, y0 - t / 2, L, t], g: [x0, y0 + H - t / 2, L, t], d: [x0, y0 + 2 * H - t / 2, L, t],
      f: [x0 - t, y0, t, H], b: [x0 + L, y0, t, H], e: [x0 - t, y0 + H, t, H], c: [x0 + L, y0 + H, t, H],
    };
    const [rx, ry, rw, rh] = rects[s];
    g.fillRect(rx + 1, ry + 1, rw - 2, rh - 2);
  };
  let shown = '';
  const api = {
    set(text: string) {
      text = text.padStart(digits, ' ').slice(-digits);
      if (text === shown) return;
      shown = text;
      g.fillStyle = '#120404';
      g.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < digits; i++) {
        const lit = SEGMENTS[text[i]] ?? '';
        for (const s of 'abcdefg') seg(PAD + i * DW, s, lit.includes(s));
      }
      tex.needsUpdate = true;
    },
  };
  api.set('');
  return api;
}
