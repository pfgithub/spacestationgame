import * as THREE from 'three';
import { G } from './game';
import { registerRack } from './racks';
import { Experiment, chamber } from './experiments';
import { button, dial, gauge, lamp, sevenSeg, slot, text, toggle } from './controls';
import { defineItem, Item } from './items';
import { registerDoc } from './docs';
import { labelMesh } from './textures';
import { setInteract } from './interact';
import type { Dir } from './constants';
import type { Module } from './station';

const FILM_PORT = new THREE.Vector3(0.55, -0.55, 0.15);

/** Ejects a film canister from a rack's film port. */
function ejectFilm(rack: Experiment, name: string, report: import('./science').Report | null, at = FILM_PORT) {
  const film = G.items.create('film', name, { caption: name.replace(/^Film: /, '') });
  film.data.report = report;
  const world = at.clone().applyMatrix4(rack.group.matrixWorld);
  G.items.place(film, world, new THREE.Vector3(0, 0, 1).applyQuaternion(rack.group.quaternion).multiplyScalar(0.3));
  return film;
}

function filmPort(rack: Experiment, x = 0.55, y = -0.55) {
  const port = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 16), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  port.rotation.x = Math.PI / 2;
  port.position.set(x, y, 0.06);
  rack.group.add(port);
  text(rack.group, 'FILM', x, y - 0.13, 0.2, 0.05);
}

/** A rack that holds a few items (incubator, freezer). */
abstract class HolderRack extends Experiment {
  contents: Item[] = [];
  abstract capacity: number;
  abstract accepts(item: Item): boolean;
  onInsert(_item: Item) {}
  onRemove(_item: Item) {}
  holderMeshes: THREE.Mesh[] = [];

  holder(x: number, y: number, w: number, h: number, label: string) {
    const s = slot(this.group, x, y, w, h, label,
      (item) => (this.accepts(item) && this.contents.length < this.capacity && !this.broken ? `Put the ${item.name.toLowerCase()} in` : null),
      (item) => {
        G.items.takeFromHands();
        G.items.stow(item);
        this.contents.push(item);
        this.onInsert(item);
        G.audio?.click();
        this.syncHolder();
      },
      {
        label: () => (this.contents.length ? `Take out the ${this.contents[this.contents.length - 1].name.toLowerCase()}` : null),
        use: () => {
          if (G.items.held) {
            G.ui.toast('Your hands are full');
            return;
          }
          const item = this.contents.pop()!;
          this.onRemove(item);
          G.items.unstowToHands(item);
          this.syncHolder();
        },
      });
    for (let i = 0; i < this.capacity; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w / this.capacity * 0.7, h * 0.6, 0.03), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
      m.position.set(-w / 2 + (i + 0.5) * (w / this.capacity), 0, 0.03);
      m.userData.solid = false;
      s.add(m);
      this.holderMeshes.push(m);
    }
    this.syncHolder();
  }

  syncHolder() {
    this.holderMeshes.forEach((m, i) => {
      m.visible = i < this.contents.length;
      if (m.visible) (m.material as THREE.MeshStandardMaterial).color.setHex(this.contents[i].data.color ?? 0xdddddd);
    });
  }

  serialize() {
    return { ...super.serialize(), contents: this.contents };
  }
  deserialize(d: Record<string, any>) {
    super.deserialize(d);
    this.contents = (d.contents ?? []).filter(Boolean);
    if (this.holderMeshes.length) this.syncHolder();
  }
}

// ================================================================================================
// Student droplet kit (free)
// ================================================================================================

export class DropletRack extends Experiment {
  type = 'droplet';
  title = 'STUDENT DROPLET KIT';
  color = 0xe6d7a8;
  needsPower = false;
  runsNeeded = 3;
  points = 4;
  size = 0;
  splat = false;
  still = 0;
  photographed = false;
  blob!: THREE.Mesh;
  splatMesh!: THREE.Mesh;

