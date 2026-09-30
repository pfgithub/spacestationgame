import * as THREE from 'three';
import { Dir, HALF_IN, cellCenter, faceQuat, faceVec } from './constants';
import { G } from './game';
import { Rack, registerRack } from './racks';
import { button, gauge, lamp, slot, text } from './controls';
import { defineItem, Item } from './items';
import { setInteract } from './interact';
import { registerDoc } from './docs';
import { CIRCUITS, Circuit } from './power';
import type { Module } from './station';

interface Leak {
  cell: [number, number, number];
  dir: Dir;
  u: number;
  v: number;
  mesh: THREE.Object3D;
}

/** Cabin air: pressure in each module, CO2 scrubbing, leaks, and the faults that befall them. */
export class LifeSupport {
  co2 = 800;
  /** Remaining life of the scrubber cartridge, 0..1. */
  cartridge = 1;
  cartridgeIn = true;
  leak: Leak | null = null;
  silenced = false;
  alarmTimer = 0;
  hissTimer = 0;
  particles: THREE.Points;
  headacheWarned = false;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60 * 3), 3));
    this.particles = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.03, transparent: true, opacity: 0.7 }));
    this.particles.visible = false;
    this.particles.frustumCulled = false;
    G.scene.add(this.particles);
  }

  get headache() {
    return this.co2 > 4000;
  }

  lowPressure() {
    for (const m of G.station.modules.values()) if (m.type !== 'airlock' && m.pressure < 95) return true;
    return false;
  }

  get caution() {
    return this.lowPressure() || this.co2 > 3000;
  }

  /** Reasons the crew can't sleep. */
  sleepBlocker(): string | null {
    if (this.lowPressure() && !this.silenced) return 'The master alarm is sounding. You could never sleep through that.';
    if (this.leak) return 'You can hear a faint hiss somewhere. You are too uneasy to sleep.';
    if (this.headache) return 'Your head is pounding and the air feels stale. You can\'t sleep like this.';
    return null;
  }

  startLeak(spec?: { cell: [number, number, number]; dir: Dir; u: number; v: number }) {
    const candidates = [...G.station.modules.values()].filter((m) => m.type !== 'airlock' && m.type !== 'ship');
    const m = spec ? G.station.get(spec.cell)! : candidates[Math.floor(Math.random() * candidates.length)];
    const walls = ([0, 1, 2, 3, 4, 5] as Dir[]).filter((d) => m.faces[d] === 'wall');
    const dir = spec?.dir ?? walls[Math.floor(Math.random() * walls.length)];
    // somewhere near the edge of the wall, so it isn't hidden behind a rack
    const u = spec?.u ?? (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 0.25);
    const v = spec?.v ?? (Math.random() - 0.5) * 2.4;
    const mesh = new THREE.Group();
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.03, 10), new THREE.MeshBasicMaterial({ color: 0x050505 }));
    const frost = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.12, 16), new THREE.MeshBasicMaterial({ color: 0xe8f4ff, transparent: true, opacity: 0.6 }));
    frost.position.z = -0.001;
    mesh.add(hole, frost);
    mesh.position.copy(cellCenter(m.cell)).add(faceVec(dir, HALF_IN - 0.005, u, v));
    mesh.quaternion.copy(faceQuat(dir));
    setInteract(mesh, {
      label: () => 'A tiny hole, rimmed with frost',
      use: () => G.ui.toast('Air is whistling out through it. It needs a patch.'),
      acceptLabel: (item) => (item.kind === 'patch' ? 'Apply the patch' : null),
      accept: (item) => {
        G.items.takeFromHands();
        G.items.remove(item);
        this.fixLeak();
      },
    });
    G.station.group.add(mesh);
    mesh.updateMatrixWorld(true);
    this.leak = { cell: m.cell, dir, u, v, mesh };
  }

  fixLeak() {
    if (!this.leak) return;
    const { mesh } = this.leak;
    mesh.clear();
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.16), new THREE.MeshStandardMaterial({ color: 0xc89a20 }));
    mesh.add(patch);
    this.leak = null;
    this.particles.visible = false;
    G.ui.toast('The hissing stops.');
  }

  leakModule(): Module | undefined {
    return this.leak ? G.station.get(this.leak.cell) : undefined;
  }

  update(dt: number) {
    const st = G.station;
    // --- pressure: equalise through open hatches, make up from tanks, lose through a leak ---
    for (const door of st.doors.values()) {
      if (door.kind !== 'conn' || door.t < 0.5) continue;
      const a = st.get(door.cell);
      const b = st.get([door.cell[0] + [1, -1, 0, 0, 0, 0][door.dir], door.cell[1] + [0, 0, 1, -1, 0, 0][door.dir], door.cell[2] + [0, 0, 0, 0, 1, -1][door.dir]]);
      if (!a || !b) continue;
      const flow = (a.pressure - b.pressure) * Math.min(1, dt * 2);
      a.pressure -= flow / 2;
      b.pressure += flow / 2;
    }
    for (const m of st.modules.values()) {
      if (m.type === 'airlock') continue;
      if (m.pressure < 101) m.pressure = Math.min(101, m.pressure + dt * 0.04 * (1 + (101 - m.pressure) / 5));
    }
    const lm = this.leakModule();
    if (lm) {
      lm.pressure = Math.max(55, lm.pressure - dt * 1.2);
      this.updateLeakFx(dt);
    }
    // --- CO2 ---
    const scrubbing = this.cartridgeIn && this.cartridge > 0;
    this.co2 += dt * (scrubbing ? (800 - this.co2) * 0.05 : 25);
    this.co2 = Math.min(9000, this.co2);
    if (this.headache && !this.headacheWarned) {
      this.headacheWarned = true;
      G.ui.toast('You have a dull headache, and the air feels stuffy.', 4000);
    }
    if (!this.headache) this.headacheWarned = false;
    G.ui.vignette.classList.toggle('stale', this.headache);
    // --- master alarm ---
    if (this.caution && !this.silenced) {
      this.alarmTimer -= dt;
      if (this.alarmTimer <= 0) {
        this.alarmTimer = 1.2;
        G.audio?.beep(1250, 0.18);
        setTimeout(() => G.audio?.beep(940, 0.18), 220);
      }
    }
    if (!this.caution) this.silenced = false;
  }

  private updateLeakFx(dt: number) {
    const leak = this.leak!;
    const origin = leak.mesh.position;
    const inward = new THREE.Vector3(0, 0, 1).applyQuaternion(leak.mesh.quaternion);
    const attr = this.particles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < attr.count; i++) {
      const t = ((G.time * 0.8 + i / attr.count) % 1);
      // particles are drawn towards the hole
      const spread = (1 - t) * 0.5;
      const a = i * 2.39996;
      const side = new THREE.Vector3(Math.cos(a), Math.sin(a), 0).applyQuaternion(leak.mesh.quaternion);
      const p = origin.clone().addScaledVector(inward, (1 - t) * 0.6).addScaledVector(side, spread * 0.3);
      attr.setXYZ(i, p.x, p.y, p.z);
    }
    attr.needsUpdate = true;
    this.particles.visible = true;
    // the hiss gets louder as you get close
    this.hissTimer -= dt;
    const d = G.player.pos.distanceTo(origin);
    if (this.hissTimer <= 0 && d < 7) {
      this.hissTimer = 1.6;
      G.audio?.hissAt(1.8, Math.min(1, 1.2 / (0.5 + d)));
    }
  }

  // --------------------------------------------------------------------------------------------
  // Faults
  // --------------------------------------------------------------------------------------------

  /** Called each night: routine wear, and sometimes something goes wrong. */
  night() {
    if (this.cartridgeIn) this.cartridge = Math.max(0, this.cartridge - 0.25);
    const active = this.activeFaults();
    if (G.day < 3 || active.length >= 2) return;
    // the first fault arrives on day 3, afterwards it's a matter of luck
    if (G.day > 3 && Math.random() > 0.35) return;
    const options: (() => void)[] = [];
    if (!this.leak) options.push(() => this.startLeak());
    if (G.power.wings.every((w) => w > 0.9)) options.push(() => {
      const i = Math.floor(Math.random() * 2);
      G.power.wings[i] = 0.1 + Math.random() * 0.15;
    });
    const okFuses = CIRCUITS.filter((c) => G.power.fuses[c] === 'ok' && c !== 'AUX');
    if (okFuses.length === 5) options.push(() => {
      G.power.fuses[okFuses[Math.floor(Math.random() * okFuses.length)]] = 'blown';
    });
    if (this.cartridge > 0.3) options.push(() => (this.cartridge = 0));
    if (options.length) options[Math.floor(Math.random() * options.length)]();
  }

  activeFaults() {
    const f: string[] = [];
    if (this.leak) f.push('leak');
    if (G.power.wings.some((w) => w < 0.9)) f.push('array');
    if (CIRCUITS.some((c) => G.power.fuses[c] !== 'ok')) f.push('fuse');
    if (this.cartridge <= 0) f.push('co2');
    return f;
  }
}

