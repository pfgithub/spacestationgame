import { ALL_DIRS, Dir, HALF_OUT, cellAdd, cellCenter, cellKey, opposite } from './constants';
import { G } from './game';
import { Interactable } from './interact';
import { Item } from './items';
import { FaceKind, MODULE_NAMES, Module, ModuleType, doorKey } from './station';

const PACKABLE: ModuleType[] = ['corridor', 'cupola'];

/** Installing packed modules from outside, and packing them up again. */
export class Construction {
  constructor() {
    const base = G.station.wallInteract!;
    G.station.wallInteract = (m, d) => {
      const b = base(m, d);
      const merged: Interactable = {
        ...b,
        acceptLabel: (item) => b.acceptLabel?.(item) ?? this.deployLabel(item, m, d),
        accept: (item) => (item.kind === 'modkit' ? this.deploy(item, m, d) : b.accept?.(item)),
        altLabel: () => b.altLabel?.() ?? this.packLabel(m),
        alt: () => (this.packLabel(m) ? this.pack(m) : b.alt?.()),
      };
      return merged;
    };
    G.station.reserved.add(cellKey([0, 0, 2])); // in front of the airlock's outer hatch
  }

  private outside() {
    return !G.station.isInside(G.player.pos);
  }

  /** Why a module can't be berthed on this face, or null if it can. */
  whyNotDeploy(m: Module, d: Dir): string | null {
    const target = cellAdd(m.cell, d);
    const st = G.station;
    if (m.type === 'ship') return 'Not on the cargo vehicle';
    if (m.faces[d] !== 'wall') return 'There is a hatch here';
    if (st.get(target)) return 'There is already a module there';
    if (st.reserved.has(cellKey(target))) return 'That space must be kept clear';
    if (target[0] === 0 && target[1] === 0 && target[2] <= -2) return 'That would block the cargo vehicle approach';
    if (Math.abs(target[1]) > 1) return 'Modules may only be one level above or below the main deck';
    if (G.racks.at(m.cell, d)) return 'A rack is mounted on the inside of this wall';
    return null;
  }

  deployLabel(item: Item, m: Module, d: Dir) {
    if (item.kind !== 'modkit' || !this.outside()) return null;
    const why = this.whyNotDeploy(m, d);
    if (why) return `Can't deploy here: ${why.toLowerCase()}`;
    return `Deploy the ${String(item.data.moduleType)} module here`;
  }

  deploy(item: Item, m: Module, d: Dir) {
    if (this.whyNotDeploy(m, d)) {
      G.audio?.beep(220, 0.2);
      return;
    }
    const type = item.data.moduleType as ModuleType;
    const target = cellAdd(m.cell, d);
    const n = [...G.station.modules.values()].filter((x) => x.type === type).length + 1;
    const faces: Partial<Record<Dir, FaceKind>> = {};
    if (type === 'cupola') {
      // windows on every side except the berthing side
      for (const f of ALL_DIRS) if (f !== opposite(d)) faces[f] = 'window';
    }
    G.items.takeFromHands();
    G.items.remove(item);
    G.station.addModule(target, type, faces, `${MODULE_NAMES[type]} ${n}`);
    G.station.connect(m.cell, d, false);
    G.station.rebuild();
    this.nudgePlayerOut(target, d);
    G.audio?.clunk();
    setTimeout(() => G.audio?.clunk(), 300);
    G.ui.toast(`${MODULE_NAMES[type]} ${n} deployed. Its hatch is closed.`, 4000);
  }

  /** The module unfolds around you: move the player to just outside its nearest free face. */
  private nudgePlayerOut(target: [number, number, number], d: Dir) {
    const c = cellCenter(target);
    const p = G.player.pos;
    const rel = p.clone().sub(c);
    const lim = HALF_OUT + G.player.radius;
    if (Math.abs(rel.x) >= lim || Math.abs(rel.y) >= lim || Math.abs(rel.z) >= lim) return;
    let best: Dir = d;
    let bestGap = Infinity;
    for (const f of ALL_DIRS) {
      if (f === opposite(d)) continue;
      const comp = [rel.x, rel.y, rel.z][f >> 1] * (f & 1 ? -1 : 1);
      const gap = lim - comp;
      if (gap < bestGap) {
        bestGap = gap;
        best = f;
      }
    }
    const axis = (['x', 'y', 'z'] as const)[best >> 1];
    p[axis] = c[axis] + (best & 1 ? -1 : 1) * (lim + 0.1);
    G.player.vel.set(0, 0, 0);
  }

  whyNotPack(m: Module): string | null {
    if (!PACKABLE.includes(m.type)) return 'This module is permanent';
    const conns = ALL_DIRS.filter((d) => m.faces[d] === 'conn');
    if (conns.length !== 1) return 'It is attached at more than one hatch';
    const door = G.station.doors.get(doorKey(m.cell, conns[0]));
    if (door && (door.open || door.t > 0)) return 'Its hatch is open';
    if (ALL_DIRS.some((d) => G.racks.at(m.cell, d))) return 'It still has racks in it';
    if (G.items.list.some((i) => (i.state === 'float' || i.state === 'stuck') && G.station.moduleAt(i.pos) === m)) return 'There are loose things inside';
    if (G.station.moduleAt(G.player.pos) === m) return 'You are inside it';
    return null;
  }

  packLabel(m: Module) {
    if (!this.outside() || G.items.held) return null;
    if (!PACKABLE.includes(m.type)) return null;
    const why = this.whyNotPack(m);
    return why ? `Can't pack ${m.name}: ${why.toLowerCase()}` : `Pack up ${m.name}`;
  }

  pack(m: Module) {
    if (this.whyNotPack(m)) {
      G.audio?.beep(220, 0.2);
      return;
    }
    G.station.removeModule(m.cell);
    G.station.rebuild();
    const kit = G.items.create('modkit', `${MODULE_NAMES[m.type].toLowerCase().replace(/^./, (c) => c.toUpperCase())} module kit`, { moduleType: m.type });
    G.items.take(kit);
    G.audio?.clunk();
  }
}

