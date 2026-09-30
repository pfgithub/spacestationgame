import * as THREE from 'three';
import { Cell, HALF_IN, cellCenter } from './constants';
import { G } from './game';
import { Item } from './items';
import { Rack, registerRack } from './racks';
import { button, lamp, text } from './controls';
import { doorKey, stationMats } from './station';
import { makeLetter, makePaper, registerDoc } from './docs';
import { CATALOG, newOrderForm, orderTotal } from './catalog';
import { solarTexture, labelMesh } from './textures';

export const SHIP_CELL: Cell = [0, 0, -2];
export const DOCK_CELL: Cell = [0, 0, -1];
const DOCKED_Z = SHIP_CELL[2] * 4;
const HOLD_RANGE = 25;
/** Capture tolerances: how far off-centre, and how fast, the vehicle may arrive and still latch on. */
const CAPTURE_OFFSET = 0.8;
const CAPTURE_SPEED = 1.2;

/** Wraps a morning callback so it runs only the next morning. */
function once(f: () => void) {
  const g = () => {
    f();
    G.days.morning.splice(G.days.morning.indexOf(g), 1);
  };
  return g;
}

export class Cargo {
  state: 'docked' | 'waiting' | 'away' = 'away';
  mesh = new THREE.Group();
  cube: THREE.Mesh;
  /** Parts on the front face that would poke into the station while docked. */
  front = new THREE.Group();
  manifest: Item[] = [];
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  docking = false;
  vehicleNo = 1;
  /** Extra letters to include with the next vehicle. */
  outgoingLetters: Item[] = [];
  hud: HTMLElement;