  build() {
    chamber(this.group, -0.35, 0.25, 0.8, 0.8, 0x223040);
    this.blob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 20, 14), new THREE.MeshStandardMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.7, roughness: 0.05 }));
    this.blob.position.set(-0.35, 0.25, 0.2);
    this.group.add(this.blob);
    this.splatMesh = new THREE.Mesh(new THREE.CircleGeometry(0.3, 12), new THREE.MeshStandardMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.45 }));
    this.splatMesh.position.set(-0.35, 0.25, 0.3);
    this.splatMesh.userData.solid = false;
    this.group.add(this.splatMesh);
    text(this.group, 'MADE BY THE PUPILS OF', 0.45, 0.62, 0.7, 0.05, '#553');
    text(this.group, 'HILLSIDE PRIMARY SCHOOL', 0.45, 0.55, 0.7, 0.05, '#553');
    button(this.group, 0.3, 0.2, 'SQUEEZE', 0x3388ff, () => this.squeeze());
    button(this.group, 0.7, 0.2, 'DRAIN', 0x777777, () => this.drain());
    button(this.group, 0.3, -0.25, 'SHUTTER', 0x333333, () => this.photo());
    filmPort(this, 0.7, -0.25);
    text(this.group, 'HAND OPERATED · NO POWER NEEDED', -0.35, -0.95, 1.0, 0.06, '#333');
  }

  squeeze() {
    if (this.splat) return;
    this.size++;
    this.still = 4;
    G.audio?.click();
    if (this.size >= 4) {
      this.splat = true;
      G.audio?.bump(0.8);
    }
  }

  drain() {
    this.size = 0;
    this.splat = false;
    this.photographed = false;
    G.audio?.hiss(0.8);
  }

  photo() {
    G.audio?.click();
    if (this.size === 0 && !this.splat) return;
    const valid = this.size === 3 && !this.splat && this.still <= 0 && !this.photographed;
    this.photographed = true;
    ejectFilm(this, 'Film: droplet photograph', valid ? this.completeRun('Student droplet') : null, new THREE.Vector3(0.7, -0.25, 0.15));
  }

  update(dt: number) {
    this.still -= dt;
    const s = this.splat ? 0.001 : Math.cbrt(this.size) || 0.001;
    const wob = Math.max(0, this.still) / 4;
    this.blob.scale.set(s * (1 + 0.2 * wob * Math.sin(G.time * 11)), s * (1 + 0.2 * wob * Math.cos(G.time * 9)), s);
    this.blob.visible = this.size > 0 && !this.splat;
    this.splatMesh.visible = this.splat;
  }

  serialize() {
    return { ...super.serialize(), size: this.size, splat: this.splat, photographed: this.photographed };
  }
  deserialize(d: Record<string, any>) {
    super.deserialize(d);
    Object.assign(this, { size: d.size ?? 0, splat: d.splat ?? false, photographed: d.photographed ?? false });
  }
}
registerRack('droplet', () => new DropletRack());

registerDoc('proc-droplet', {
  title: 'Instructions: student droplet kit',
  cover: 'OUR DROPLET EXPERIMENT',
  color: '#fff8e0',
  html: `
<h1>Our Droplet Experiment!</h1>
<div class="meta">by Class 4 of Hillside Primary School</div>
<p>Dear Astronaut, thank you for doing our experiment! We want to know if water makes a perfect ball in space.</p>
<ol>
<li>Press <b>SQUEEZE</b> to make a droplet. Every squeeze makes it bigger. We need a droplet from exactly
<b>three</b> squeezes. If you squeeze four times it gets too big and touches the sides and goes splat.</li>
<li>Wait until the droplet stops wobbling. (We think this takes a few seconds.)</li>
<li>Press <b>SHUTTER</b> to take a photo. The film comes out of the FILM hole.</li>
<li>Press <b>DRAIN</b> to empty it before the next one. You can only take one photo of each droplet.</li>
</ol>
<p>Please send us <b>three</b> good photos! Our teacher says each one is worth <b>4 points</b> to you.
If it goes splat just press DRAIN and try again.</p>
<p>From Class 4 &#9786;</p>`,
});

// ================================================================================================
// Exercise bike
// ================================================================================================

export class ErgometerRack extends Experiment {
  type = 'ergometer';
  title = 'CYCLE ERGOMETER';
  color = 0xb8c4d0;
  runsNeeded = 5;
  points = 6;
  clicks: number[] = [];
  seconds = 0;
  loggedToday = false;
  g!: ReturnType<typeof gauge>;
  counter!: ReturnType<typeof sevenSeg>;
  crank = new THREE.Group();