// ------------------------------------------------------------------------------------------------
// Panels
// ------------------------------------------------------------------------------------------------

export class PowerPanel extends Rack {
  type = 'powerpanel';
  title = 'POWER DISTRIBUTION';
  color = 0xc2c6ca;
  movable = false;
  volt!: ReturnType<typeof gauge>;
  amps: ReturnType<typeof gauge>[] = [];
  fuseMeshes = new Map<Circuit, THREE.Mesh>();

  build() {
    this.volt = gauge(this.group, -0.6, 0.45, 'MAIN BUS x8V');
    this.amps[0] = gauge(this.group, 0.05, 0.45, 'ARRAY A (STBD)');
    this.amps[1] = gauge(this.group, 0.65, 0.45, 'ARRAY B (PORT)');
    text(this.group, 'FUSES', 0, 0.02, 0.4, 0.07);
    CIRCUITS.forEach((c, i) => {
      const x = -0.85 + i * 0.34;
      const y = -0.35;
      const holder = slot(this.group, x, y, 0.2, 0.3, c,
        (item) => (item.kind === 'fuse' && G.power.fuses[c] === 'empty' ? `Insert ${item.data.blown ? 'the blown' : 'a'} fuse into ${c}` : null),
        (item) => {
          G.items.takeFromHands();
          G.items.remove(item);
          G.power.fuses[c] = item.data.blown ? 'blown' : 'ok';
          G.audio?.click();
          this.sync();
        },
        {
          label: () => (G.power.fuses[c] === 'empty' ? null : `Pull the ${c} fuse`),
          use: () => {
            if (G.items.held) {
              G.ui.toast('Your hands are full');
              return;
            }
            const blown = G.power.fuses[c] === 'blown';
            G.power.fuses[c] = 'empty';
            const f = G.items.create('fuse', blown ? 'Blown fuse' : 'Fuse, 10A', { blown });
            G.items.take(f);
            this.sync();
          },
        });
      const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 12), new THREE.MeshStandardMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.8 }));
      fuse.position.set(0, 0, 0.04);
      fuse.userData.solid = false;
      holder.add(fuse);
      this.fuseMeshes.set(c, fuse);
    });
    text(this.group, 'SPARES IN STOWAGE  ·  10A ONLY', 0, -0.72, 1.2, 0.06, '#8a1a10');
    this.sync();
  }

  sync() {
    for (const [c, m] of this.fuseMeshes) {
      const st = G.power.fuses[c];
      m.visible = st !== 'empty';
      (m.material as THREE.MeshStandardMaterial).color.setHex(st === 'blown' ? 0x2a2a2a : 0xeeeeee);
    }
  }

  update(dt: number) {
    const p = G.power;
    this.volt.set(p.voltage / 40);
    this.volt.update(dt);
    this.amps.forEach((g, i) => {
      g.set(p.wingCurrent(i) * 0.8);
      g.update(dt);
    });
    this.sync();
  }
}
registerRack('powerpanel', () => new PowerPanel());

