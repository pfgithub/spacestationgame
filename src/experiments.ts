import * as THREE from 'three';
import { G } from './game';
import { Rack, registerRack } from './racks';
import { button, dial, gauge, lamp, text, toggle } from './controls';
import { registerDoc } from './docs';
import { setInteract } from './interact';

const glassMat = new THREE.MeshStandardMaterial({ color: 0xaaccee, transparent: true, opacity: 0.22, roughness: 0.05, depthWrite: false });

function chamber(parent: THREE.Object3D, x: number, y: number, w: number, h: number, inner = 0x1a1d22) {
  const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), new THREE.MeshStandardMaterial({ color: inner, roughness: 0.8 }));
  back.position.set(x, y, 0.04);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.26), glassMat);
  glass.position.set(x, y, 0.18);
  glass.userData.solid = false;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, h + 0.06, 0.02), new THREE.MeshStandardMaterial({ color: 0x55595f, metalness: 0.6, roughness: 0.4 }));
  frame.position.set(x, y, 0.03);
  parent.add(frame, back, glass);
  return { back, glass };
}

/** Shared pieces for experiment racks: run counting, completion stamp, power dependence. */
export abstract class Experiment extends Rack {
  needsPower = true;
  abstract runsNeeded: number;
  abstract points: number;
  runs = 0;
  stamp?: THREE.Object3D;

  get complete() {
    return this.runs >= this.runsNeeded;
  }

  finishRun() {
    this.runs++;
    G.science.progress[this.type] = this.runs;
    if (this.complete) {
      G.science.completed.add(this.type);
      this.showStamp();
    }
    return this.runs;
  }

  showStamp() {
    if (this.stamp || !this.complete) return;
    this.stamp = text(this.group, 'EXPERIMENT COMPLETE', 0, RACK_STAMP_Y, 1.6, 0.14, '#b01c10', '#f3eee0');
    this.stamp.position.z = 0.4;
    this.stamp.rotation.z = 0.05;
  }

  serialize(): Record<string, any> {
    return { runs: this.runs };
  }
  deserialize(d: Record<string, any>) {
    this.runs = d.runs ?? 0;
    this.showStamp();
  }
}
const RACK_STAMP_Y = 0.78;

// ------------------------------------------------------------------------------------------------
// Protein crystal growth
// ------------------------------------------------------------------------------------------------

export class CrystalRack extends Experiment {
  type = 'crystal';
  title = 'CRYSTAL FURNACE';
  color = 0xb9c6cf;
  runsNeeded = 5;
  points = 10;
  heater = false;
  dialPos = 0;
  temp = 0;
  phase: 'empty' | 'seeded' | 'grown' = 'empty';
  growth = 0;
  fault = false;
  crystal = new THREE.Group();
  glow!: THREE.Mesh;
  g!: ReturnType<typeof gauge>;
  ready!: ReturnType<typeof lamp>;
  faultLamp!: ReturnType<typeof lamp>;