  build() {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 24), new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.5 }));
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(-0.45, -0.3, 0.12);
    this.group.add(wheel);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.04), new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.7 }));
    const pedal1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.1), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    pedal1.position.y = 0.25;
    const pedal2 = pedal1.clone();
    pedal2.position.y = -0.25;
    this.crank.add(arm, pedal1, pedal2);
    this.crank.position.set(-0.45, -0.3, 0.2);
    this.group.add(this.crank);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.25), new THREE.MeshStandardMaterial({ color: 0x223355 }));
    seat.position.set(-0.45, 0.45, 0.15);
    this.group.add(seat);
    this.g = gauge(this.group, 0.45, 0.45, 'CADENCE');
    const band = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.085, 16, 1, Math.PI / 2 - 0.12 - Math.PI * 0.36, Math.PI * 0.48), new THREE.MeshBasicMaterial({ color: 0x33aa44 }));
    band.position.set(0.45, 0.45, 0.056);
    this.group.add(band);
    this.counter = sevenSeg(this.group, 0.45, 0.05, 3, 0.14);
    text(this.group, 'SECONDS IN BAND', 0.45, -0.07, 0.5, 0.05);
    const pedalIt = {
      label: () => 'Pedal',
      use: () => {
        this.clicks.push(G.time);
        this.crank.rotation.z -= Math.PI / 2;
      },
    };
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.3), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(-0.45, -0.3, 0.2);
    this.group.add(hit);
    setInteract(hit, pedalIt);
    button(this.group, 0.45, -0.45, 'LOG', 0x333333, () => this.log());
    text(this.group, 'MODEL CE-1 · 28V', -0.55, -0.95, 0.6, 0.06, '#333');
  }

  cadence() {
    const recent = this.clicks.filter((t) => G.time - t < 2);
    this.clicks = recent;
    return recent.length / 2;
  }

  log() {
    if (!this.powered) return;
    const pos = new THREE.Vector3(0.45, -0.7, 0.12);
    if (this.seconds >= 60 && !this.loggedToday) {
      this.loggedToday = true;
      G.science.printSlip(this, pos, 'ERGOMETER LOG', [
        `WORK ........ ${(this.seconds * 1.6).toFixed(0)} KJ`,
        `HEART RATE .. ${120 + Math.floor(Math.random() * 25)} BPM`,
        `SESSION ..... COMPLETE`,
      ], this.completeRun('Exercise study'));
    } else {
      G.science.printSlip(this, pos, 'ERGOMETER LOG', [
        `SECONDS ..... ${Math.floor(this.seconds)}`,
        `SESSION ..... ${this.loggedToday ? 'ALREADY LOGGED TODAY' : 'INCOMPLETE'}`,
      ], null);
    }
    this.seconds = 0;
  }

  update(dt: number) {
    const c = this.cadence();
    this.g.set(this.powered ? c / 5 : 0);
    this.g.update(dt);
    // green band is 2..4 on the dial: 2 to 4 pedal strokes a second
    if (this.powered && c >= 2 && c <= 4) this.seconds = Math.min(999, this.seconds + dt);
    this.counter.set(this.powered ? String(Math.floor(this.seconds)) : '');
  }

  onSleep() {
    this.loggedToday = false;
    this.seconds = 0;
  }

  serialize() {
    return { ...super.serialize(), loggedToday: this.loggedToday };
  }
  deserialize(d: Record<string, any>) {
    super.deserialize(d);
    this.loggedToday = d.loggedToday ?? false;
  }
}
registerRack('ergometer', () => new ErgometerRack());

registerDoc('proc-ergometer', {
  title: 'Procedure: exercise study',
  cover: 'PROCEDURE CE-1 Exercise Study',
  html: `
<h1>PROCEDURE CE-1</h1>
<div class="meta">Cycle ergometer &middot; muscle and bone loss study</div>
<p>Without gravity, muscles and bones waste away. We are studying how much daily exercise it takes to prevent it.
Each day's logged session is worth <b>6 points</b>; the study calls for <b>five</b> sessions.</p>
<ol>
<li>Pedal the ergometer (click the pedals, over and over) at a steady pace, keeping the <b>CADENCE</b> needle
in the green band.</li>
<li>The counter shows how many seconds you have spent in the band. Keep going to at least <b>60</b>.</li>
<li>Press <b>LOG</b> to print the session slip.</li>
</ol>
<p class="note">Only one session a day counts. Pressing LOG ends the session whether or not it was long enough.</p>`,
});

// ================================================================================================
// Microbiology: air sampler + incubator
// ================================================================================================

defineItem('airsampler', {
  radius: 0.12,
  build() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.22, 16), new THREE.MeshStandardMaterial({ color: 0xe8e8e8 }));
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 16), new THREE.MeshStandardMaterial({ color: 0x3377bb }));
    head.position.y = 0.12;
    g.add(body, head);
    return g;
  },
  label: (item) => `Air sampler (${item.data.samples.length} plate${item.data.samples.length === 1 ? '' : 's'} used)`,
  use: () => G.ui.toast('Take it in your hand to sample the air.'),
  heldLabel(item) {
    if (item.data.incubated > 0) return null;
    const m = G.station.moduleAt(G.player.pos);
    if (!m || m.type === 'ship') return null;
    if ((item.data.samples as string[]).includes(m.name)) return null;
    if (item.data.samples.length >= 6) return null;
    return `Sample the air in ${m.name} (plate ${item.data.samples.length + 1} of 6)`;
  },
  heldUse(item) {
    const m = G.station.moduleAt(G.player.pos)!;
    item.data.samples.push(m.name);
    G.audio?.hiss(1.2);
  },
});