  constructor() {
    const hull = stationMats.hull;
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), hull);
    this.mesh.add(this.cube);
    // service module behind the pressurised section
    const service = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 4, 24), new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.6, metalness: 0.4 }));
    service.rotation.x = Math.PI / 2;
    service.position.z = -4;
    this.mesh.add(service);
    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.2, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.8, side: THREE.DoubleSide }));
    nozzle.rotation.x = -Math.PI / 2;
    nozzle.position.z = -6.4;
    this.mesh.add(nozzle);
    const solar = new THREE.MeshStandardMaterial({ map: solarTexture(), roughness: 0.3, metalness: 0.4, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(5, 0.05, 1.8), solar);
      wing.position.set(s * 4.4, 0, -4);
      this.mesh.add(wing);
    }
    // docking target on the front face
    const target = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.5, 32), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    const bar1 = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.06), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const bar2 = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.9), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    post.rotation.x = Math.PI / 2;
    post.position.z = 0.3;
    const cross = new THREE.Group();
    cross.add(bar1.clone(), bar2.clone());
    cross.scale.setScalar(0.4);
    cross.position.z = 0.6;
    target.add(disc, bar1, bar2, post, cross);
    bar1.position.z = bar2.position.z = 0.002;
    target.position.set(0, 1.3, 2.01);
    const name = labelMesh('CARGO', 1.4, 0.3, { fg: '#223' });
    name.position.set(0, -1.3, 2.01);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.08, 8, 32), stationMats.frame);
    ring.position.z = 2.02;
    this.front.add(target, name, ring);
    this.mesh.add(this.front);
    this.mesh.visible = false;
    G.scene.add(this.mesh);

    this.hud = document.createElement('div');
    this.hud.className = 'periscope hidden';
    this.hud.innerHTML = `<div class="reticle"></div><div class="readout"></div>
      <div class="msg"></div>
      <div class="help">W/S close / open range &middot; A/D move target right / left &middot; Shift/Space move target up / down &middot; R start the approach again &middot; TAB leave controls</div>`;
    document.body.appendChild(this.hud);
  }

  get shipModule() {
    return G.station.get(SHIP_CELL);
  }

  /** Restores a saved state. A docked vehicle's cabin is already part of the saved station. */
  restore(state: Cargo['state'], pos: THREE.Vector3, vehicleNo: number, manifest: Item[], outgoing: Item[]) {
    this.state = state;
    this.vehicleNo = vehicleNo;
    this.manifest = manifest;
    this.outgoingLetters = outgoing;
    this.pos.copy(pos);
    this.mesh.position.copy(pos);
    this.mesh.visible = state !== 'away';
    this.cube.visible = state === 'waiting';
    this.front.visible = state === 'waiting';
  }

  /** A new vehicle arrives and waits at the hold point. */
  arrive(items: Item[]) {
    for (const it of items) G.items.stow(it);
    this.manifest = items;
    this.state = 'waiting';
    this.pos.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3, DOCKED_Z - HOLD_RANGE);
    this.vel.set(0, 0, 0);
    this.mesh.visible = true;
    this.cube.visible = true;
    this.front.visible = true;
    this.mesh.position.copy(this.pos);
  }

  dock() {
    this.state = 'docked';
    this.docking = false;
    this.pos.set(0, 0, DOCKED_Z);
    this.vel.set(0, 0, 0);
    this.mesh.position.copy(this.pos);
    this.mesh.visible = true;
    this.cube.visible = false;
    this.front.visible = false;
    const st = G.station;
    st.doors.delete(`${DOCK_CELL.join(',')}#5`);
    st.addModule(SHIP_CELL, 'ship', {}, `CARGO VEHICLE ${this.vehicleNo}`);
    st.connect(DOCK_CELL, 5, false);
    st.rebuild();
    // unpack the cargo into the cabin
    const c = cellCenter(SHIP_CELL);
    this.manifest.forEach((item, i) => {
      if (item.kind === 'paper') {
        // papers are velcroed to the walls
        const side = i % 4;
        const n = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)][side];
        const p = c.clone().addScaledVector(n, -(HALF_IN - 0.02)).add(new THREE.Vector3(0, 0, 0.9 - (i % 3) * 0.6));
        if (side < 2) p.y += 0.3;
        item.quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        G.items.place(item, p, new THREE.Vector3(), 'stuck');
      } else {
        const p = c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6));
        G.items.place(item, p);
        item.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.2);
      }
    });
    this.manifest = [];
    G.audio?.clunk();
  }

  /** Why the vehicle can't be released right now, or null. */
  whyNotRelease(): string | null {
    if (this.state !== 'docked') return 'no vehicle';
    const door = G.station.doors.get(doorKey(DOCK_CELL, 5));
    if (door && (door.open || door.t > 0)) return 'hatch';
    if (G.station.moduleAt(G.player.pos) === this.shipModule) return 'inside';
    return null;
  }

  /** Sends the docked vehicle home now, with everything inside it. The next one comes overnight. */
  release() {
    const sent = this.undock();
    const letters = this.processMail(sent);
    for (const it of letters) G.items.stow(it);
    this.manifest = letters;
    // watch it drift away
    this.pos.set(0, 0, DOCKED_Z);
    this.vel.set(0, 0, -0.3);
    this.departT = 30;
    this.mesh.visible = true;
    this.cube.visible = true;
    this.front.visible = true;
    G.audio?.clunk();
    G.ui.toast('The vehicle backs away from the port, bound for the ground.', 4000);
  }

  departT = 0;

  /** Undocks. Returns everything that was left inside. */
  undock(): Item[] {
    const st = G.station;
    const ship = this.shipModule;
    const sent: Item[] = [];
    if (ship) {
      for (const it of G.items.list.slice()) {
        if (it.state === 'held') continue;
        if (st.moduleAt(it.pos) === ship) {
          sent.push(it);
          G.items.remove(it);
        }
      }
      st.removeModule(SHIP_CELL);
      const dock = st.get(DOCK_CELL)!;
      dock.faces[5] = 'port';
      st.makeDoor(DOCK_CELL, 5, 'port', false);
      st.rebuild();
    }
    this.state = 'away';
    this.mesh.visible = false;
    this.vehicleNo++;
    return sent;
  }

  /**
   * Runs during the night. A vehicle that was released arrives back loaded with the reply; one that is still
   * docked (or still waiting to be docked) just stays, and nothing is exchanged.
   */
  night() {
    if (this.state === 'docked') G.days.morning.push(once(() => G.ui.toast('No new vehicle came up: the last one was never released.', 5000)));
    if (this.state !== 'away') return;
    this.departT = 0;
    this.arrive(this.manifest.length ? this.manifest : this.processMail([]));
  }

  processMail(sent: Item[]): Item[] {
    const { lines, sum } = G.science.receive(sent);
    const deliveries: Item[] = [];
    const orderLines: string[] = [];
    const forms = sent.filter((i) => i.data.doc === 'order');
    let hadOrder = false;
    for (const f of forms) {
      const sel = f.data.selected as string[];
      if (!sel.length) continue;
      hadOrder = true;
      const total = orderTotal(f);
      if (total > G.science.balance) {
        orderLines.push(`<p>Your order for ${total} points could not be filled: your balance is only ${G.science.balance} points.
          Nothing has been charged. Please send a new form.</p>`);
        continue;
      }
      G.science.balance -= total;
      const names: string[] = [];
      for (const id of sel) {
        const entry = CATALOG.find((c) => c.id === id);
        if (!entry) continue;
        names.push(entry.name);
        deliveries.push(...entry.deliver());
      }
      orderLines.push(`<p>Your order has been filled and is aboard this vehicle (${total} points):</p><ul>${names.map((n) => `<li>${n}</li>`).join('')}</ul>`);
    }
    // anything that isn't mail or rubbish was surely sent by mistake: it comes back on the next vehicle
    const rubbish = (i: Item) => i.data.report !== undefined || i.data.doc === 'order' || i.data.blown || i.data.spent
      || (i.kind === 'paper' && !i.data.doc) || i.data.rack?.broken || i.data.dead || i.data.spoiled;
    const returned = sent.filter((i) => !rubbish(i));
    const scrapped = sent.filter((i) => i.data.rack?.broken);
    const scrapNote = scrapped.length
      ? `<p>We received the damaged ${scrapped.map((s) => s.data.rack.title.toLowerCase()).join(' and ')}. It is beyond repair and has been
        scrapped. You may order a replacement whenever you like.</p>`
      : '';
    const thanks = returned.length
      ? `<p>The last vehicle also brought down: ${returned.map((o) => o.name).join(', ')}. We assume this was a mistake,
        and ${returned.length === 1 ? 'it is' : 'they are'} aboard this vehicle.</p>`
      : '';
    deliveries.push(...returned.map((i) => G.items.adopt(i)));
    const reportTable = lines.length
      ? `<table><tr><th>Experiment</th><th>Result</th><th>Points</th></tr>${lines.join('')}<tr><th colspan="2">Total credited</th><th>${sum}</th></tr></table>`
      : `<p>No science reports were received on the last vehicle.</p>`;
    const html = `<h1>STATEMENT</h1><div class="meta">Ground Operations &middot; Day ${G.day}</div>
      <h2>Reports received</h2>${reportTable}
      ${forms.length || hadOrder ? `<h2>Orders</h2>${orderLines.join('') || '<p>Your order form was blank.</p>'}` : ''}
      ${thanks}${scrapNote}
      <h2>Balance</h2><p>Your balance is now <b>${G.science.balance} points</b>.</p>
      ${sent.length === 0 && this.vehicleNo > 2 ? '<p class="note">The last vehicle left empty. Remember: leave reports and order forms inside the vehicle before you sleep.</p>' : ''}
      <p style="text-align:right">&mdash; Ground Operations</p>`;
    const statement = makeLetter('Statement', html, { typed: false, color: '#eef3f8' });
    return [statement, newOrderForm(), ...this.outgoingLetters.splice(0), ...deliveries];
  }

  // ---------------------------------------------------------------------------------------------
  // Manual docking
  // ---------------------------------------------------------------------------------------------

  enterDocking() {
    if (this.state !== 'waiting') return;
    this.docking = true;
    G.player.frozen = true;
    G.player.vel.set(0, 0, 0);
    this.hud.classList.remove('hidden');
    G.ui.root.style.display = 'none';
  }

  leaveDocking() {
    this.docking = false;
    G.player.frozen = false;
    this.hud.classList.add('hidden');
    G.ui.root.style.display = '';
    // the vehicle's autopilot holds position when nobody is flying it
    this.vel.set(0, 0, 0);
  }

  msgT = 0;

  /** Shows a line in the periscope (the normal HUD is hidden while docking). */
  message(text: string, seconds = 4) {
    (this.hud.querySelector('.msg') as HTMLElement).textContent = text;
    this.msgT = seconds;
  }

  /** Puts the vehicle back at the hold point to start the approach again. */
  resetApproach() {
    this.pos.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3, DOCKED_Z - HOLD_RANGE);
    this.vel.set(0, 0, 0);
    this.message('Vehicle returned to the hold point.', 2.5);
  }

  updateDocking(dt: number) {
    const inp = G.input;
    if (inp.wasPressed('Tab')) {
      this.leaveDocking();
      return;
    }
    if (inp.wasPressed('KeyR')) {
      this.resetApproach();
      return;
    }
    // thrusters push the vehicle around; it keeps drifting until you push it the other way
    const axis = (neg: boolean, pos: boolean) => (pos ? 1 : 0) - (neg ? 1 : 0);
    const a = 1.2 * dt;
    this.vel.x += axis(inp.isDown('KeyD'), inp.isDown('KeyA')) * a;
    this.vel.y += axis(inp.isDown('Space'), inp.isDown('ShiftLeft') || inp.isDown('ShiftRight')) * a;
    this.vel.z = THREE.MathUtils.clamp(this.vel.z + axis(inp.isDown('KeyS'), inp.isDown('KeyW')) * a, -3, 3);
    this.pos.addScaledVector(this.vel, dt);
    const range = DOCKED_Z - this.pos.z;
    if (range <= 0) {
      const lateral = Math.hypot(this.pos.x, this.pos.y);
      if (lateral < CAPTURE_OFFSET && this.vel.z < CAPTURE_SPEED) {
        this.leaveDocking();
        G.ui.fade(() => {
          this.dock();
          G.ui.toast('Capture! The vehicle is docked. Open the hatch in the DOCKING module.', 5000);
        }, 400);
        return;
      }
      G.audio?.bump(3);
      this.message(lateral >= CAPTURE_OFFSET
        ? `MISALIGNED: ${lateral.toFixed(2)} m off centre (limit ${CAPTURE_OFFSET}). Glanced off the ring.`
        : `TOO FAST: ${this.vel.z.toFixed(2)} m/s (limit ${CAPTURE_SPEED}). Bounced off the ring.`);
      this.pos.z = DOCKED_Z - 0.05;
      this.vel.z = -Math.abs(this.vel.z) * 0.4 - 0.05;
    }
    if (range > 60) this.vel.z = Math.max(this.vel.z, 0);
    this.mesh.position.copy(this.pos);
    // periscope camera looks out of the docking port
    const cam = G.camera;
    cam.position.set(0, 1.3, -6.1);
    cam.quaternion.identity();
    const readout = this.hud.querySelector('.readout') as HTMLElement;
    const sgn = (v: number, d = 2) => (v >= 0 ? '+' : '') + v.toFixed(d);
    readout.innerHTML = `RANGE ${Math.max(0, range).toFixed(1).padStart(5, '0')} m &nbsp;RATE ${sgn(this.vel.z)} m/s<br>`
      + `HORIZ ${sgn(this.pos.x)} m &nbsp;DRIFT ${sgn(this.vel.x)} m/s<br>`
      + `VERT&nbsp; ${sgn(this.pos.y)} m &nbsp;DRIFT ${sgn(this.vel.y)} m/s`;
    this.msgT -= dt;
    if (this.msgT <= 0) (this.hud.querySelector('.msg') as HTMLElement).textContent = '';
  }

  update(dt: number) {
    if (this.state === 'waiting' && !this.docking) {
      this.mesh.position.copy(this.pos);
      this.mesh.position.y += Math.sin(G.time * 0.3) * 0.05;
    }
    if (this.state === 'away' && this.departT > 0) {
      // a released vehicle backs off and then burns for home
      this.departT -= dt;
      this.vel.z -= dt * (this.departT < 22 ? 1.5 : 0.05);
      this.pos.addScaledVector(this.vel, dt);
      this.mesh.position.copy(this.pos);
      if (this.departT <= 0) this.mesh.visible = false;
    }
  }
}

