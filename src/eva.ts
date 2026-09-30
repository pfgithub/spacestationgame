import * as THREE from 'three';
import { ALL_DIRS, Cell, HALF_OUT, axisOf, cellCenter, dirVec, faceVec } from './constants';
import { G } from './game';
import { Rack, registerRack } from './racks';
import { button, gauge, lamp, text, toggle } from './controls';
import { setInteract } from './interact';
import { registerDoc } from './docs';
import { doorKey } from './station';

export const AIRLOCK: Cell = [0, 0, 1];
const TETHER_LEN = 10;

const anchorMat = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.4, metalness: 0.3, emissive: 0x201800 });

/** Spacesuit, airlock cycling and the safety tether. */
export class EVA {
  suited = false;
  tether: { anchor: THREE.Vector3; length: number } | null = null;
  anchors = new THREE.Group();
  rope: THREE.Line;
  pump: 'idle' | 'depress' | 'repress' = 'idle';
  wasOutside = false;

  constructor() {
    G.scene.add(this.anchors);
    const geom = new THREE.BufferGeometry().setFromPoints(new Array(24).fill(0).map(() => new THREE.Vector3()));
    this.rope = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: 0xffd23a }));
    this.rope.frustumCulled = false;
    this.rope.visible = false;
    G.scene.add(this.rope);
    G.station.onRebuild.push(() => this.buildAnchors());
  }

  get airlock() {
    return G.station.get(AIRLOCK)!;
  }
  get innerDoor() {
    return G.station.doors.get(doorKey([0, 0, 0], 4))!;
  }
  get outerDoor() {
    return G.station.doors.get(`${AIRLOCK.join(',')}#4`)!;
  }

  /** Installs the airlock's safety interlocks on its two hatches. */
  setupInterlocks() {
    this.innerDoor.interlock = () => {
      if (this.innerDoor.open) return null;
      return this.airlock.pressure < 99 ? 'The hatch will not budge: the airlock is not pressurised.' : null;
    };
    this.outerDoor.interlock = () => {
      if (this.outerDoor.open) return null;
      return this.airlock.pressure > 1 ? 'The hatch will not budge: there is still air in the airlock.' : null;
    };
  }

  playerInAirlock() {
    return G.station.moduleAt(G.player.pos) === this.airlock;
  }

  setPump(mode: 'depress' | 'repress' | 'idle') {
    if (mode === 'depress') {
      if (this.innerDoor.open || this.innerDoor.t > 0) return 'PUMP INHIBIT: INNER HATCH OPEN';
      if (this.playerInAirlock() && !this.suited) return 'PUMP INHIBIT: CREW NOT SUITED';
    }
    if (mode === 'repress' && (this.outerDoor.open || this.outerDoor.t > 0)) return 'PUMP INHIBIT: OUTER HATCH OPEN';
    this.pump = mode;
    return null;
  }

  toggleSuit() {
    if (this.suited) {
      if (this.airlock.pressure < 99 && this.playerInAirlock()) {
        G.ui.toast('Not in a vacuum!');
        return;
      }
      if (G.items.held) {
        G.ui.toast('Your hands are full');
        return;
      }
      this.suited = false;
      G.ui.vignette.classList.remove('suit');
      G.audio?.hiss(1);
    } else {
      this.suited = true;
      G.ui.vignette.classList.add('suit');
      G.audio?.hiss(1.5);
    }
  }

  clip(anchor: THREE.Vector3) {
    const len = this.tether?.length ?? TETHER_LEN;
    this.tether = { anchor: anchor.clone(), length: len };
    G.audio?.click();
    G.ui.toast('Tether clipped');
  }

  buildAnchors() {
    this.anchors.clear();
    const add = (p: THREE.Vector3, normal: THREE.Vector3) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 8, 16), anchorMat);
      ring.position.copy(p);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      setInteract(ring, {
        label: () => (G.station.isInside(G.player.pos) ? null : 'Clip tether here'),
        use: () => this.clip(p),
        range: 2.4,
        anchor: true,
      });
      this.anchors.add(ring);
    };
    for (const m of G.station.modules.values()) {
      const c = cellCenter(m.cell);
      for (const d of ALL_DIRS) {
        if (m.faces[d] === 'conn') continue;
        const n = dirVec(d);
        // offset from the face centre so it's not in front of hatches
        const off = axisOf(d) === 1 ? faceVec(d, 0, 1.3, 1.3) : faceVec(d, 0, 1.3, 1.3);
        add(c.clone().addScaledVector(n, HALF_OUT + 0.06).add(off), n);
      }
    }
    // along the solar array mast and beam
    for (const y of [3.5, 6, 8.5]) add(new THREE.Vector3(0.28, y, 0), new THREE.Vector3(1, 0, 0));
    for (const x of [-9, -6, -3, 3, 6, 9]) add(new THREE.Vector3(x, 10.4, 1.9), new THREE.Vector3(0, 0, 1));
  }

  /** Applies the tether constraint and reel-in. Call after the player moves. */
  update(dt: number) {
    const p = G.player;
    const outside = !G.station.isInside(p.pos);
    // airlock pressure
    const al = this.airlock;
    if (this.pump === 'depress') {
      al.pressure = Math.max(0, al.pressure - dt * 8);
      if (al.pressure === 0) this.pump = 'idle';
    } else if (this.pump === 'repress') {
      al.pressure = Math.min(101, al.pressure + dt * 10);
      if (al.pressure === 101) this.pump = 'idle';
    }
    if (this.outerDoor.open && al.pressure > 0) al.pressure = 0;

    if (outside && !this.wasOutside) {
      // stepping out: clip on to the anchor beside the outer hatch
      if (!this.tether) this.clip(cellCenter(AIRLOCK).add(faceVec(4, HALF_OUT + 0.06, 1.3, 1.3)));
    }
    if (!outside && this.wasOutside && this.tether && al.pressure < 1) {
      // inside again: unclip once back in the airlock
      if (this.playerInAirlock()) {
        this.tether = null;
        G.ui.toast('Tether unclipped');
      }
    }
    this.wasOutside = outside;

    if (this.tether) {
      const t = this.tether;
      const d = p.pos.clone().sub(t.anchor);
      const dist = d.length();
      const dir = d.clone().divideScalar(dist || 1);
      if (G.input.isDown('KeyF')) {
        // pull yourself in hand over hand
        p.vel.addScaledVector(dir, -2.2 * dt);
        const out = p.vel.dot(dir);
        if (out < -2.5) p.vel.addScaledVector(dir, -2.5 - out);
      }
      if (dist > t.length) {
        p.pos.copy(t.anchor).addScaledVector(dir, t.length);
        const vn = p.vel.dot(dir);
        if (vn > 0) {
          p.vel.addScaledVector(dir, -vn * 1.3);
          if (vn > 0.5) G.audio?.bump(vn);
        }
      }
      this.drawRope(dist);
    } else {
      this.rope.visible = false;
    }
  }

  drawRope(dist: number) {
    const t = this.tether!;
    const p = G.player;
    const start = p.pos.clone().addScaledVector(p.up, -0.35).addScaledVector(p.right, 0.1);
    const slack = Math.max(0, t.length - dist);
    const mid = start.clone().lerp(t.anchor, 0.5).addScaledVector(p.up, -slack * 0.35).addScaledVector(p.right, slack * 0.15);
    const curve = new THREE.QuadraticBezierCurve3(start, mid, t.anchor);
    const pts = curve.getPoints(23);
    const attr = this.rope.geometry.attributes.position as THREE.BufferAttribute;
    pts.forEach((v, i) => attr.setXYZ(i, v.x, v.y, v.z));
    attr.needsUpdate = true;
    this.rope.visible = true;
  }

  status() {
    if (!this.suited) return '';
    const al = this.airlock;
    let s = '<br>SUIT ON';
    if (this.tether) s += ` &middot; tether ${G.player.pos.distanceTo(this.tether.anchor).toFixed(1)}/${this.tether.length} m`;
    if (this.playerInAirlock()) s += `<br>airlock ${al.pressure.toFixed(0)} kPa`;
    return s;
  }
}

