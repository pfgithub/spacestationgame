import * as THREE from 'three';
import { Cell, Dir } from './constants';
import { G } from './game';
import { Item, setNextItemId } from './items';
import { Rack } from './racks';
import type { FaceKind, ModuleType } from './station';

const KEY = 'orbital-save-v1';
/** Scripted test runs don't touch the real save unless asked to. */
const noSaves = () => G.input.testMode && !new URLSearchParams(location.search).has('persist');

type V3 = [number, number, number];
type Q4 = [number, number, number, number];

interface SaveData {
  version: 1;
  day: number;
  time: number;
  player: { pos: V3; quat: Q4; vel: V3 };
  modules: { cell: Cell; type: ModuleType; name: string; faces: FaceKind[]; pressure: number }[];
  doors: { cell: Cell; dir: Dir; kind: FaceKind; open: boolean }[];
  racks: { type: string; mount: { cell: Cell; dir: Dir; rot?: number } | null; data: Record<string, any> }[];
  items: { id: number; kind: Item['kind']; name: string; pos: V3; quat: Q4; vel: V3; spin: V3; state: Item['state']; data: Record<string, any> }[];
  science: { balance: number; totalEarned: number; progress: Record<string, number>; completed: string[] };
  cargo: { state: 'docked' | 'waiting' | 'away'; pos: V3; vehicleNo: number; manifest: number[]; outgoing: number[] };
  eva: { suited: boolean; tether: { anchor: V3; length: number } | null; pump: 'idle' | 'depress' | 'repress' };
  power: { wings: number[]; fuses: Record<string, 'ok' | 'blown' | 'empty'> };
  life: { co2: number; cartridge: number; cartridgeIn: boolean; leak: { cell: Cell; dir: Dir; u: number; v: number } | null };
}

const v3 = (v: THREE.Vector3): V3 => [v.x, v.y, v.z];
const q4 = (q: THREE.Quaternion): Q4 => [q.x, q.y, q.z, q.w];

/** Racks reference items (stowage contents) and items reference racks (crates); both are saved by index/id. */
export function serializeRef(v: unknown, rackIndex: Map<Rack, number>): unknown {
  if (v instanceof Rack) return { $rack: rackIndex.get(v) };
  if (v && typeof v === 'object' && 'kind' in (v as object) && 'mesh' in (v as object)) return { $item: (v as Item).id };
  if (Array.isArray(v)) return v.map((x) => serializeRef(x, rackIndex));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'function') continue;
      out[k] = serializeRef(x, rackIndex);
    }
    return out;
  }
  return v;
}

function resolveRef(v: unknown, racks: Rack[], items: Map<number, Item>): unknown {
  if (Array.isArray(v)) return v.map((x) => resolveRef(x, racks, items));
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('$rack' in o) return racks[o.$rack as number];
    if ('$item' in o) return items.get(o.$item as number);
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) out[k] = resolveRef(x, racks, items);
    return out;
  }
  return v;
}

export function buildSave(): SaveData {
  const racks = G.racks.all();
  const rackIndex = new Map(racks.map((r, i) => [r, i]));
  const st = G.station;
  return {
    version: 1,
    day: G.day,
    time: G.time,
    player: { pos: v3(G.player.pos), quat: q4(G.player.quat), vel: v3(G.player.vel) },
    modules: [...st.modules.values()].map((m) => ({ cell: m.cell, type: m.type, name: m.name, faces: m.faces.slice(), pressure: m.pressure })),
    doors: [...st.doors.values()].map((d) => ({ cell: d.cell, dir: d.dir, kind: d.kind, open: d.open })),
    racks: racks.map((r) => ({ type: r.type, mount: r.mount, data: serializeRef(r.serialize(), rackIndex) as Record<string, any> })),
    items: G.items.list.map((i) => ({
      id: i.id, kind: i.kind, name: i.name, pos: v3(i.pos), quat: q4(i.quat), vel: v3(i.vel), spin: v3(i.spin), state: i.state,
      data: serializeRef(i.data, rackIndex) as Record<string, any>,
    })),
    science: { balance: G.science.balance, totalEarned: G.science.totalEarned, progress: G.science.progress, completed: [...G.science.completed] },
    cargo: {
      state: G.cargo.state, pos: v3(G.cargo.pos), vehicleNo: G.cargo.vehicleNo,
      manifest: G.cargo.manifest.map((i) => i.id), outgoing: G.cargo.outgoingLetters.map((i) => i.id),
    },
    eva: { suited: G.eva.suited, tether: G.eva.tether ? { anchor: v3(G.eva.tether.anchor), length: G.eva.tether.length } : null, pump: G.eva.pump },
    power: { wings: G.power.wings.slice(), fuses: { ...G.power.fuses } },
    life: {
      co2: G.life.co2, cartridge: G.life.cartridge, cartridgeIn: G.life.cartridgeIn,
      leak: G.life.leak ? { cell: G.life.leak.cell, dir: G.life.leak.dir, u: G.life.leak.u, v: G.life.leak.v } : null,
    },
  };
}

