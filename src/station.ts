import * as THREE from 'three';
import {
  ALL_DIRS, CELL, Cell, Dir, HALF_IN, HALF_OUT, HOLE, axisOf, cellAdd, cellCenter, cellKey, dirVec, faceQuat,
  faceVec, opposite, signOf,
} from './constants';
import { AABB, aabb } from './physics';
import { hullTexture, labelMesh, panelTexture } from './textures';
import { setInteract } from './interact';
import { G } from './game';

export type ModuleType = 'node' | 'lab' | 'hab' | 'airlock' | 'dock' | 'corridor' | 'cupola' | 'ship';
export type FaceKind = 'wall' | 'conn' | 'hatch' | 'port' | 'window';

export interface Module {
  cell: Cell;
  type: ModuleType;
  name: string;
  faces: FaceKind[];
  group: THREE.Group;
  light: THREE.PointLight;
  powered: boolean;
  /** Pressure in kPa. Normal is 101. */
  pressure: number;
}

export interface Door {
  key: string;
  cell: Cell;
  dir: Dir;
  kind: FaceKind;
  open: boolean;
  t: number; // 0 closed, 1 open
  mesh: THREE.Object3D;
  box: AABB;
  /** Returns a reason string if the door cannot currently be operated. */
  interlock?: () => string | null;
}

export const MODULE_NAMES: Record<ModuleType, string> = {
  node: 'NODE 1',
  lab: 'LAB',
  hab: 'HAB',
  airlock: 'AIRLOCK',
  dock: 'DOCKING',
  corridor: 'CORRIDOR',
  cupola: 'CUPOLA',
  ship: 'CARGO VEHICLE',
};

/** Half size of a window opening. */
const WINDOW = 1.2;

function planarUVs(geom: THREE.BufferGeometry, scale: number) {
  const pos = geom.attributes.position;
  const nor = geom.attributes.normal;
  const uv = geom.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (nx >= ny && nx >= nz) uv.setXY(i, z / scale, y / scale);
    else if (ny >= nz) uv.setXY(i, x / scale, z / scale);
    else uv.setXY(i, x / scale, y / scale);
  }
  uv.needsUpdate = true;
}

export function boxMesh(min: THREE.Vector3, max: THREE.Vector3, mat: THREE.Material | THREE.Material[], uvScale = 1.6) {
  const size = max.clone().sub(min);
  const geom = new THREE.BoxGeometry(size.x, size.y, size.z);
  const c = min.clone().add(max).multiplyScalar(0.5);
  geom.translate(c.x, c.y, c.z);
  planarUVs(geom, uvScale);
  return new THREE.Mesh(geom, mat);
}

const mats = (() => {
  const hull = new THREE.MeshStandardMaterial({ map: hullTexture(), roughness: 0.8, metalness: 0.05 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x8c9096, roughness: 0.5, metalness: 0.6 });
  const side = new THREE.MeshStandardMaterial({ map: panelTexture('#c9ccd0', '#9da2a8'), roughness: 0.85 });
  const deck = new THREE.MeshStandardMaterial({ map: panelTexture('#5b6a7c', '#3f4b59'), roughness: 0.85 });
  const overhead = new THREE.MeshStandardMaterial({ map: panelTexture('#e8e6de', '#bdbab0'), roughness: 0.85 });
  const shipIn = new THREE.MeshStandardMaterial({ map: panelTexture('#d8cfb8', '#a99f86'), roughness: 0.85 });
  const door = new THREE.MeshStandardMaterial({ color: 0xa9adb2, roughness: 0.4, metalness: 0.5 });
  const lever = new THREE.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.5, emissive: 0x2a1e00 });
  const rail = new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x88aacc, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.2 });
  const truss = new THREE.MeshStandardMaterial({ color: 0xb8b8b0, roughness: 0.6, metalness: 0.5 });
  return { hull, frame, side, deck, overhead, shipIn, door, lever, rail, glass, truss };
})();
export const stationMats = mats;

function interiorMat(d: Dir, type: ModuleType) {
  if (type === 'ship') return mats.shipIn;
  // In the inward-facing face of the slab on face d.
  if (d === 3) return mats.deck;
  if (d === 2) return mats.overhead;
  return mats.side;
}

