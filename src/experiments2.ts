import * as THREE from 'three';
import { G } from './game';
import { registerRack } from './racks';
import { Experiment } from './experiments';
import { button, dial, lamp, slot, text } from './controls';
import { defineItem, Item } from './items';
import { registerDoc } from './docs';
import { labelMesh } from './textures';

// ------------------------------------------------------------------------------------------------
// Radiation dosimetry
// ------------------------------------------------------------------------------------------------

const BADGES = 4;

defineItem('badge', {
  radius: 0.06,
  build(item) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.015), new THREE.MeshStandardMaterial({ color: 0x2b6cb0 }));
    const film = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0xdddddd }));
    film.position.z = 0.008;
    const num = labelMesh(`D${item.data.n}`, 0.05, 0.025, { fg: '#fff' });
    num.position.set(0, -0.035, 0.009);
    g.add(body, film, num);
    g.scale.setScalar(1.6);
    return g;
  },
  label: (item) => `Dosimeter badge D${item.data.n}${item.data.where ? ` (exposed)` : ''}`,
  use: () => G.ui.toast('A film dosimeter badge. It records radiation where it is left.'),
});

export class DosimetryRack extends Experiment {
  type = 'dosimetry';
  title = 'DOSIMETRY READER';
  color = 0xc8c4d8;
  runsNeeded = 3;
  points = 15;
  loaded: Item[] = [];
  holders: THREE.Mesh[] = [];
  lampOk!: ReturnType<typeof lamp>;

  build() {
    text(this.group, 'BADGE TRAY', 0, 0.62, 0.6, 0.07);
    const tray = slot(this.group, 0, 0.35, 1.1, 0.35, '',
      (item) => (item.kind === 'badge' && this.loaded.length < BADGES ? `Put badge D${item.data.n} in the tray` : null),
      (item) => {
        G.items.takeFromHands();
        G.items.stow(item);
        this.loaded.push(item);
        G.audio?.click();
        this.sync();
      },
      {
        label: () => (this.loaded.length ? 'Take a badge from the tray' : null),
        use: () => {
          if (G.items.held) {
            G.ui.toast('Your hands are full');
            return;
          }
          const b = this.loaded.pop()!;
          G.items.unstowToHands(b);
          this.sync();
        },
      });
    for (let i = 0; i < BADGES; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.16, 0.02), new THREE.MeshStandardMaterial({ color: 0x2b6cb0 }));
      m.position.set(-0.39 + i * 0.26, 0, 0.03);
      m.userData.solid = false;
      tray.add(m);
      this.holders.push(m);
    }
    this.lampOk = lamp(this.group, -0.4, -0.1, 0x33ff66, 'TRAY FULL');
    button(this.group, 0.35, -0.15, 'READ', 0x333333, () => this.read());
    text(this.group, 'MODEL DR-4  ·  28V', -0.55, -0.95, 0.7, 0.06, '#333');
    this.sync();
  }

  /** Called when the rack is first delivered: it comes with its badges. */
  makeBadges() {
    const out: Item[] = [];
    for (let i = 1; i <= BADGES; i++) out.push(G.items.create('badge', `Dosimeter badge D${i}`, { n: i, where: null, nights: 0 }));
    return out;
  }

  sync() {
    this.holders.forEach((h, i) => (h.visible = i < this.loaded.length));
  }

  read() {
    if (!this.powered) return;
    if (this.loaded.length < BADGES) {
      G.audio?.beep(220, 0.2);
      return;
    }
    const places = this.loaded.map((b) => b.data.where as string | null);
    const distinct = new Set(places.filter((p) => p));
    const lines = this.loaded.map((b) => {
      const w = b.data.where as string | null;
      const dose = w ? (w === 'OUTSIDE' ? 1.8 : w.startsWith('CUPOLA') ? 0.61 : 0.4) + Math.random() * 0.08 : 0;
      return `D${b.data.n} ... ${w ? w.padEnd(14, '.') : 'NOT EXPOSED...'} ${dose.toFixed(2)} mGy`;
    });
    const valid = distinct.size === BADGES;
    const pos = new THREE.Vector3(0.35, -0.5, 0.12);
    if (valid) {
      G.science.printSlip(this, pos, 'DOSIMETRY SURVEY', [...lines, 'SURVEY ......... COMPLETE'],
        this.completeRun('Radiation dosimetry'));
    } else {
      G.science.printSlip(this, pos, 'DOSIMETRY SURVEY', [...lines, 'SURVEY ......... INCOMPLETE'], null);
    }
    // reading wipes the badges ready for reuse
    for (const b of this.loaded) {
      b.data.where = null;
      b.data.nights = 0;
    }
  }

  serialize() {
    return { ...super.serialize(), loaded: this.loaded };
  }
  deserialize(d: Record<string, any>) {
    super.deserialize(d);
    this.loaded = (d.loaded ?? []).filter(Boolean);
    if (this.holders.length) this.sync();
  }

  update() {
    this.lampOk.set(this.powered && this.loaded.length === BADGES);
  }

  onSleep() {
    // badges left loose around the station record where they spent the night
    for (const b of G.items.list) {
      if (b.kind !== 'badge' || b.state === 'stowed' || b.state === 'held') continue;
      const m = G.station.moduleAt(b.pos);
      b.data.where = m ? m.name : 'OUTSIDE';
      b.data.nights = (b.data.nights ?? 0) + 1;
    }
  }
}
registerRack('dosimetry', () => new DosimetryRack());