export function writeSave() {
  if (noSaves() || G.resetting || G.cargo?.docking || G.days?.sleeping) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(buildSave()));
  } catch (e) {
    console.warn('save failed', e);
  }
}

export function loadSave(): SaveData | null {
  if (noSaves()) return null;
  if (new URLSearchParams(location.search).has('fresh')) {
    clearSave();
    history.replaceState(null, '', location.pathname);
    return null;
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    return d.version === 1 ? d : null;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function restoreGame(d: SaveData) {
  const st = G.station;
  G.day = d.day;
  G.time = d.time;
  for (const m of d.modules) {
    const faces: Partial<Record<Dir, FaceKind>> = {};
    m.faces.forEach((f, i) => (faces[i as Dir] = f));
    st.addModule(m.cell, m.type, faces, m.name).pressure = m.pressure;
  }
  for (const door of d.doors) st.makeDoor(door.cell, door.dir, door.kind, door.open);
  st.rebuild();
  G.eva.setupInterlocks();

  // racks first (crates refer to them), then items, then resolve the racks' references to items
  const racks = d.racks.map((r) => G.racks.create(r.type));
  const items = new Map<number, Item>();
  let maxId = 0;
  for (const s of d.items) {
    const data = resolveRef(s.data, racks, new Map()) as Record<string, any>;
    const item = G.items.create(s.kind, s.name, data);
    item.id = s.id;
    maxId = Math.max(maxId, s.id);
    items.set(s.id, item);
    item.quat.set(...s.quat);
    item.spin.set(...s.spin);
    const pos = new THREE.Vector3(...s.pos);
    if (s.state === 'stowed') G.items.stow(item);
    else if (s.state === 'held') G.items.take(item);
    else G.items.place(item, pos, new THREE.Vector3(...s.vel), s.state);
  }
  setNextItemId(maxId + 1);
  d.racks.forEach((r, i) => {
    racks[i].deserialize(resolveRef(r.data, racks, items) as Record<string, any>);
    if (r.mount) G.racks.mountRack(racks[i], r.mount.cell, r.mount.dir, r.mount.rot ?? 0);
  });

  Object.assign(G.science, { balance: d.science.balance, totalEarned: d.science.totalEarned, progress: d.science.progress, completed: new Set(d.science.completed) });
  G.power.wings = d.power.wings;
  Object.assign(G.power.fuses, d.power.fuses);
  G.life.co2 = d.life.co2;
  G.life.cartridge = d.life.cartridge;
  G.life.cartridgeIn = d.life.cartridgeIn;
  if (d.life.leak) G.life.startLeak(d.life.leak);
  G.eva.suited = d.eva.suited;
  G.ui.vignette.classList.toggle('suit', d.eva.suited);
  G.eva.tether = d.eva.tether ? { anchor: new THREE.Vector3(...d.eva.tether.anchor), length: d.eva.tether.length } : null;
  G.eva.wasOutside = !st.isInside(new THREE.Vector3(...d.player.pos));
  G.eva.pump = d.eva.pump;
  G.cargo.restore(d.cargo.state, new THREE.Vector3(...d.cargo.pos), d.cargo.vehicleNo,
    d.cargo.manifest.map((id) => items.get(id)!).filter(Boolean), d.cargo.outgoing.map((id) => items.get(id)!).filter(Boolean));
  G.player.pos.set(...d.player.pos);
  G.player.quat.set(...d.player.quat);
  G.player.vel.set(...d.player.vel);
}