export class IncubatorRack extends HolderRack {
  type = 'incubator';
  title = 'INCUBATOR';
  color = 0xd8c8c0;
  runsNeeded = 3;
  points = 4;
  capacity = 3;
  warm!: ReturnType<typeof lamp>;

  accepts(item: Item) {
    return item.kind === 'airsampler' || item.kind === 'yeastbag';
  }

  build() {
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 0.06), new THREE.MeshStandardMaterial({ color: 0xf0ece4 }));
    door.position.set(0, 0.35, 0.05);
    this.group.add(door);
    text(this.group, '37 °C', 0, 0.55, 0.3, 0.08);
    this.holder(0, 0.3, 0.9, 0.3, 'SAMPLE BAY');
    this.warm = lamp(this.group, -0.5, -0.25, 0xffaa33, 'AT TEMPERATURE');
    button(this.group, 0.3, -0.3, 'COUNT PLATES', 0x333333, () => this.count());
    text(this.group, 'MODEL IN-2 · 28V', -0.55, -0.95, 0.6, 0.06, '#333');
  }

  count() {
    if (!this.powered) return;
    const sampler = this.contents.find((i) => i.kind === 'airsampler');
    if (!sampler) {
      G.audio?.beep(220, 0.2);
      return;
    }
    const pos = new THREE.Vector3(0.3, -0.6, 0.12);
    const samples = sampler.data.samples as string[];
    if (!sampler.data.incubated) {
      G.science.printSlip(this, pos, 'PLATE COUNT', ['PLATES NOT YET INCUBATED', 'INCUBATE OVERNIGHT FIRST'], null);
      return;
    }
    const lines = samples.map((m) => `${m.padEnd(14, '.')} ${10 + Math.floor(Math.random() * 90)} CFU`);
    if (samples.length >= 3) {
      G.science.printSlip(this, pos, 'PLATE COUNT', [...lines, `MODULES ..... ${samples.length}`], this.completeRun(`Air microbiology (${samples.length} modules)`, samples.length));
    } else {
      G.science.printSlip(this, pos, 'PLATE COUNT', [...lines, 'TOO FEW MODULES SAMPLED'], null);
    }
    sampler.data.samples = [];
    sampler.data.incubated = 0;
  }

  update() {
    this.warm.set(this.powered);
  }

  onSleep() {
    if (!this.powered) return;
    for (const i of this.contents) {
      if (i.kind === 'yeastbag' && (!i.data.activated || i.data.dead)) continue;
      i.data.incubated = (i.data.incubated ?? 0) + 1;
      if (i.kind === 'yeastbag') G.items.rebuildMesh(i);
    }
  }
}
registerRack('incubator', () => new IncubatorRack());

registerDoc('proc-microbiology', {
  title: 'Procedure: air microbiology',
  cover: 'PROCEDURE IN-2 Air Microbiology',
  html: `
<h1>PROCEDURE IN-2</h1>
<div class="meta">Microbial survey of the station air</div>
<p>Every station grows its own population of microbes. We would like to know where they live.</p>
<ol>
<li>Carry the <b>air sampler</b> from module to module. In each module, hold it up and take a sample (left click).
Each module can be sampled once; the sampler holds six plates.</li>
<li>Put the sampler in the <b>INCUBATOR</b> and leave it there overnight.</li>
<li>In the morning, press <b>COUNT PLATES</b>. The incubator prints a colony count and wipes the plates for reuse.</li>
</ol>
<p>A survey is worth <b>4 points for every module sampled</b>, but needs at least <b>three</b> modules to be useful.
We would like <b>three</b> surveys.</p>
<p class="note">Plates can't take new samples once they have been incubated &mdash; count them first.
The incubator only incubates while it has power.</p>`,
});

// ================================================================================================
// Yeast fermentation: incubator -> freezer -> cargo vehicle, judged on the ground
// ================================================================================================

const THAW_SECONDS = 180;

function yeastState(item: Item): string {
  const d = item.data;
  if (d.dead) return d.dead;
  if (!d.activated) return 'not started';
  if (d.inFreezer) return 'frozen';
  if (d.frozen) return 'frozen, thawing';
  if (d.incubated) return 'grown';
  return 'culture started';
}