// ------------------------------------------------------------------------------------------------
// Airlock racks
// ------------------------------------------------------------------------------------------------

export class SuitRack extends Rack {
  type = 'suit';
  title = 'EVA SUIT';
  color = 0xb8bcc4;
  movable = false;
  suit = new THREE.Group();

  build() {
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.8 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.35), white);
    torso.position.set(0, 0.25, 0.25);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.2, metalness: 0.3 }));
    helmet.position.set(0, 0.8, 0.25);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2.2), new THREE.MeshStandardMaterial({ color: 0xc08a20, metalness: 0.9, roughness: 0.1 }));
    visor.rotation.x = Math.PI / 2;
    visor.position.set(0, 0.8, 0.3);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.3), white);
    legs.position.set(0, -0.5, 0.22);
    const arms = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.18, 0.25), white);
    arms.position.set(0, 0.45, 0.25);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.18), new THREE.MeshStandardMaterial({ color: 0xcfcfcf }));
    pack.position.set(0, 0.3, 0.06);
    this.suit.add(torso, helmet, visor, legs, arms, pack);
    this.group.add(this.suit);
    const it = {
      label: () => (G.eva.suited ? 'Take off the spacesuit' : 'Put on the spacesuit'),
      use: () => {
        G.eva.toggleSuit();
        this.suit.visible = !G.eva.suited;
      },
    };
    const hook = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.9, 0.02), new THREE.MeshBasicMaterial({ visible: false }));
    hook.position.z = 0.3;
    this.group.add(hook);
    setInteract(hook, it);
  }

  update() {
    this.suit.visible = !G.eva.suited;
  }
}
registerRack('suit', () => new SuitRack());