  build() {
    const c = chamber(this.group, -0.45, 0.3, 0.8, 0.65, 0x2a1a12);
    this.glow = c.back;
    const cm = new THREE.MeshStandardMaterial({ color: 0x9fe0ff, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85, emissive: 0x113344 });
    for (let i = 0; i < 6; i++) {
      const o = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), cm);
      o.position.set((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.1, 0);
      o.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      this.crystal.add(o);
    }
    this.crystal.position.set(-0.45, 0.25, 0.18);
    this.crystal.scale.setScalar(0.001);
    this.group.add(this.crystal);
    this.g = gauge(this.group, 0.5, 0.45, 'TEMP');
    this.ready = lamp(this.group, 0.3, 0.05, 0x33ff66, 'READY');
    this.faultLamp = lamp(this.group, 0.7, 0.05, 0xff3322, 'FAULT');
    toggle(this.group, -0.7, -0.4, 'HEATER', () => this.heater, (v) => (this.heater = v));
    dial(this.group, -0.2, -0.4, 'TEMP SET', 5, () => this.dialPos, (v) => (this.dialPos = v));
    button(this.group, 0.3, -0.4, 'SEED', 0x3377dd, () => this.seed());
    button(this.group, 0.75, -0.4, 'PRINT', 0x333333, () => this.print());
    const slotM = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.05), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    slotM.position.set(0.55, -0.75, 0.05);
    this.group.add(slotM);
    text(this.group, 'MODEL CF-2  ·  28V', -0.55, -0.95, 0.7, 0.06, '#333');
  }

  get setting() {
    return this.dialPos + 1;
  }

  get isReady() {
    return this.heater && this.powered && Math.abs(this.temp - this.setting) < 0.1;
  }

  seed() {
    if (!this.powered || this.complete) return;
    if (this.fault || this.phase !== 'empty' || !this.isReady) {
      G.audio?.beep(220, 0.2);
      return;
    }
    if (this.setting === 4) {
      this.phase = 'seeded';
      this.growth = 0;
      G.audio?.beep(660, 0.1);
    } else {
      this.fault = true;
      G.audio?.beep(220, 0.4);
    }
  }

  print() {
    if (!this.powered) return;
    if (this.phase === 'empty') {
      G.audio?.beep(220, 0.15);
      return;
    }
    const pos = new THREE.Vector3(0.55, -0.8, 0.12);
    if (this.phase === 'grown') {
      const run = this.finishRun();
      G.science.printSlip(this, pos, 'CRYSTAL FURNACE RESULT', [
        `SAMPLE ........ LYSOZYME`,
        `NUCLEATION .... 4`,
        `GROWTH ........ 2`,
        `SIZE .......... ${(0.8 + Math.random() * 0.3).toFixed(2)} MM`,
        `QUALITY ....... GOOD`,
      ], { exp: this.type, expTitle: 'Crystal growth', run, points: this.points });
    } else {
      G.science.printSlip(this, pos, 'CRYSTAL FURNACE RESULT', [
        `SAMPLE ........ LYSOZYME`,
        `SIZE .......... ${(this.growth / 200).toFixed(2)} MM`,
        `QUALITY ....... INSUFFICIENT`,
      ], null);
    }
    this.phase = 'empty';
    this.growth = 0;
  }

  update(dt: number) {
    const target = this.heater && this.powered ? this.setting : 0;
    this.temp += Math.sign(target - this.temp) * Math.min(Math.abs(target - this.temp), dt * 0.3);
    if (this.phase === 'seeded') {
      if (this.temp > 3.2 && this.growth > 0) {
        this.phase = 'empty';
        this.fault = true;
      } else if (this.isReady && this.setting === 2) {
        this.growth += dt;
        if (this.growth >= 60) this.phase = 'grown';
      }
    }
    if (this.fault && this.temp < 0.2) this.fault = false;
    const p = this.powered;
    this.g.set(p ? this.temp / 5 : 0);
    this.g.update(dt);
    this.ready.set(p && this.isReady);
    this.faultLamp.set(p && this.fault);
    const s = this.phase === 'empty' ? 0.001 : 0.25 + 0.75 * Math.min(1, this.growth / 60);
    this.crystal.scale.setScalar(s);
    this.crystal.rotation.y += dt * 0.2;
    (this.glow.material as THREE.MeshStandardMaterial).emissive.setRGB(this.temp / 5 * 0.8, this.temp / 5 * 0.25, 0);
  }

  serialize() {
    return { ...super.serialize(), heater: this.heater, dialPos: this.dialPos, temp: this.temp, phase: this.phase, growth: this.growth, fault: this.fault };
  }
  deserialize(d: Record<string, any>) {
    super.deserialize(d);
    Object.assign(this, { heater: d.heater, dialPos: d.dialPos, temp: d.temp, phase: d.phase, growth: d.growth, fault: d.fault });
  }
}
registerRack('crystal', () => new CrystalRack());

// ------------------------------------------------------------------------------------------------
// Plant growth
// ------------------------------------------------------------------------------------------------

export class BotanyRack extends Experiment {
  type = 'botany';
  title = 'PLANT HABITAT';
  color = 0xbcd0b5;
  runsNeeded = 6;
  points = 8;
  lampOn = false;
  moisture = 1;
  lampTime = 0;
  measuredToday = false;
  litAtNight = false;
  stage = 0;
  plant = new THREE.Group();
  growLight!: THREE.Mesh;
  g!: ReturnType<typeof gauge>;
  leaves: THREE.Mesh[] = [];