export class LifeSupportPanel extends Rack {
  type = 'lifesupport';
  title = 'LIFE SUPPORT';
  color = 0xbfc8c0;
  movable = false;
  co2g!: ReturnType<typeof gauge>;
  pg!: ReturnType<typeof gauge>;
  caution!: ReturnType<typeof lamp>;
  cart!: THREE.Mesh;

  build() {
    this.co2g = gauge(this.group, -0.55, 0.45, 'CO2 x2000 PPM');
    this.pg = gauge(this.group, 0.55, 0.45, 'CABIN kPa x25');
    this.caution = lamp(this.group, 0, 0.5, 0xff3322, 'MASTER CAUTION');
    button(this.group, 0, 0.15, 'SILENCE', 0xdddd22, () => {
      if (G.life.caution) G.life.silenced = true;
    }, () => 'Press ALARM SILENCE');
    const holder = slot(this.group, -0.4, -0.4, 0.3, 0.42, 'CO2 SCRUBBER',
      (item) => (item.kind === 'filter' && !G.life.cartridgeIn ? `Insert ${item.data.spent ? 'the spent' : 'a fresh'} cartridge` : null),
      (item) => {
        G.items.takeFromHands();
        G.items.remove(item);
        G.life.cartridgeIn = true;
        G.life.cartridge = item.data.spent ? 0 : 1;
        G.audio?.clunk();
      },
      {
        label: () => (G.life.cartridgeIn ? 'Pull out the scrubber cartridge' : null),
        use: () => {
          if (G.items.held) {
            G.ui.toast('Your hands are full');
            return;
          }
          const spent = G.life.cartridge <= 0;
          const f = G.items.create('filter', spent ? 'Spent CO₂ cartridge' : 'CO₂ cartridge (part used)', { spent, life: G.life.cartridge });
          G.life.cartridgeIn = false;
          G.items.take(f);
        },
      });
    this.cart = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.08), new THREE.MeshStandardMaterial({ color: 0xe6e6e6 }));
    this.cart.position.z = 0.04;
    this.cart.userData.solid = false;
    holder.add(this.cart);
    text(this.group, 'REPLACE CARTRIDGE', 0.45, -0.3, 0.6, 0.06);
    text(this.group, 'WHEN CO2 EXCEEDS 1', 0.45, -0.38, 0.6, 0.06);
    text(this.group, 'O2/N2 MAKEUP: AUTO', 0.45, -0.55, 0.6, 0.06, '#555');
  }

  update(dt: number) {
    const L = G.life;
    this.co2g.set(L.co2 / 10000);
    this.co2g.update(dt);
    const node = this.module;
    this.pg.set((node?.pressure ?? 0) / 125);
    this.pg.update(dt);
    this.caution.set(L.caution && Math.floor(G.time * 2) % 2 === 0);
    this.cart.visible = L.cartridgeIn;
  }
}
registerRack('lifesupport', () => new LifeSupportPanel());