defineItem('yeastbag', {
  radius: 0.1,
  build(item) {
    const color = item.data.dead ? 0x6a5a3a : item.data.frozen || item.data.inFreezer ? 0xeef6ff : item.data.activated ? 0xd9b870 : 0xf2ead6;
    item.data.color = color;
    const g = new THREE.Group();
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.04), new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.9 }));
    const lbl = labelMesh('YEAST', 0.1, 0.03, { fg: '#422' });
    lbl.position.z = 0.021;
    g.add(bag, lbl);
    return g;
  },
  label: (item) => `Yeast bag (${yeastState(item)})`,
  use: () => G.ui.toast('A sealed culture bag. Take it in your hand to use it.'),
  heldLabel: (item) => (!item.data.activated && !item.data.dead ? 'Squeeze the bag to start the culture' : null),
  heldUse(item) {
    item.data.activated = true;
    item.name = 'Yeast bag';
    G.audio?.paper();
    G.items.rebuildMesh(item);
  },
});

function killYeast(item: Item, why: string) {
  if (item.data.dead) return;
  item.data.dead = why;
  G.items.rebuildMesh(item);
}

/** The freezer also keeps the books for the yeast study: its series and points. */
export class FreezerRack extends HolderRack {
  type = 'freezer';
  title = 'SAMPLE FREEZER';
  color = 0xc8d4e0;
  runsNeeded = 3;
  points = 15;
  capacity = 6;
  display!: ReturnType<typeof sevenSeg>;

  accepts(item: Item) {
    return item.kind === 'yeastbag';
  }

  build() {
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 0.08), new THREE.MeshStandardMaterial({ color: 0xf4f7fa }));
    door.position.set(0, 0.3, 0.06);
    this.group.add(door);
    this.holder(0, 0.3, 1.1, 0.3, 'DRAWER');
    this.display = sevenSeg(this.group, 0, -0.3, 3, 0.14);
    text(this.group, '°C', 0.25, -0.3, 0.1, 0.06);
    text(this.group, 'SAMPLES THAW IN ABOUT 3 MINUTES AT CABIN TEMPERATURE', 0, -0.6, 1.8, 0.05, '#8a1a10');
  }

  onInsert(item: Item) {
    item.data.inFreezer = true;
    if (item.data.activated && !item.data.dead) {
      if (!item.data.incubated) killYeast(item, 'frozen before it grew');
      else item.data.frozen = true;
    }
    G.items.rebuildMesh(item);
  }

  onRemove(item: Item) {
    item.data.inFreezer = false;
    item.data.thawAt = G.time + THAW_SECONDS;
  }

  update() {
    this.display.set(this.powered ? '-80' : '');
  }

  onSleep() {
    // a freezer without power thaws everything in it
    if (!this.powered) for (const i of this.contents) if (i.data.frozen) killYeast(i, 'thawed in a dead freezer');
  }
}
registerRack('freezer', () => new FreezerRack());

/** Hooks the yeast study into the game's clock, nights and mail. Call once G is set up. */
export function initExperiments3() {
  // frozen bags thaw at cabin temperature, but the cargo vehicle's unheated cabin keeps them cold
  G.science.tickers.push(() => {
    for (const item of G.items.list) {
      if (item.kind !== 'yeastbag' || !item.data.frozen || item.data.inFreezer || item.data.dead) continue;
      const m = G.station.moduleAt(item.state === 'held' ? G.player.pos : item.pos);
      if (m?.type === 'ship') item.data.thawAt = G.time + THAW_SECONDS;
      else if (G.time > (item.data.thawAt ?? 0)) killYeast(item, 'thawed');
    }
  });
  G.days.nightly.unshift(() => {
    // runs after the incubator has counted the night: a second night overgrows, and started bags left out die
    const inIncubator = new Set(G.racks.list.filter((r) => r.type === 'incubator').flatMap((r) => (r as IncubatorRack).contents));
    for (const item of G.items.list) {
      if (item.kind !== 'yeastbag' || !item.data.activated || item.data.dead) continue;
      if (inIncubator.has(item) && (item.data.incubated ?? 0) >= 2) killYeast(item, 'overgrown');
      else if (!inIncubator.has(item) && !item.data.inFreezer && !item.data.frozen) killYeast(item, 'died at cabin temperature');
    }
  });
  G.science.sendHooks.push((items) => {
    for (const item of items) {
      if (item.kind !== 'yeastbag') continue;
      const ok = item.data.activated && item.data.frozen && !item.data.dead;
      const freezer = G.racks.all().find((r) => r.type === 'freezer' && !(r as FreezerRack).spent) as FreezerRack | undefined;
      item.data.report = ok && freezer ? freezer.completeRun('Yeast fermentation') : null;
    }
  });
}

