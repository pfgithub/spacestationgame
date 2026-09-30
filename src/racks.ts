import * as THREE from 'three';
import { Cell, Dir, HALF_IN, axisOf, cellCenter, cellKey, dirVec, faceQuat, faceVec } from './constants';
import { G } from './game';
import { Interactable, setInteract } from './interact';
import { Item, defineItem, simpleBox } from './items';
import { AABB, aabb } from './physics';
import { labelMesh } from './textures';
import { text, plate } from './controls';
import type { Module } from './station';

export const RACK_W = 2.2;
export const RACK_H = 2.2;

export abstract class Rack {
  abstract readonly type: string;
  abstract readonly title: string;
  /** Colour of the rack backing plate and crate. */
  color = 0xd4d6d8;
  movable = true;
  needsPower = false;
  group = new THREE.Group();
  mount: { cell: Cell; dir: Dir } | null = null;
  private built = false;

  /** Populate this.group with meshes/controls (rack-local: x right, y up, z out of the wall). */
  abstract build(): void;
  update(_dt: number) {}
  /** Called once each night. */
  onSleep() {}
  serialize(): Record<string, any> {
    return {};
  }
  deserialize(_d: Record<string, any>) {}

  get module(): Module | undefined {
    return this.mount ? G.station.get(this.mount.cell) : undefined;
  }

  get powered() {
    if (!this.needsPower) return true;
    const m = this.module;
    return !!m && m.powered && G.power.available();
  }

  ensureBuilt() {
    if (this.built) return;
    this.built = true;
    const backing = plate(this.group, 0, 0, RACK_W, RACK_H, this.color, 0.03);
    backing.position.z = 0.015;
    setInteract(backing, this.baseInteract());
    text(this.group, this.title, 0, RACK_H / 2 - 0.12, 1.4, 0.13, '#1b1b1b');
    this.build();
  }

  baseInteract(): Interactable {
    return {
      altLabel: () => (this.movable && !G.items.held ? `Unmount ${this.title} rack` : null),
      alt: () => G.racks.unmount(this),
    };
  }
}

type RackFactory = () => Rack;
export const RACK_TYPES = new Map<string, RackFactory>();
export function registerRack(type: string, f: RackFactory) {
  RACK_TYPES.set(type, f);
}

const slotKey = (cell: Cell, d: Dir) => `${cellKey(cell)}#${d}`;

export class Racks {
  list: Rack[] = [];
  bySlot = new Map<string, Rack>();
  boxes: AABB[] = [];

  constructor() {
    G.station.boxProviders.push(() => this.boxes);
    G.station.wallInteract = (m, d) => this.wallInteract(m, d);
  }

  at(cell: Cell, d: Dir) {
    return this.bySlot.get(slotKey(cell, d));
  }

  create(type: string) {
    const f = RACK_TYPES.get(type);
    if (!f) throw new Error(`unknown rack ${type}`);
    return f();
  }

  mountRack(rack: Rack, cell: Cell, d: Dir) {
    rack.ensureBuilt();
    rack.mount = { cell, dir: d };
    this.bySlot.set(slotKey(cell, d), rack);
    if (!this.list.includes(rack)) this.list.push(rack);
    rack.group.position.copy(cellCenter(cell)).add(dirVec(d).multiplyScalar(HALF_IN));
    rack.group.quaternion.copy(faceQuat(d));
    G.scene.add(rack.group);
    this.rebuildBoxes();
  }

  unmount(rack: Rack) {
    if (!rack.mount || G.items.held) return;
    this.bySlot.delete(slotKey(rack.mount.cell, rack.mount.dir));
    rack.mount = null;
    G.scene.remove(rack.group);
    this.list = this.list.filter((r) => r !== rack);
    this.rebuildBoxes();
    const crate = G.items.create('crate', `${rack.title} rack (packed)`, { rack });
    G.items.take(crate);
    G.audio?.clunk();
  }

  canInstall(m: Module, d: Dir) {
    return m.faces[d] === 'wall' && !this.at(m.cell, d) && m.type !== 'ship';
  }

  private wallInteract(m: Module, d: Dir): Interactable {
    return {
      acceptLabel: (item: Item) => {
        if (item.kind !== 'crate') return null;
        if (!this.canInstall(m, d)) return null;
        return `Install ${item.data.rack.title} rack here`;
      },
      accept: (item: Item) => {
        G.items.takeFromHands();
        G.items.remove(item);
        this.mountRack(item.data.rack, m.cell, d);
        G.audio?.clunk();
      },
    };
  }