registerDoc('proc-dosimetry', {
  title: 'Procedure: Dosimetry survey',
  cover: 'PROCEDURE DR-4 Radiation Dosimetry',
  html: `
<h1>PROCEDURE DR-4</h1>
<div class="meta">Radiation dosimetry survey</div>
<p>Four film badges (D1&ndash;D4) measure how much radiation reaches different parts of the station. Each complete
survey is worth <b>15 points</b>. We would like <b>three</b> surveys.</p>
<ol>
<li>Install the DOSIMETRY READER rack anywhere convenient.</li>
<li>Place the four badges in <b>four different modules</b>. Stick them to a wall so they stay put.
(A badge left outside the station also counts as a place &mdash; we would be most interested in that.)</li>
<li>Leave them there overnight. A badge records the place where it spends the night.</li>
<li>In the morning collect all four badges and put them in the reader's tray.</li>
<li>Press <b>READ</b>. The reader prints the survey slip and wipes the badges for reuse.</li>
</ol>
<p class="note">A survey with two badges in the same module, or a badge that did not spend a night out, is incomplete
and worthless.</p>`,
});

// ------------------------------------------------------------------------------------------------
// Earth observation camera
// ------------------------------------------------------------------------------------------------

const TARGETS = ['ocean', 'forest', 'desert', 'cloud'] as const;
type Target = (typeof TARGETS)[number] | 'coast' | 'ice' | 'dark' | 'blur' | 'wall';

export class EarthCamRack extends Experiment {
  type = 'earthcam';
  title = 'EARTH CAMERA';
  color = 0xc9cfc0;
  runsNeeded = 3;
  points = 5;
  needsPower = false;
  focus = 0;
  advanced = true;
  frames: Target[] = [];
  counter!: THREE.Object3D;
  winLamp!: ReturnType<typeof lamp>;