registerDoc('proc-yeast', {
  title: 'Procedure: yeast fermentation',
  cover: 'PROCEDURE YF-1 Yeast Fermentation',
  html: `
<h1>PROCEDURE YF-1</h1>
<div class="meta">Yeast fermentation study &middot; samples returned to the ground</div>
<p>This study compares yeast grown in orbit with yeast grown on the ground. The analysis is done by our laboratory,
so the samples must come home <b>frozen</b>. Each good sample is worth <b>15 points</b> when it arrives; we would like
<b>three</b>. Requires the INCUBATOR (microbiology kit) and the SAMPLE FREEZER supplied with this study.</p>
<ol>
<li>Hold a culture bag and <b>squeeze</b> it (left click) to start the culture.</li>
<li>Put it in the <b>INCUBATOR</b> straight away, and leave it there for <b>exactly one night</b>.</li>
<li>In the morning, move it to the <b>SAMPLE FREEZER</b>.</li>
<li>When you are ready to send it, take it out of the freezer and put it in the cargo vehicle. Out of the freezer a
sample thaws in about <b>three minutes</b>; the cargo vehicle's cabin is unheated and keeps it frozen.</li>
</ol>
<h2>Spoiled samples</h2>
<p>A bag left in the incubator for a second night overgrows. A started bag left out overnight dies. A bag that thaws is
spoiled. Frozen before it has grown, it never will. Spoiled bags are worthless: send them home to be disposed of,
and order more.</p>`,
});

// ================================================================================================
// Materials exposure panel (exterior)
// ================================================================================================

defineItem('exptray', {
  radius: 0.15,
  build(item) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.03), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.6 }));
    g.add(base);
    const colors = [0xc0a060, 0x303030, 0xd0d0d0, 0x8a3020, 0x2050a0, 0xe0e0c0, 0x406030, 0xa0a0a0, 0x604080];
    for (let i = 0; i < 9; i++) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.08), new THREE.MeshStandardMaterial({ color: item.data.spoiled ? 0x3a3a3a : colors[i] }));
      c.position.set(((i % 3) - 1) * 0.1, (Math.floor(i / 3) - 1) * 0.1, 0.016);
      g.add(c);
    }
    return g;
  },
  label: (item) => `Sample tray (${item.data.nights ? `exposed ${item.data.nights} night${item.data.nights === 1 ? '' : 's'}` : 'unexposed'})`,
});

export class ExposurePanel extends Experiment {
  type = 'exposure';
  title = 'EXPOSURE PANEL';
  color = 0xd8d8d0;
  exterior = true;
  needsPower = false;
  runsNeeded = 3;
  points = 25;
  lidOpen = false;
  tray: Item | null = null;
  lid = new THREE.Group();
  trayMesh = new THREE.Group();

  exteriorRule(m: Module, d: Dir) {
    void m;
    return d === 2 ? null : 'it must face away from the Earth (mount it on top of a module)';
  }

  build() {
    const well = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.1), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    well.position.set(0, 0.1, 0.06);
    this.group.add(well);
    const coupon = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0xb0a080, metalness: 0.4 }));
    coupon.position.set(0, 0.1, 0.12);
    this.trayMesh.add(coupon);
    this.group.add(this.trayMesh);
    const lidPlate = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.86, 0.03), new THREE.MeshStandardMaterial({ color: 0xe8e8e0, metalness: 0.3 }));
    lidPlate.position.set(0, -0.43, 0);
    this.lid.add(lidPlate);
    this.lid.position.set(0, 0.53, 0.14);
    this.group.add(this.lid);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.015, 6, 12, Math.PI), new THREE.MeshStandardMaterial({ color: 0xf2c200 }));
    handle.position.set(0, -0.8, 0.03);
    this.lid.add(handle);
    setInteract(lidPlate, {
      label: () => (this.lidOpen ? 'Close the lid' : 'Open the lid'),
      use: () => {
        this.lidOpen = !this.lidOpen;
        G.audio?.clunk();
        this.sync();
      },
    });
    slot(this.group, 0, -0.6, 0.5, 0.2, 'SAMPLE TRAY',
      (item) => (item.kind === 'exptray' && !this.tray ? 'Fit the sample tray' : null),
      (item) => {
        G.items.takeFromHands();
        G.items.stow(item);
        this.tray = item;
        G.audio?.click();
        this.sync();
      },
      {
        label: () => (this.tray ? 'Remove the sample tray' : null),
        use: () => this.removeTray(),
      });
    text(this.group, 'MOUNT FACING ZENITH', 0, -0.9, 0.8, 0.07, '#8a1a10');
    this.sync();
  }

  removeTray() {
    if (!this.tray) return;
    if (G.items.held) {
      G.ui.toast('Your hands are full');
      return;
    }
    const t = this.tray;
    this.tray = null;
    const n = t.data.nights ?? 0;
    if (this.lidOpen && n > 0) t.data.spoiled = 'contaminated (removed with the lid open)';
    else if (n > 3) t.data.spoiled = 'overexposed';
    if (t.data.spoiled) t.data.report = null;
    else if (n >= 2) t.data.report = this.completeRun(`Materials exposure (${n} nights)`);
    else if (n > 0) t.data.report = null;
    G.items.rebuildMesh(t);
    G.items.unstowToHands(t);
    this.sync();
  }

  sync() {
    this.lid.rotation.x = this.lidOpen ? -Math.PI * 0.9 : 0;
    this.trayMesh.visible = !!this.tray;
  }

  onSleep() {
    if (this.tray && this.lidOpen && this.mount) this.tray.data.nights = (this.tray.data.nights ?? 0) + 1;
  }

  serialize() {
    return { ...super.serialize(), lidOpen: this.lidOpen, tray: this.tray };
  }
  deserialize(d: Record<string, any>) {
    super.deserialize(d);
    this.lidOpen = d.lidOpen ?? false;
    this.tray = d.tray ?? null;
    this.sync();
  }
}
registerRack('exposure', () => new ExposurePanel());