// ------------------------------------------------------------------------------------------------
// Docking control panel
// ------------------------------------------------------------------------------------------------

export class DockingPanel extends Rack {
  type = 'dockpanel';
  title = 'DOCKING CONTROL';
  color = 0xc6c9b8;
  movable = false;
  waiting!: ReturnType<typeof lamp>;
  captured!: ReturnType<typeof lamp>;
  sealed!: ReturnType<typeof lamp>;

  build() {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.3, 20), new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.5 }));
    scope.rotation.x = Math.PI / 2;
    scope.position.set(-0.45, 0.35, 0.15);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20), new THREE.MeshStandardMaterial({ color: 0x113355, metalness: 0.9, roughness: 0.1 }));
    lens.position.set(-0.45, 0.35, 0.301);
    this.group.add(scope, lens);
    text(this.group, 'PERISCOPE', -0.45, 0.07, 0.4, 0.06);
    this.waiting = lamp(this.group, 0.2, 0.45, 0xffaa22, 'VEHICLE HOLDING');
    this.captured = lamp(this.group, 0.65, 0.45, 0x33ff66, 'DOCKED');
    this.sealed = lamp(this.group, 0.42, 0.15, 0x3399ff, 'HATCH SEALED');
    button(this.group, -0.45, -0.35, 'MANUAL CONTROL', 0xcc3322, () => {
      if (G.cargo.state !== 'waiting') {
        G.audio?.beep(220, 0.2);
        return;
      }
      G.cargo.enterDocking();
    }, () => 'Take manual control');
    button(this.group, 0.45, -0.35, 'RELEASE', 0x2255cc, () => {
      const why = G.cargo.whyNotRelease();
      if (why) {
        G.audio?.beep(220, 0.3);
        if (why === 'inside') G.ui.toast('Not with you still aboard it!');
        return;
      }
      G.cargo.release();
    }, () => 'Release the vehicle (send it home)');
    text(this.group, 'RELEASE SENDS THE VEHICLE AND', 0.45, -0.55, 0.9, 0.05, '#8a1a10');
    text(this.group, 'EVERYTHING IN IT TO THE GROUND', 0.45, -0.61, 0.9, 0.05, '#8a1a10');
  }

  update() {
    this.waiting.set(G.cargo.state === 'waiting');
    this.captured.set(G.cargo.state === 'docked');
    const door = G.station.doors.get(doorKey(DOCK_CELL, 5));
    this.sealed.set(G.cargo.state === 'docked' && !!door && !door.open && door.t === 0);
  }
}
registerRack('dockpanel', () => new DockingPanel());