  build() {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.45), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5 }));
    body.position.set(-0.35, 0.3, 0.25);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.35, 20), new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.6 }));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(-0.35, 0.3, 0.6);
    this.group.add(body, lens);
    dial(this.group, 0.5, 0.45, 'FOCUS', 5, () => this.focus, (v) => (this.focus = v), ['.5', '1', '3', '10', '∞']);
    button(this.group, 0.2, -0.2, 'SHUTTER', 0x333333, () => this.shoot());
    button(this.group, 0.7, -0.2, 'ADVANCE', 0x777777, () => this.advance(), () => 'Wind on the film');
    this.winLamp = lamp(this.group, -0.6, -0.2, 0x33ff66, 'WINDOW OK');
    text(this.group, 'MODEL EC-9  ·  12 V SELF-POWERED', -0.3, -0.95, 1.0, 0.06, '#333');
    this.syncCounter();
  }

  get besideWindow() {
    const m = this.module;
    return !!m && m.faces.includes('window');
  }

  syncCounter() {
    if (this.counter) this.group.remove(this.counter);
    this.counter = text(this.group, `FRAME ${this.frames.length + 1}/${TARGETS.length}`, -0.35, -0.2, 0.4, 0.08, '#fff', '#111');
  }

  advance() {
    if (this.advanced) {
      G.audio?.beep(200, 0.1);
      return;
    }
    this.advanced = true;
    G.audio?.click();
    setTimeout(() => G.audio?.click(), 120);
  }

  shoot() {
    G.audio?.click();
    if (!this.advanced) {
      // double exposure spoils the previous frame
      this.frames[this.frames.length - 1] = 'blur';
      return;
    }
    let what: Target;
    if (!this.besideWindow) what = 'wall';
    else if (!G.world.groundLit()) what = 'dark';
    else if (this.focus !== 4) what = 'blur';
    else {
      const n = G.world.nadir();
      what = n.cloud > 0.45 ? 'cloud' : n.terrain;
    }
    this.frames.push(what);
    this.advanced = false;
    if (this.frames.length >= TARGETS.length) this.finishRoll();
    this.syncCounter();
  }

  finishRoll() {
    const good = new Set(this.frames.filter((f) => (TARGETS as readonly string[]).includes(f)));
    const film = G.items.create('film', 'Film: Earth photographs', { caption: 'Earth photographs' });
    film.data.report = null;
    if (good.size > 0) {
      film.data.report = this.completeRun(`Earth photography (${good.size} of ${TARGETS.length} targets)`, good.size);
      film.name = `Film: Earth photographs, roll ${film.data.report.run}`;
    }
    this.frames = [];
    this.advanced = true;
    const world = new THREE.Vector3(-0.35, 0.02, 0.4).applyMatrix4(this.group.matrixWorld);
    G.items.place(film, world, new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion).multiplyScalar(0.25));
    G.audio?.beep(500, 0.3);
  }

  update() {
    this.winLamp.set(this.besideWindow);
  }

  serialize() {
    return { ...super.serialize(), focus: this.focus, advanced: this.advanced, frames: this.frames };
  }
  deserialize(d: Record<string, any>) {
    super.deserialize(d);
    Object.assign(this, { focus: d.focus ?? 0, advanced: d.advanced ?? true, frames: d.frames ?? [] });
    if (this.counter) this.syncCounter();
  }
}
registerRack('earthcam', () => new EarthCamRack());

registerDoc('proc-earthcam', {
  title: 'Procedure: Earth photography',
  cover: 'PROCEDURE EC-9 Earth Camera',
  html: `
<h1>PROCEDURE EC-9</h1>
<div class="meta">Earth observation camera &middot; target photography</div>
<p>Our geographers would like photographs of four kinds of ground, taken straight down from orbit:</p>
<table>
<tr><td>1</td><td>Open ocean</td></tr>
<tr><td>2</td><td>Forest or grassland (green land)</td></tr>
<tr><td>3</td><td>Desert (tan or brown land)</td></tr>
<tr><td>4</td><td>Thick cloud</td></tr>
</table>
<p>Each roll holds four frames. Each <b>different</b> target on a roll is worth <b>5 points</b>, so a perfect roll
is worth 20. We would like <b>three</b> rolls.</p>
<h2>Setting up</h2>
<p>The camera looks straight down at the Earth through a window, so the rack must be installed in a module that
<b>has a window</b> (such as an observation cupola). The WINDOW OK lamp confirms it.</p>
<h2>Taking a photograph</h2>
<ol>
<li>Set <b>FOCUS</b> to <b>&infin;</b> (infinity). The Earth is a long way away.</li>
<li>Watch the ground passing beneath the station through the window. The camera sees what is directly below.</li>
<li>When one of the targets is below, press <b>SHUTTER</b>.</li>
<li>Wind on the film with <b>ADVANCE</b> before the next frame. Pressing SHUTTER without winding on
double-exposes and spoils the previous frame.</li>
</ol>
<p>After the fourth frame the camera rewinds and ejects the film canister. Send it to the ground unopened.</p>
<p class="note">The ground below must be in daylight. The station is often still in sunshine while the ground beneath
has already fallen into night &mdash; look down, not at the sky. Frames taken at night show nothing.</p>`,
});
