import * as THREE from 'three';
import { G } from './game';
import { Interactable, setInteract } from './interact';
import { collideSphere } from './physics';

export type ItemKind =
  | 'paper'
  | 'crate' // a packed-up rack
  | 'modkit' // a packed-up station module
  | 'filter'
  | 'patch'
  | 'brush'
  | 'sample'
  | 'film'
  | 'water'
  | 'decor'
  | 'fuse'
  | 'badge';

export interface Item {
  id: number;
  kind: ItemKind;
  name: string;
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  spin: THREE.Vector3;
  radius: number;
  state: 'float' | 'held' | 'stuck' | 'stowed';
  data: Record<string, any>;
}

export interface ItemDef {
  build(item: Item): THREE.Object3D;
  /** Primary action on a loose item (left click). */
  label?(item: Item): string | null;
  use?(item: Item): void;
  /** Called when R is pressed while holding the item. */
  read?(item: Item): void;
  radius?: number;
}

const defs = new Map<ItemKind, ItemDef>();
export function defineItem(kind: ItemKind, def: ItemDef) {
  defs.set(kind, def);
}

let nextId = 1;
export function setNextItemId(n: number) {
  nextId = n;
}

export class Items {
  list: Item[] = [];
  group = new THREE.Group();
  held: Item | null = null;
  holdAnchor = new THREE.Group();

  constructor() {
    G.scene.add(this.group);
    G.camera.add(this.holdAnchor);
    this.holdAnchor.position.set(0.32, -0.26, -0.6);
  }

  create(kind: ItemKind, name: string, data: Record<string, any> = {}, pos?: THREE.Vector3): Item {
    const def = defs.get(kind);
    if (!def) throw new Error(`no item def for ${kind}`);
    const item: Item = {
      id: nextId++,
      kind,
      name,
      mesh: new THREE.Group(),
      pos: pos?.clone() ?? new THREE.Vector3(),
      vel: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      spin: new THREE.Vector3(),
      radius: def.radius ?? 0.15,
      state: 'float',
      data,
    };
    this.rebuildMesh(item);
    this.list.push(item);
    this.group.add(item.mesh);
    return item;
  }

  rebuildMesh(item: Item) {
    const def = defs.get(item.kind)!;
    const parent = item.mesh.parent;
    parent?.remove(item.mesh);
    const mesh = def.build(item);
    const it: Interactable = {
      label: () => {
        if (item.state === 'held') return null;
        return def.label?.(item) ?? null;
      },
      use: () => def.use?.(item),
      altLabel: () => (this.held ? null : `Take ${item.name}`),
      alt: () => this.take(item),
    };
    setInteract(mesh, it);
    mesh.position.copy(item.pos);
    mesh.quaternion.copy(item.quat);
    item.mesh = mesh;
    parent?.add(mesh);
  }

  /** Brings a removed item back into existence (e.g. returned by the ground). */
  adopt(item: Item) {
    if (!this.list.includes(item)) this.list.push(item);
    item.state = 'stowed';
    item.vel.set(0, 0, 0);
    item.spin.set(0, 0, 0);
    return item;
  }

  remove(item: Item) {
    if (this.held === item) this.held = null;
    item.mesh.parent?.remove(item.mesh);
    this.list = this.list.filter((i) => i !== item);
  }

  /** Puts the item into the player's hands. */
  take(item: Item) {
    if (this.held) return;
    item.state = 'held';
    item.mesh.parent?.remove(item.mesh);
    this.holdAnchor.add(item.mesh);
    item.mesh.position.set(0, 0, 0);
    item.mesh.quaternion.identity();
    // big things are shown smaller in hand
    const box = new THREE.Box3().setFromObject(item.mesh);
    const size = box.getSize(new THREE.Vector3()).length();
    item.mesh.scale.setScalar(size > 0.5 ? 0.5 / size : 1);
    this.held = item;
    G.audio?.click();
  }

  /** Removes the held item from hands and returns it (it is not placed in the world). */
  takeFromHands(): Item | null {
    const item = this.held;
    if (!item) return null;
    this.holdAnchor.remove(item.mesh);
    item.mesh.scale.setScalar(1);
    this.held = null;
    return item;
  }

  /** Places an item into the world at a position. */
  place(item: Item, pos: THREE.Vector3, vel = new THREE.Vector3(), state: Item['state'] = 'float') {
    item.pos.copy(pos);
    item.vel.copy(vel);
    item.state = state;
    item.mesh.scale.setScalar(1);
    this.group.add(item.mesh);
    item.mesh.position.copy(pos);
    item.mesh.quaternion.copy(item.quat);
  }

  /** Stow: the item exists but is not in the world (inside a container). */
  stow(item: Item) {
    item.mesh.parent?.remove(item.mesh);
    item.state = 'stowed';
  }

  unstowToHands(item: Item) {
    item.state = 'float';
    this.take(item);
  }

  /** Let go of the held item. If looking at a nearby wall, it gets stuck there with velcro. */
  release(hit?: THREE.Intersection) {
    const item = this.takeFromHands();
    if (!item) return;
    const p = G.player;
    if (hit && hit.face && hit.distance < 2.6) {
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      item.quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      // keep the item upright-ish relative to the player
      this.place(item, hit.point.clone().addScaledVector(n, item.data.stickOffset ?? 0.03), new THREE.Vector3(), 'stuck');
      G.audio?.click();
    } else {
      item.quat.copy(p.quat);
      // outside, let go gently so things stay where you leave them
      const vel = G.station.isInside(p.pos) ? p.vel.clone().addScaledVector(p.forward, 0.3) : new THREE.Vector3();
      this.place(item, p.pos.clone().addScaledVector(p.forward, 0.6), vel);
      item.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.4);
    }
  }

  update(dt: number) {
    const boxes = G.station.boxes();
    for (const item of this.list) {
      if (item.state !== 'float') continue;
      const inside = G.station.isInside(item.pos);
      // cabin air slowly damps motion; outside nothing does
      if (inside) {
        item.vel.multiplyScalar(Math.exp(-dt * 0.15));
        item.spin.multiplyScalar(Math.exp(-dt * 0.1));
      }
      item.pos.addScaledVector(item.vel, dt);
      collideSphere(item.pos, item.vel, item.radius, boxes, 0.4);
      if (item.spin.lengthSq() > 1e-6) {
        const q = new THREE.Quaternion().setFromAxisAngle(item.spin.clone().normalize(), item.spin.length() * dt);
        item.quat.premultiply(q);
      }
      item.mesh.position.copy(item.pos);
      item.mesh.quaternion.copy(item.quat);
    }
  }

  readHeld() {
    const item = this.held;
    if (!item) return false;
    const def = defs.get(item.kind)!;
    if (!def.read) return false;
    def.read(item);
    return true;
  }
}

// ---------- generic item builders ----------

export function simpleBox(w: number, h: number, d: number, color: number, label?: THREE.Object3D) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  g.add(m);
  if (label) {
    label.position.z = d / 2 + 0.002;
    g.add(label);
  }
  return g;
}