export function doorKey(cell: Cell, d: Dir) {
  if (d & 1) {
    return `${cellKey(cellAdd(cell, d))}#${opposite(d)}`;
  }
  return `${cellKey(cell)}#${d}`;
}

/** Tangent extents so that slabs from different axes never overlap. */
function slabExtents(axis: number, tangentAxis: number) {
  // x slabs: full; y slabs: x inner, z full; z slabs: x,y inner
  if (axis === 0) return HALF_OUT;
  if (axis === 1) return tangentAxis === 0 ? HALF_IN : HALF_OUT;
  return HALF_IN;
}

export class Station {
  modules = new Map<string, Module>();
  doors = new Map<string, Door>();
  group = new THREE.Group();
  exterior = new THREE.Group();
  staticBoxes: AABB[] = [];
  extraBoxes: AABB[] = [];
  /** Cells that may never hold a module. */
  reserved = new Set<string>();
  /** Extra dynamic collision sources (racks etc). */
  boxProviders: (() => AABB[])[] = [];
  /** Supplies the interaction for a plain wall face (used for installing racks). */
  wallInteract?: (m: Module, d: Dir) => import('./interact').Interactable;
  /** Called after any structural change. */
  onRebuild: (() => void)[] = [];

  constructor() {
    this.group.add(this.exterior);
  }

  get(cell: Cell) {
    return this.modules.get(cellKey(cell));
  }

  moduleAt(p: THREE.Vector3): Module | undefined {
    for (const m of this.modules.values()) {
      const c = cellCenter(m.cell);
      if (Math.abs(p.x - c.x) <= HALF_IN + 0.01 && Math.abs(p.y - c.y) <= HALF_IN + 0.01 && Math.abs(p.z - c.z) <= HALF_IN + 0.01) return m;
    }
    // inside a doorway tunnel?
    for (const door of this.doors.values()) {
      if (door.kind !== 'conn') continue;
      const c = cellCenter(door.cell).add(dirVec(door.dir).multiplyScalar(HALF_OUT));
      const ax = axisOf(door.dir);
      const d = p.clone().sub(c);
      const comps = [d.x, d.y, d.z];
      if (Math.abs(comps[ax]) <= HALF_OUT - HALF_IN + 0.01 && Math.abs(comps[(ax + 1) % 3]) <= HOLE && Math.abs(comps[(ax + 2) % 3]) <= HOLE) {
        return this.get(door.cell);
      }
    }
    return undefined;
  }

  isInside(p: THREE.Vector3) {
    return !!this.moduleAt(p);
  }

  addModule(cell: Cell, type: ModuleType, faces: Partial<Record<Dir, FaceKind>> = {}, name?: string) {
    const light = new THREE.PointLight(type === "ship" ? 0xfff0d0 : 0xf4f8ff, 2.2, 8, 1);
    const m: Module = {
      cell,
      type,
      name: name ?? MODULE_NAMES[type],
      faces: ALL_DIRS.map((d) => faces[d] ?? 'wall'),
      group: new THREE.Group(),
      light,
      powered: true,
      pressure: 101,
    };
    this.modules.set(cellKey(cell), m);
    return m;
  }

  /** Connects two adjacent modules with a door. */
  connect(cell: Cell, d: Dir, open = true) {
    const a = this.get(cell)!;
    const b = this.get(cellAdd(cell, d))!;
    a.faces[d] = 'conn';
    b.faces[opposite(d)] = 'conn';
    const key = doorKey(cell, d);
    if (!this.doors.has(key)) this.makeDoor(cell, d, 'conn', open);
  }

  disconnect(cell: Cell, d: Dir) {
    const a = this.get(cell);
    const b = this.get(cellAdd(cell, d));
    if (a) a.faces[d] = 'wall';
    if (b) b.faces[opposite(d)] = 'wall';
    this.doors.delete(doorKey(cell, d));
  }

  removeModule(cell: Cell) {
    const m = this.get(cell);
    if (!m) return;
    for (const d of ALL_DIRS) {
      if (m.faces[d] === 'conn') this.disconnect(cell, d);
      else this.doors.delete(doorKey(cell, d));
    }
    this.modules.delete(cellKey(cell));
    this.group.remove(m.group);
    m.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }

  makeDoor(cell: Cell, d: Dir, kind: FaceKind, open: boolean) {
    // canonical: from lower cell in positive direction
    let c = cell, dd = d;
    if (kind === 'conn' && d & 1) { c = cellAdd(cell, d); dd = opposite(d); }
    const key = kind === 'conn' ? doorKey(cell, d) : `${cellKey(cell)}#${d}`;
    const center = cellCenter(c).add(dirVec(dd).multiplyScalar(HALF_OUT));
    const half = faceVec(dd, 0.04, HOLE + 0.02, HOLE + 0.02);
    half.set(Math.abs(half.x), Math.abs(half.y), Math.abs(half.z));
    const door: Door = {
      key, cell: c, dir: dd, kind, open, t: open ? 1 : 0,
      mesh: new THREE.Group(),
      box: aabb(center.clone().sub(half), center.clone().add(half)),
    };
    if (kind === 'port') door.interlock = () => 'The docking port is sealed: there is no vehicle on the other side.';
    this.doors.set(key, door);
    return door;
  }

  toggleDoor(door: Door) {
    const reason = door.interlock?.();
    if (reason) {
      G.ui.toast(reason);
      return;
    }
    door.open = !door.open;
    G.audio?.clunk();
  }

  /** Rebuilds all meshes and collision boxes. */
  rebuild() {
    this.clearDoorGroups();
    for (const m of this.modules.values()) {
      this.group.remove(m.group);
      m.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      m.group = new THREE.Group();
    }
    this.staticBoxes = [];
    for (const m of this.modules.values()) this.buildModule(m);
    for (const door of this.doors.values()) this.buildDoor(door);
    this.staticBoxes.push(...this.extraBoxes);
    this.group.updateMatrixWorld(true);
    for (const f of this.onRebuild) f();
  }