  build() {
    chamber(this.group, -0.4, 0.15, 1.0, 1.2, 0x2b2620);
    this.growLight = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.2), new THREE.MeshStandardMaterial({ color: 0x444444, emissive: 0xff66cc, emissiveIntensity: 0 }));
    this.growLight.position.set(-0.4, 0.7, 0.2);
    this.group.add(this.growLight);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.18, 16), new THREE.MeshStandardMaterial({ color: 0x9a5a3a }));
    pot.position.set(-0.4, -0.35, 0.2);
    this.group.add(pot);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x4f9a3a, side: THREE.DoubleSide });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 1, 6), leafMat);
    stem.geometry.translate(0, 0.5, 0);
    this.plant.add(stem);
    for (let i = 0; i < 8; i++) {
      const leaf = new THREE.Mesh(new THREE.CircleGeometry(0.06, 8), leafMat);
      leaf.scale.set(1, 0.5, 1);
      leaf.position.set(i % 2 ? 0.06 : -0.06, (i + 1) / 9, 0);
      leaf.rotation.set(0.4, i % 2 ? 0.6 : -0.6, 0);
      this.plant.add(leaf);
      this.leaves.push(leaf);
    }
    this.plant.position.set(-0.4, -0.26, 0.2);
    this.group.add(this.plant);
    toggle(this.group, 0.55, 0.55, 'GROW LAMP', () => this.lampOn, (v) => (this.lampOn = v));
    this.g = gauge(this.group, 0.55, 0.12, 'MOISTURE');
    // green band on the moisture gauge between 2 and 4
    const band = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.085, 16, 1, Math.PI / 2 - 0.12 - Math.PI * 0.36, Math.PI * 0.48), new THREE.MeshBasicMaterial({ color: 0x33aa44 }));
    band.position.set(0.55, 0.12, 0.056);
    band.rotation.z = 0;
    this.group.add(band);
    button(this.group, 0.35, -0.35, 'WATER', 0x3388ff, () => this.water());
    button(this.group, 0.75, -0.35, 'MEASURE', 0x333333, () => this.measure());
    text(this.group, 'MODEL PH-1  ·  28V', -0.55, -0.95, 0.7, 0.06, '#333');
    this.syncPlant();
  }

  water() {
    if (this.complete) return;
    this.moisture = Math.min(5, this.moisture + 2);
    G.audio?.hiss(0.6);
  }

  measure() {
    if (!this.powered) return;
    if (this.measuredToday) {
      G.audio?.beep(220, 0.2);
      return;
    }
    this.measuredToday = true;
    const pos = new THREE.Vector3(0.55, -0.7, 0.12);
    const healthy = this.moisture >= 2 && this.moisture <= 4 && this.lampTime >= 60 && !this.litAtNight && !this.complete;
    if (healthy) {
      this.stage++;
      const run = this.finishRun();
      G.science.printSlip(this, pos, 'PLANT HABITAT READING', [
        `SPECIMEN ...... ARABIDOPSIS`,
        `HEIGHT ........ ${(this.stage * 2.1 + Math.random()).toFixed(1)} CM`,
        `LEAVES ........ ${this.stage + 2}`,
        `MOISTURE ...... ${this.moisture.toFixed(1)}`,
        `CONDITION ..... HEALTHY`,
      ], { exp: this.type, expTitle: 'Plant growth', run, points: this.points });
    } else {
      G.science.printSlip(this, pos, 'PLANT HABITAT READING', [
        `SPECIMEN ...... ARABIDOPSIS`,
        `HEIGHT ........ ${(this.stage * 2.1).toFixed(1)} CM`,
        `MOISTURE ...... ${this.moisture.toFixed(1)}`,
        `CONDITION ..... ${this.moisture > 4 ? 'WATERLOGGED' : this.moisture < 2 ? 'WILTING' : this.litAtNight ? 'STRESSED (NO DARK PERIOD)' : 'NO GROWTH'}`,
      ], null);
    }
    this.syncPlant();
  }

  syncPlant() {
    const s = 0.08 + this.stage * 0.1;
    this.plant.scale.set(1, s, 1);
    this.leaves.forEach((l, i) => (l.visible = i < this.stage + 2));
    for (const l of this.leaves) l.scale.set(1 / 1, 0.5 / s * 0.12, 1);
  }

  update(dt: number) {
    const lit = this.lampOn && this.powered;
    if (lit) this.lampTime += dt;
    (this.growLight.material as THREE.MeshStandardMaterial).emissiveIntensity = lit ? 1.5 : 0;
    this.g.set(this.powered ? this.moisture / 5 : 0);
    this.g.update(dt);
  }

  onSleep() {
    this.litAtNight = this.lampOn && this.powered;
    this.moisture = Math.max(0, this.moisture - 2);
    this.lampTime = 0;
    this.measuredToday = false;
  }

  serialize() {
    return { ...super.serialize(), lampOn: this.lampOn, moisture: this.moisture, lampTime: this.lampTime, measuredToday: this.measuredToday, litAtNight: this.litAtNight, stage: this.stage };
  }
  deserialize(d: Record<string, any>) {
    super.deserialize(d);
    Object.assign(this, { lampOn: d.lampOn, moisture: d.moisture, lampTime: d.lampTime, measuredToday: d.measuredToday, litAtNight: d.litAtNight, stage: d.stage });
    if (this.leaves.length) this.syncPlant();
  }
}
registerRack('botany', () => new BotanyRack());