  rebuildBoxes() {
    this.boxes = [];
    for (const r of this.list) {
      if (!r.mount) continue;
      const { cell, dir } = r.mount;
      const c = cellCenter(cell);
      const a = faceVec(dir, HALF_IN - 0.14, -RACK_W / 2, -RACK_H / 2).add(c);
      const b = faceVec(dir, HALF_IN, RACK_W / 2, RACK_H / 2).add(c);
      this.boxes.push(aabb(a.clone().min(b), a.clone().max(b)));
    }
  }

  update(dt: number) {
    for (const r of this.list) if (r.mount) r.update(dt);
  }

  sleep() {
    for (const r of this.list) r.onSleep();
  }

  /** All racks, including packed ones (inside crates) — for saving. */
  all(): Rack[] {
    const packed = G.items.list.filter((i) => i.kind === 'crate').map((i) => i.data.rack as Rack);
    return [...this.list, ...packed];
  }
}

defineItem('crate', {
  radius: 0.35,
  build(item) {
    const rack = item.data.rack as Rack;
    const l = labelMesh(rack.title, 0.6, 0.12, { fg: '#111' });
    const g = simpleBox(0.7, 0.55, 0.35, rack.color, l);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.06, 0.37), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    strap.position.y = -0.15;
    g.add(strap);
    return g;
  },
});

// ---------------- basic racks ----------------

export class BedRack extends Rack {
  type = 'bed';
  title = 'CREW QUARTERS';
  color = 0x8fa3b8;
  build() {
    const bag = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.33, 1.1, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0x3b6ea5, roughness: 0.9 }),
    );
    bag.scale.z = 0.45;
    bag.position.set(0, -0.15, 0.16);
    this.group.add(bag);
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.1), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
    pillow.position.set(0, 0.62, 0.12);
    this.group.add(pillow);
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.04), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c0, emissiveIntensity: 0.6 }));
    light.position.set(0.75, 0.8, 0.05);
    this.group.add(light);
    const sleepIt: Interactable = {
      label: () => 'Sleep until morning',
      use: () => G.days.sleep(),
      altLabel: () => (this.movable && !G.items.held ? `Unmount ${this.title} rack` : null),
      alt: () => G.racks.unmount(this),
    };
    setInteract(bag, sleepIt);
    setInteract(pillow, sleepIt);
  }
}
registerRack('bed', () => new BedRack());

/** A soft-bag locker that holds any number of loose items. */
export class StowageRack extends Rack {
  type = 'stowage';
  title = 'STOWAGE';
  color = 0xc9c3b0;
  contents: Item[] = [];
  build() {
    const bagMat = new THREE.MeshStandardMaterial({ color: 0xf1efe6, roughness: 1 });
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) {
      const bag = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.22), bagMat);
      bag.position.set((i - 0.5) * 0.98, (j - 1) * 0.62 - 0.1, 0.13);
      this.group.add(bag);
      const zip = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.015, 0.01), new THREE.MeshStandardMaterial({ color: 0x333333 }));
      zip.position.set(bag.position.x, bag.position.y + 0.2, 0.245);
      this.group.add(zip);
      setInteract(bag, this.stowInteract());
    }
  }

  stowInteract(): Interactable {
    return {
      label: () => `Look in ${this.title.toLowerCase()} (${this.contents.length} item${this.contents.length === 1 ? '' : 's'})`,
      use: () => this.open(),
      altLabel: () => (this.movable && !G.items.held ? `Unmount ${this.title} rack` : null),
      alt: () => G.racks.unmount(this),
      acceptLabel: (item) => (item.kind === 'crate' || item.kind === 'modkit' ? null : `Stow ${item.name}`),
      accept: (item) => {
        G.items.takeFromHands();
        G.items.stow(item);
        this.contents.push(item);
        G.audio?.paper();
      },
    };
  }

  add(item: Item) {
    G.items.stow(item);
    this.contents.push(item);
  }

  serialize() {
    return { contents: this.contents };
  }
  deserialize(d: Record<string, any>) {
    this.contents = (d.contents ?? []).filter(Boolean);
  }

  open() {
    const div = document.createElement('div');
    div.className = 'paper typed';
    div.innerHTML = `<h1>${this.title}</h1><p class="note">Click something to take it. You can only hold one thing at a time.</p>`;
    if (!this.contents.length) div.innerHTML += '<p>Empty.</p>';
    for (const item of this.contents) {
      const row = document.createElement('div');
      row.className = 'form-row';
      row.style.cursor = 'pointer';
      row.innerHTML = `<span class="name">${item.name}</span>`;
      row.addEventListener('click', () => {
        if (G.items.held) {
          G.ui.toast('Your hands are full');
          return;
        }
        this.contents = this.contents.filter((i) => i !== item);
        G.items.unstowToHands(item);
        G.ui.closeOverlay();
      });
      div.appendChild(row);
    }
    G.ui.openOverlay(div);
  }
}
registerRack('stowage', () => new StowageRack());

export { axisOf };