  private buildModule(m: Module) {
    const C = cellCenter(m.cell);
    m.group.position.copy(C);
    this.group.add(m.group);
    for (const d of ALL_DIRS) {
      const kind = m.faces[d];
      const ax = axisOf(d);
      const ua = (ax + 1) % 3, va = (ax + 2) % 3;
      const ue = slabExtents(ax, ua), ve = slabExtents(ax, va);
      const hole = kind !== 'wall';
      const H = kind === 'window' ? WINDOW : HOLE;
      const pieces: [number, number, number, number][] = hole
        ? [[-ue, -H, -ve, ve], [H, ue, -ve, ve], [-H, H, -ve, -H], [-H, H, H, ve]]
        : [[-ue, ue, -ve, ve]];
      const matArr: THREE.Material[] = [];
      for (let i = 0; i < 6; i++) matArr.push(mats.frame);
      matArr[d] = m.type === 'ship' ? mats.hull : mats.hull;
      matArr[opposite(d)] = interiorMat(d, m.type);
      for (const [u0, u1, v0, v1] of pieces) {
        const a = faceVec(d, HALF_IN, u0, v0);
        const b = faceVec(d, HALF_OUT, u1, v1);
        const min = a.clone().min(b), max = a.clone().max(b);
        const mesh = boxMesh(min, max, matArr);
        if (kind === 'wall' && this.wallInteract) setInteract(mesh, this.wallInteract(m, d));
        mesh.userData.surface = true;
        m.group.add(mesh);
        this.staticBoxes.push(aabb(min.clone().add(C), max.clone().add(C)));
      }
      if (kind === 'window') {
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW * 2, WINDOW * 2), mats.glass);
        glass.position.copy(faceVec(d, HALF_OUT - 0.05, 0, 0));
        glass.quaternion.copy(faceQuat(d));
        glass.userData.solid = false;
        m.group.add(glass);
        const a = faceVec(d, HALF_IN + 0.05, -WINDOW, -WINDOW).add(C);
        const b = faceVec(d, HALF_OUT, WINDOW, WINDOW).add(C);
        this.staticBoxes.push(aabb(a.clone().min(b), a.clone().max(b)));
      }
    }
    // handrails on the side walls
    for (const d of ALL_DIRS) {
      if (m.faces[d] !== 'wall' || axisOf(d) === 1) continue;
      for (const s of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 6), mats.rail);
        rail.position.copy(faceVec(d, HALF_IN - 0.08, 0, 0)).add(new THREE.Vector3(0, s * 1.35, 0));
        // align horizontally along the wall tangent that isn't y
        const tangent = axisOf(d) === 0 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
        rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
        m.group.add(rail);
      }
    }
    // name stencil above each doorway
    for (const d of ALL_DIRS) {
      if (m.faces[d] === 'wall' || m.faces[d] === 'window') continue;
      const lbl = labelMesh(m.name, 1.0, 0.18, { fg: '#2b3440' });
      const up = axisOf(d) === 1 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
      lbl.position.copy(dirVec(d).multiplyScalar(HALF_IN - 0.005)).addScaledVector(up, HOLE + 0.25);
      lbl.quaternion.copy(faceQuat(d));
      m.group.add(lbl);
    }
    m.light.position.set(0, 0, 0);
    m.group.add(m.light);
    m.light.intensity = m.powered ? 2.2 : 0;
  }

  private buildDoor(door: Door) {
    const C = cellCenter(door.cell);
    const g = new THREE.Group();
    const center = dirVec(door.dir).multiplyScalar(HALF_OUT);
    g.position.copy(C).add(center);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(HOLE * 2 + 0.04, HOLE * 2 + 0.04, 0.08), mats.door);
    slab.quaternion.copy(faceQuat(door.dir));
    // wheel in the middle
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 16), mats.frame);
    wheel.position.z = 0.06;
    slab.add(wheel);
    const wheel2 = wheel.clone();
    wheel2.position.z = -0.06;
    slab.add(wheel2);
    const panel = new THREE.Group();
    panel.add(slab);
    g.add(panel);
    door.mesh = panel;
    this.group.add(g);
    // the owning module group gets removed on rebuild; keep door groups tracked for removal
    (this.doorGroups ??= []).push(g);

    const it = {
      label: () => door.open ? 'Close hatch' : 'Open hatch',
      use: () => this.toggleDoor(door),
    };
    setInteract(slab, it);
    // levers on both sides (only on pressurised sides for outer hatches)
    const sides = door.kind === 'conn' ? [1, -1] : [-1, 1];
    for (const s of sides) {
      const lever = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), mats.lever);
      const inward = dirVec(door.dir).multiplyScalar(s * (HALF_OUT - HALF_IN + 0.04));
      const side = (axisOf(door.dir) === 0 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).multiplyScalar(HOLE + 0.18);
      lever.position.copy(inward).add(side);
      g.add(lever);
      setInteract(lever, it);
    }
    this.updateDoorMesh(door);
  }
  doorGroups?: THREE.Group[];

  private updateDoorMesh(door: Door) {
    const off = faceVec(door.dir, 0, 0, door.t * (HOLE * 2 + 0.1));
    door.mesh.position.copy(off);
    door.mesh.visible = door.t < 0.98;
  }

  /** All collision boxes currently active. */
  boxes() {
    const out = this.staticBoxes.slice();
    for (const d of this.doors.values()) if (d.t < 0.6) out.push(d.box);
    for (const p of this.boxProviders) out.push(...p());
    return out;
  }

  update(dt: number) {
    for (const d of this.doors.values()) {
      const target = d.open ? 1 : 0;
      if (d.t !== target) {
        d.t += Math.sign(target - d.t) * Math.min(Math.abs(target - d.t), dt * 1.6);
        this.updateDoorMesh(d);
      }
    }
  }

  clearDoorGroups() {
    for (const g of this.doorGroups ?? []) {
      this.group.remove(g);
      g.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    }
    this.doorGroups = [];
  }

  /** Exterior anchor locations and structure (truss/solar arrays) are built by other systems into `exterior`. */
  addExteriorBox(min: THREE.Vector3, max: THREE.Vector3, mat: THREE.Material) {
    const mesh = boxMesh(min, max, mat, 2);
    this.exterior.add(mesh);
    this.extraBoxes.push(aabb(min.clone(), max.clone()));
    return mesh;
  }
}

export const CELL_SIZE = CELL;
export { signOf };