// ------------------------------------------------------------------------------------------------
// Fluid physics
// ------------------------------------------------------------------------------------------------

export class FluidRack extends Experiment {
  type = 'fluid';
  title = 'FLUID PHYSICS';
  color = 0xc9c0d8;
  runsNeeded = 4;
  points = 12;
  valveA = false;
  valveB = false;
  level = 0;
  shakes = 0;
  unsettled = 0;
  contaminated = false;
  photographed = false;
  blob!: THREE.Mesh;
  bubbles = new THREE.Group();
  g!: ReturnType<typeof gauge>;
  settled!: ReturnType<typeof lamp>;
  faultLamp!: ReturnType<typeof lamp>;

  build() {
    chamber(this.group, -0.45, 0.25, 0.85, 0.85, 0x101820);
    this.blob = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), new THREE.MeshStandardMaterial({ color: 0x3a8fd0, transparent: true, opacity: 0.75, roughness: 0.05, metalness: 0.1 }));
    this.blob.position.set(-0.45, 0.25, 0.2);
    this.group.add(this.blob);
    const bm = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
    for (let i = 0; i < 12; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.015 + Math.random() * 0.02, 8, 6), bm);
      b.userData.phase = Math.random() * 10;
      this.bubbles.add(b);
    }
    this.bubbles.position.copy(this.blob.position);
    this.group.add(this.bubbles);
    toggle(this.group, 0.3, 0.6, 'VALVE A', () => this.valveA, (v) => (this.valveA = v));
    toggle(this.group, 0.75, 0.6, 'VALVE B', () => this.valveB, (v) => (this.valveB = v));
    this.g = gauge(this.group, 0.52, 0.2, 'LEVEL');
    this.settled = lamp(this.group, 0.3, -0.15, 0x33ff66, 'STILL');
    this.faultLamp = lamp(this.group, 0.75, -0.15, 0xffaa22, 'CHECK');
    button(this.group, -0.7, -0.5, 'AGITATE', 0xdd7722, () => this.shake());
    button(this.group, -0.2, -0.5, 'SHUTTER', 0x333333, () => this.photo());
    const port = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 16), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    port.rotation.x = Math.PI / 2;
    port.position.set(0.55, -0.55, 0.06);
    this.group.add(port);
    text(this.group, 'FILM', 0.55, -0.68, 0.2, 0.05);
    text(this.group, 'MODEL FP-3  ·  28V', -0.55, -0.95, 0.7, 0.06, '#333');
  }

  get isStill() {
    return this.level >= 0.95 && this.level <= 1.05 && this.unsettled <= 0 && !this.valveA && !this.valveB;
  }

  shake() {
    if (!this.powered) return;
    if (this.level < 0.1) {
      G.audio?.beep(220, 0.2);
      return;
    }
    this.shakes++;
    this.unsettled = 12;
    G.audio?.bump(1.5);
  }

  photo() {
    if (!this.powered) return;
    G.audio?.click();
    if (this.level < 0.1) {
      G.ui.toast('*click*');
      return;
    }
    const valid = this.isStill && this.shakes === 3 && !this.contaminated && !this.photographed && !this.complete;
    const film = G.items.create('film', valid ? `Film: fluid run ${this.runs + 1}` : 'Film: fluid physics', {
      caption: valid ? `fluid run ${this.runs + 1}` : 'fluid physics',
    });
    film.data.report = null;
    if (valid) {
      const run = this.finishRun();
      film.data.report = { exp: this.type, expTitle: 'Fluid physics', run, points: this.points };
    }
    this.photographed = true;
    const world = new THREE.Vector3(0.55, -0.55, 0.15).applyMatrix4(this.group.matrixWorld);
    G.items.place(film, world, new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion).multiplyScalar(0.3));
  }

  update(dt: number) {
    const p = this.powered;
    if (p && this.valveA) this.level += dt * 0.1;
    if (p && this.valveB) this.level -= dt * 0.15;
    this.level = Math.max(0, Math.min(1.25, this.level));
    if (this.level > 1.1) this.contaminated = true;
    if (this.level <= 0) {
      this.contaminated = false;
      this.photographed = false;
      this.shakes = 0;
    }
    this.unsettled -= dt;
    this.g.set(p ? this.level / 1.25 : 0);
    this.g.update(dt);
    this.settled.set(p && this.isStill);
    this.faultLamp.set(p && this.contaminated);
    const s = Math.cbrt(this.level) + 0.0001;
    const wob = Math.max(0, this.unsettled) / 12;
    const t = G.time;
    this.blob.scale.set(s * (1 + Math.sin(t * 9) * 0.15 * wob), s * (1 + Math.cos(t * 7) * 0.15 * wob), s);
    this.blob.visible = this.level > 0.01;
    this.bubbles.children.forEach((b, i) => {
      const ph = b.userData.phase + t * (0.5 + wob * 3);
      b.visible = this.level > 0.2 && (wob > 0 || i < 3);
      b.position.set(Math.sin(ph) * 0.18 * s, Math.cos(ph * 1.3) * 0.18 * s, Math.sin(ph * 0.7) * 0.1);
    });
    if (this.contaminated) (this.blob.material as THREE.MeshStandardMaterial).color.setHex(0x7a8a5a);
    else (this.blob.material as THREE.MeshStandardMaterial).color.setHex(0x3a8fd0);
  }

  serialize() {
    return { ...super.serialize(), valveA: this.valveA, valveB: this.valveB, level: this.level, shakes: this.shakes, contaminated: this.contaminated, photographed: this.photographed };
  }
  deserialize(d: Record<string, any>) {
    super.deserialize(d);
    Object.assign(this, { valveA: d.valveA, valveB: d.valveB, level: d.level, shakes: d.shakes, contaminated: d.contaminated, photographed: d.photographed });
  }
}
registerRack('fluid', () => new FluidRack());