registerDoc('proc-docking', {
  title: 'Procedure: docking a cargo vehicle',
  cover: 'PROCEDURE: MANUAL DOCKING',
  html: `
<h1>MANUAL DOCKING</h1>
<div class="meta">Cargo vehicle, telemanual mode</div>
<p>Cargo vehicles fly themselves to a hold point about ${HOLD_RANGE} metres in front of the docking port and
wait there. The last stretch is flown by you, from the DOCKING CONTROL panel.</p>
<h2>Docking</h2>
<ol>
<li>Check the amber <b>VEHICLE HOLDING</b> lamp is lit, and press <b>MANUAL CONTROL</b>. The periscope shows the
view straight out of the docking port.</li>
<li>Steer the <b>docking target</b> (the black disc with the white cross) into the middle of the reticle:
A and D move it right and left, Shift and Space move it up and down. The HORIZ and VERT readouts show how far off
centre it is. The thrusters are strong, but the vehicle keeps drifting until you push it back the other way.</li>
<li>Close in with W; S slows the approach or backs the vehicle off.</li>
<li>If it all goes wrong, R sends the vehicle back to the hold point to start again.</li>
<li>The docking ring is forgiving: anywhere near the centre, slower than about <b>1 m/s</b>, and it will latch on.
Too fast or too far off and the vehicle bounces off. No harm done &mdash; try again.</li>
<li>After capture, open the hatch at the far end of the DOCKING module.</li>
</ol>
<p>You may leave the controls at any time (TAB); the vehicle will hold its position.</p>
<h2>Sending the vehicle home</h2>
<p>Load the vehicle with everything you want to send down: report slips, film, samples, order forms, rubbish.
Close the hatch (the blue <b>HATCH SEALED</b> lamp lights) and press <b>RELEASE</b>. The vehicle leaves at once.</p>
<p>The ground only sends a new vehicle once the old one has come home. <b>If you go to sleep without releasing it, it
stays docked and nothing comes up overnight.</b></p>`,
});

export { makePaper };