registerDoc('proc-exposure', {
  title: 'Procedure: materials exposure',
  cover: 'PROCEDURE ME-6 Materials Exposure',
  html: `
<h1>PROCEDURE ME-6</h1>
<div class="meta">Materials exposure panel &middot; mounted outside &middot; samples returned to the ground</div>
<p>Paints, plastics and fabrics age quickly in open space. This panel holds a tray of material samples out in
the raw sunlight and vacuum for a few days, then the tray comes home for analysis. Each well-exposed tray is worth
<b>25 points</b> when it reaches us. We would like <b>three</b>.</p>
<h2>Installing</h2>
<p>The panel is mounted on the outside of the station during a spacewalk. It must face <b>away from the Earth</b>,
so mount it on the <b>top</b> of a module, on a wall with nothing beyond it.</p>
<h2>Exposing a tray</h2>
<ol>
<li>Fit a sample tray (you can do this inside the station first, or outside).</li>
<li>Open the lid. The samples are exposed only while the lid is open.</li>
<li>Leave it for <b>two or three nights</b>. Each night with the lid open counts.</li>
<li>On a spacewalk, <b>close the lid first</b>, then remove the tray and bring it inside.</li>
<li>Send the tray home in the cargo vehicle.</li>
</ol>
<h2>Spoiled trays</h2>
<p>A tray removed with the lid still open is contaminated. More than three nights of exposure destroys the
samples. Either way the tray is worthless &mdash; send it home anyway, and order replacement trays.
A tray exposed for fewer than two nights tells us nothing.</p>`,
});

// ================================================================================================
// Combustion chamber (can be destroyed)
// ================================================================================================

defineItem('fuel', {
  radius: 0.08,
  build() {
    const g = new THREE.Group();
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 12), new THREE.MeshStandardMaterial({ color: 0xcc4422, metalness: 0.3 }));
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 8), new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.8 }));
    t.position.y = 0.095;
    g.add(c, t);
    return g;
  },
});

export class CombustionRack extends Experiment {
  type = 'combustion';
  title = 'COMBUSTION CHAMBER';
  color = 0xc8c0b0;
  runsNeeded = 4;
  points = 14;
  fuel = false;
  lidClosed = false;
  o2 = 0;
  purge = 0;
  flame = 0;
  photographed = false;
  flameMesh!: THREE.Mesh;
  soot!: THREE.Mesh;
  ready!: ReturnType<typeof lamp>;
  fault!: ReturnType<typeof lamp>;
  lidSwitch!: { sync(): void };