export class AirlockPanel extends Rack {
  type = 'airlockctl';
  title = 'AIRLOCK CONTROL';
  color = 0xd0c7a8;
  movable = false;
  g!: ReturnType<typeof gauge>;
  safe!: ReturnType<typeof lamp>;
  press!: ReturnType<typeof lamp>;
  pumping!: ReturnType<typeof lamp>;
  message = '';
  msgTimer = 0;
  msgLabel?: THREE.Object3D;

  build() {
    this.g = gauge(this.group, 0, 0.45, 'PRESSURE kPa x20');
    this.press = lamp(this.group, -0.55, 0.1, 0x33ff66, 'PRESSURISED');
    this.pumping = lamp(this.group, 0, 0.1, 0xffaa22, 'PUMP RUNNING');
    this.safe = lamp(this.group, 0.55, 0.1, 0x3399ff, 'VACUUM');
    button(this.group, -0.35, -0.3, 'DEPRESS', 0xcc3322, () => this.pump('depress'), () => 'Press DEPRESS');
    button(this.group, 0.35, -0.3, 'REPRESS', 0x33aa44, () => this.pump('repress'), () => 'Press REPRESS');
    text(this.group, 'INNER HATCH MUST BE CLOSED TO DEPRESS', 0, -0.62, 1.4, 0.06, '#8a1a10');
    text(this.group, 'OUTER HATCH MUST BE CLOSED TO REPRESS', 0, -0.72, 1.4, 0.06, '#8a1a10');
    void toggle;
  }

  pump(mode: 'depress' | 'repress') {
    const why = G.eva.setPump(mode);
    if (why) {
      G.audio?.beep(200, 0.35);
      this.showMessage(why);
    } else {
      G.audio?.beep(700, 0.1);
      if (mode === 'depress') G.audio?.hiss(10);
    }
  }

  showMessage(msg: string) {
    if (this.msgLabel) this.group.remove(this.msgLabel);
    this.msgLabel = text(this.group, msg, 0, -0.9, 1.6, 0.09, '#ff5533', '#1a0a08');
    this.msgTimer = 4;
  }

  update(dt: number) {
    const al = G.eva.airlock;
    this.g.set(al.pressure / 101);
    this.g.update(dt);
    this.press.set(al.pressure >= 99);
    this.safe.set(al.pressure <= 1);
    this.pumping.set(G.eva.pump !== 'idle' && Math.floor(G.time * 3) % 2 === 0);
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0 && this.msgLabel) {
        this.group.remove(this.msgLabel);
        this.msgLabel = undefined;
      }
    }
  }
}
registerRack('airlockctl', () => new AirlockPanel());

registerDoc('proc-eva', {
  title: 'EVA checklist',
  cover: 'EVA CHECKLIST',
  color: '#f7f0d0',
  html: `
<h1>EVA CHECKLIST</h1>
<div class="meta">Keep this card in the airlock</div>
<h2>Going out</h2>
<ol>
<li>Bring what you need into the AIRLOCK (you can carry one thing).</li>
<li>Put on the spacesuit from the EVA SUIT rack.</li>
<li>Close the <b>inner</b> hatch behind you.</li>
<li>Press <b>DEPRESS</b>. Wait for the blue <b>VACUUM</b> lamp.</li>
<li>Open the <b>outer</b> hatch.</li>
<li>As you leave, your safety tether clips on to the ring beside the hatch.</li>
</ol>
<h2>Outside</h2>
<ul>
<li>Your tether is ${TETHER_LEN} metres long. It will not let you drift further than that from where it is clipped.</li>
<li>To go further, clip on to another yellow ring. The tether then gives you ${TETHER_LEN} metres from that ring.</li>
<li>You can only push off from something within arm's reach. If you find yourself floating free, haul
yourself in along the tether (hold F).</li>
<li>Things you let go of outside stay where you leave them &mdash; mostly.</li>
</ul>
<h2>Coming in</h2>
<ol>
<li>Enter the airlock and close the <b>outer</b> hatch. The tether unclips itself.</li>
<li>Press <b>REPRESS</b>. Wait for the green <b>PRESSURISED</b> lamp.</li>
<li>Take off the suit, and open the inner hatch.</li>
</ol>
<p class="note">The airlock will refuse to pump down while its inner hatch is open, or while anyone inside is not
wearing a suit. The hatches will not open against a pressure difference.</p>`,
});