defineItem('filter', {
  radius: 0.1,
  build(item: Item) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.26, 0.16), new THREE.MeshStandardMaterial({ color: item.data.spent ? 0x9a9a88 : 0xe6e6e6, roughness: 0.7 }));
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.04, 0.17), new THREE.MeshStandardMaterial({ color: 0x2255aa }));
    g.add(body, band);
    return g;
  },
});

// ------------------------------------------------------------------------------------------------
// The manual
// ------------------------------------------------------------------------------------------------

registerDoc('manual', {
  title: 'Station Operations Manual',
  cover: 'STATION OPERATIONS MANUAL',
  color: '#e9eef2',
  html: `
<h1>STATION OPERATIONS MANUAL</h1>
<div class="meta">Troubleshooting &middot; Rev. 7</div>
<p>This station has no computer to tell you what is wrong. Instead it has gauges, lamps and this manual.
Start from what you notice, find it below, and follow the reference.</p>
<h2>Index of symptoms</h2>
<table>
<tr><th>What you notice</th><th>See</th></tr>
<tr><td>A module is dark; its racks are dead</td><td>&sect;2</td></tr>
<tr><td>Racks everywhere are dead, but the lights work</td><td>&sect;1</td></tr>
<tr><td>Lights dimmer than usual everywhere</td><td>&sect;1</td></tr>
<tr><td>A two-tone alarm; the MASTER CAUTION lamp flashes</td><td>&sect;3 and &sect;4</td></tr>
<tr><td>Headache, stuffy air, trouble sleeping</td><td>&sect;3</td></tr>
<tr><td>A hissing noise</td><td>&sect;4</td></tr>
</table>

<h2>&sect;1 Main bus undervoltage</h2>
<p>Every experiment rack needs a main bus of at least 24 volts. On the POWER DISTRIBUTION panel in NODE 1 the
MAIN BUS gauge reads in units of 8 V: a healthy bus sits at about 3&frac12;. Below 3 the racks shut down.</p>
<p>The bus is fed by two solar array wings above the station, A (starboard) and B (port). Their gauges show what
each wing is producing <i>right now</i>. <b>During orbital night both read zero; this is normal</b> &mdash; the
batteries carry the bus through the night. Check the array gauges in daylight: a healthy wing reads about 4.</p>
<p>A wing that reads low in full sunlight is almost always <b>contaminated</b>: thruster exhaust from visiting vehicles
leaves a brown film on the cells. It must be cleaned by hand during a spacewalk, with the soft brush kept in stowage.
Take the brush out through the airlock, climb the mast using the tether rings, and brush the dirty wing
(left click, repeatedly) until it is clean.</p>

<h2>&sect;2 Blown fuse</h2>
<p>Each module is fed through a fuse on the POWER DISTRIBUTION panel: NODE, LAB, HAB, AIRLOCK, DOCK, and AUX (all
modules added after launch share AUX). A blown fuse cuts off the lights and racks of its module; the rest of the
station is unaffected.</p>
<p>A blown fuse looks <b>black</b> through its glass. Pull it out and put in a spare (both right click, like picking things up and putting them down). Spares are kept in stowage and can be ordered. Send blown fuses home with the cargo vehicle.</p>

<h2>&sect;3 Carbon dioxide</h2>
<p>The CO<sub>2</sub> scrubber on the LIFE SUPPORT panel in NODE 1 uses replaceable cartridges. A cartridge lasts about four
days, but can be spent early by a fault. When it is spent the CO<sub>2</sub> gauge (units of 2000 ppm) climbs past 1,
the master alarm sounds, and before long you will have a headache that makes sleep impossible.</p>
<p>Pull out the old cartridge and insert a fresh one from stowage. The air clears within a minute or two.
Order more cartridges before you run out.</p>

<h2>&sect;4 Loss of cabin pressure</h2>
<p>A micrometeoroid or a fatigued seam can open a pinhole in the hull. Air escapes slowly; the station's tanks replace
it automatically, but not as fast as it leaks. The CABIN gauge (units of 25 kPa) falls below 4 and the master alarm
sounds. You are in no danger &mdash; but the alarm will keep you awake, and a leak can't be left.</p>
<ol>
<li>Silence the alarm if you wish (ALARM SILENCE). It stays silent until the fault clears, but the leak does not.</li>
<li>Find the module with the leak. Listen for the hiss. If you can't tell where it's coming from, close hatches:
the pressure in a module without the leak recovers, and the LIFE SUPPORT panel reads NODE 1's pressure.</li>
<li>Look along the walls for a tiny hole rimmed with frost. Dust and loose fluff drift towards it.</li>
<li>Hold a patch kit against it and apply the patch (right click). Pressure recovers on its own.</li>
</ol>
<p>Patch kits are kept in stowage and can be ordered.</p>

<h2>&sect;5 The airlock and docking port</h2>
<p>See the EVA checklist (airlock) and the manual docking procedure (DOCKING module).</p>`,
});

export { HALF_IN };