export { setInteract };

// ------------------------------------------------------------------------------------------------
// Procedures
// ------------------------------------------------------------------------------------------------

registerDoc('proc-crystal', {
  title: 'Procedure: Crystal Furnace',
  cover: 'PROCEDURE CF-2 Crystal Furnace',
  html: `
<h1>PROCEDURE CF-2</h1>
<div class="meta">Protein Crystal Growth Furnace &middot; Lysozyme series</div>
<p>Protein crystals grown in weightlessness are larger and more orderly than any grown on the ground.
Each run grows one crystal and is worth <b>10 points</b>. The series calls for <b>five</b> runs.</p>
<h2>Preparation</h2>
<p>The furnace is loaded with enough sample solution for the full series. The rack requires main bus power.</p>
<h2>Procedure</h2>
<ol>
<li>Switch the <b>HEATER</b> on.</li>
<li>Set <b>TEMP SET</b> to the <b>nucleation temperature, 4</b>.</li>
<li>Wait for the chamber to reach temperature. The <b>READY</b> lamp lights when it has.</li>
<li>Press <b>SEED</b> to inject a seed into the solution.</li>
<li>Promptly lower <b>TEMP SET</b> to the <b>growth temperature, 2</b>.</li>
<li>Wait for <b>READY</b> again. The crystal grows only while the chamber is steady at the growth temperature.
Allow at least <b>one full minute</b> of steady growth.</li>
<li>Press <b>PRINT</b>. The furnace prints a result slip and flushes the chamber, ready for the next run.</li>
</ol>
<h2>Notes</h2>
<ul>
<li>Seeding at any temperature other than 4 spoils the solution. So does letting a growing crystal get above 3.</li>
<li>If the <b>FAULT</b> lamp is lit, switch the heater off and let the chamber cool completely. The fault clears itself.</li>
<li>Printing before the crystal has finished growing ends the run with no usable result.</li>
<li>Return the printed slips to the ground. Slips marked INSUFFICIENT are worthless.</li>
</ul>`,
});