  build() {
    chamber(this.group, -0.4, 0.25, 0.8, 0.8, 0x111418);
    this.flameMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 14), new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.75 }));
    this.flameMesh.position.set(-0.4, 0.25, 0.2);
    this.group.add(this.flameMesh);
    this.soot = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ color: 0x0a0806, transparent: true, opacity: 0.92 }));
    this.soot.position.set(-0.4, 0.25, 0.32);
    this.soot.userData.solid = false;
    this.group.add(this.soot);
    this.lidSwitch = toggle(this.group, 0.3, 0.6, 'LID LOCK', () => this.lidClosed, (v) => (this.lidClosed = v));
    dial(this.group, 0.72, 0.58, 'O2 %', 5, () => this.o2, (v) => (this.o2 = v), ['15', '19', '21', '25', '30']);
    this.ready = lamp(this.group, 0.3, 0.2, 0x33ff66, 'PURGED');
    this.fault = lamp(this.group, 0.72, 0.2, 0xff3322, 'FAULT');
    button(this.group, 0.3, -0.1, 'PURGE', 0x777777, () => this.doPurge());
    button(this.group, 0.72, -0.1, 'IGNITE', 0xdd2211, () => this.ignite());
    button(this.group, 0.3, -0.5, 'SHUTTER', 0x333333, () => this.photo());
    filmPort(this, 0.72, -0.5);
    slot(this.group, -0.4, -0.45, 0.3, 0.16, 'FUEL',
      (item) => (item.kind === 'fuel' && !this.fuel && !this.broken ? 'Load the fuel cartridge' : null),
      (item) => {
        G.items.takeFromHands();
        G.items.remove(item);
        this.fuel = true;
        G.audio?.click();
      });
    text(this.group, 'MODEL CC-3 · 28V', -0.55, -0.95, 0.6, 0.06, '#333');
  }

  doPurge() {
    if (!this.powered || this.broken) return;
    if (!this.lidClosed) {
      G.audio?.beep(220, 0.2);
      return;
    }
    this.purge = 10;
    G.audio?.hiss(3);
  }

  ignite() {
    if (!this.powered || this.broken || !this.fuel) {
      G.audio?.click();
      return;
    }
    if (!this.lidClosed) {
      // the chamber is open to the cabin: a flash fire scorches the rack
      this.broken = true;
      this.fuel = false;
      G.audio?.bump(4);
      G.audio?.hiss(2);
      G.ui.toast('A sheet of flame bursts out of the open chamber and dies. The chamber is blackened and ruined.', 6000);
      return;
    }
    if (this.purge > 0 || !this.purged) {
      G.audio?.click();
      return;
    }
    this.fuel = false;
    this.purged = false;
    this.photographed = false;
    this.flame = this.o2 >= 3 ? 1.2 : 10;
    this.flareUp = this.o2 >= 3;
    G.audio?.bump(1);
  }

  purged = false;
  flareUp = false;

  photo() {
    if (!this.powered || this.broken) return;
    G.audio?.click();
    if (this.flame <= 0) return;
    const valid = !this.flareUp && !this.photographed && this.o2 <= 1;
    this.photographed = true;
    ejectFilm(this, 'Film: flame photograph', valid ? this.completeRun('Combustion') : null, new THREE.Vector3(0.72, -0.5, 0.15));
  }

  update(dt: number) {
    if (this.purge > 0) {
      this.purge -= dt;
      if (this.purge <= 0) this.purged = true;
    }
    if (!this.lidClosed) this.purged = false;
    this.flame = Math.max(0, this.flame - dt);
    const f = this.flame > 0;
    this.flameMesh.visible = f;
    if (f) {
      const s = this.flareUp ? 2.2 + Math.random() * 0.5 : 1 + Math.sin(G.time * 13) * 0.05;
      this.flameMesh.scale.setScalar(s);
      (this.flameMesh.material as THREE.MeshBasicMaterial).color.setHex(this.flareUp ? 0xffaa33 : 0x4488ff);
    }
    this.soot.visible = this.broken;
    this.ready.set(this.powered && this.purged && !this.broken);
    this.fault.set(this.powered && this.broken);
  }

  serialize() {
    return { ...super.serialize(), fuel: this.fuel, lidClosed: this.lidClosed, o2: this.o2 };
  }
  deserialize(d: Record<string, any>) {
    super.deserialize(d);
    Object.assign(this, { fuel: d.fuel ?? false, lidClosed: d.lidClosed ?? false, o2: d.o2 ?? 0 });
    this.lidSwitch?.sync();
  }
}
registerRack('combustion', () => new CombustionRack());

registerDoc('proc-combustion', {
  title: 'Procedure: combustion',
  cover: 'PROCEDURE CC-3 Combustion Chamber',
  html: `
<h1>PROCEDURE CC-3</h1>
<div class="meta">Flame spreading in weightlessness</div>
<p>Without gravity there is no rising hot air, and a flame becomes a slow blue ball. Each good photograph of one
is worth <b>14 points</b>; we would like <b>four</b>.</p>
<h2 style="color:#a3261f">Warning</h2>
<p><b>Never ignite with the chamber lid unlocked.</b> The flame will escape into the rack and destroy it. A destroyed
rack cannot be repaired aboard: unbolt it, send it home in the cargo vehicle, and order a new one.</p>
<h2>Procedure</h2>
<ol>
<li>Load a fuel cartridge into the FUEL port.</li>
<li>Flip <b>LID LOCK</b> on.</li>
<li>Set <b>O2 %</b> to <b>15</b> or <b>19</b>. Richer atmospheres make a violent flare instead of a flame.</li>
<li>Press <b>PURGE</b> and wait for the <b>PURGED</b> lamp.</li>
<li>Press <b>IGNITE</b>. The flame burns for about ten seconds.</li>
<li>While it burns, press <b>SHUTTER</b> once. The film canister comes out of the FILM port.</li>
</ol>
<p class="note">Each cartridge burns once. Unlocking the lid clears the purge. Only photographs of a calm blue flame
at 15 or 19 percent oxygen are useful.</p>`,
});