registerDoc('proc-botany', {
  title: 'Procedure: Plant Habitat',
  cover: 'PROCEDURE PH-1 Plant Habitat',
  html: `
<h1>PROCEDURE PH-1</h1>
<div class="meta">Plant Habitat &middot; Arabidopsis growth study</div>
<p>This study follows one plant through six days of growth. Each day's successful reading is worth
<b>8 points</b>. The study calls for <b>six</b> readings.</p>
<h2>Daily routine</h2>
<ol>
<li>After waking, check the <b>MOISTURE</b> gauge. Press <b>WATER</b> to bring the needle into the green
band (between 2 and 4). Each press adds about 2. The soil dries by about 2 overnight.</li>
<li>Keep the <b>GROW LAMP</b> on during the day. The plant needs at least a minute of light before it is measured.</li>
<li>Press <b>MEASURE</b> once per day. The habitat prints a reading slip.</li>
<li>Before going to sleep, switch the <b>GROW LAMP</b> off. Arabidopsis needs a dark period; a plant kept lit
all night will be stressed and will not grow the next day.</li>
</ol>
<h2>Notes</h2>
<ul>
<li>Too much water is as bad as too little. There is no way to remove water; wait for the soil to dry.</li>
<li>Only one reading can be taken per day.</li>
<li>Readings that do not say HEALTHY are worthless; you need not send them.</li>
<li>The lamp requires main bus power.</li>
</ul>`,
});

registerDoc('proc-fluid', {
  title: 'Procedure: Fluid Physics',
  cover: 'PROCEDURE FP-3 Fluid Physics',
  html: `
<h1>PROCEDURE FP-3</h1>
<div class="meta">Fluid Physics Rack &middot; Bubble migration photography</div>
<p>In weightlessness, bubbles in a liquid do not rise. This experiment photographs how they arrange themselves
after being disturbed. Each good photograph is worth <b>12 points</b>. The series calls for <b>four</b>.</p>
<h2>Procedure</h2>
<ol>
<li>Open <b>VALVE A</b> to fill the test cell. Watch the <b>LEVEL</b> gauge.</li>
<li>Close <b>VALVE A</b> when the needle reaches 4 (full). Do not overfill.</li>
<li>Press <b>AGITATE</b> exactly <b>three</b> times.</li>
<li>Wait for the liquid to come to rest. The <b>STILL</b> lamp lights when the cell is full, both valves are
closed and the liquid is quiet.</li>
<li>Press <b>SHUTTER</b>. A film canister is ejected from the FILM port.</li>
<li>Open <b>VALVE B</b> to empty the cell completely, then close it. The rack is ready for the next run.</li>
</ol>
<h2>Notes</h2>
<ul>
<li>One photograph per filling. A second exposure of the same filling is worthless.</li>
<li>Agitating more or fewer than three times ruins the photograph, though you will not know until it is developed.</li>
<li>If the cell is overfilled the <b>CHECK</b> lamp lights: the liquid is contaminated. Empty the cell completely
and start again.</li>
<li>Send exposed film canisters to the ground unopened.</li>
</ul>`,
});
