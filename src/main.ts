import * as THREE from 'three';
import './style.css';
import { G } from './game';
import { Input } from './input';
import { UI } from './ui';
import { Station, stationMats } from './station';
import { Player } from './player';
import { World } from './world';
import { Audio } from './audio';
import { findInteract, Interactable } from './interact';
import { cellKey } from './constants';
import { Items } from './items';
import { Racks } from './racks';
import { Days } from './days';
import { Power } from './power';
import { makePaper } from './docs';
import { Science } from './science';
import './experiments';
import './experiments2';
import { Cargo } from './cargo';
import { newOrderForm } from './catalog';
import { EVA } from './eva';
import { Construction } from './construction';
import { LifeSupport } from './life';
import { loadSave, restoreGame, writeSave } from './save';

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 30000);
scene.add(camera);

G.scene = scene;
G.camera = camera;
G.renderer = renderer;
G.time = 0;
G.day = 1;
G.input = new Input(renderer.domElement);
G.ui = new UI(document.body);
G.world = new World(scene);
G.station = new Station();
G.player = new Player();
scene.add(G.station.group);
G.items = new Items();
G.racks = new Racks();
G.days = new Days();
G.power = new Power();
G.science = new Science();
G.cargo = new Cargo();
G.days.nightly.push(() => G.cargo.night());
G.eva = new EVA();
new Construction();
G.life = new LifeSupport();
G.days.nightly.unshift(() => G.life.night());

document.addEventListener('pointerlockchange', () => {
  if (!G.audio && document.pointerLockElement) {
    G.audio = new Audio();
    G.audio.setHum(1);
  }
});

// ---- the parts of the station that never change ----
function buildFixed() {
  const st = G.station;
  st.reserved.add(cellKey([0, 0, -2]));
  for (let y = 1; y < 4; y++) st.reserved.add(cellKey([0, y, 0]));
  // solar truss above the node
  const m = stationMats;
  st.addExteriorBox(new THREE.Vector3(-0.2, 2, -0.2), new THREE.Vector3(0.2, 9.8, 0.2), m.truss);
  st.addExteriorBox(new THREE.Vector3(-11, 9.8, -0.25), new THREE.Vector3(11, 10.2, 0.25), m.truss);
  G.power.buildArrays();
}

// ---- a brand new game ----
function seedNewGame() {
  const st = G.station;
  st.addModule([0, 0, 0], 'node');
  st.addModule([1, 0, 0], 'lab');
  st.addModule([-1, 0, 0], 'hab');
  st.addModule([0, 0, 1], 'airlock', { 4: 'hatch' });
  st.addModule([0, 0, -1], 'dock', { 5: 'port' });
  st.connect([0, 0, 0], 0);
  st.connect([0, 0, 0], 1);
  st.connect([0, 0, 0], 4);
  st.connect([0, 0, 0], 5);
  st.makeDoor([0, 0, 1], 4, 'hatch', false);
  st.makeDoor([0, 0, -1], 5, 'port', false);
  st.rebuild();

  const R = G.racks;
  R.mountRack(R.create('bed'), [-1, 0, 0], 4);
  const stow = R.create('stowage') as import('./racks').StowageRack;
  R.mountRack(stow, [-1, 0, 0], 5);
  stow.add(makePaper('handbook'));
  stow.add(G.items.create('filter', 'CO\u2082 cartridge'));
  stow.add(G.items.create('filter', 'CO\u2082 cartridge'));
  stow.add(G.items.create('fuse', 'Fuse, 10A'));
  stow.add(G.items.create('fuse', 'Fuse, 10A'));
  stow.add(G.items.create('patch', 'Leak patch kit'));
  stow.add(G.items.create('brush', 'Soft brush'));
  const welcome = makePaper('welcome');
  G.items.place(welcome, new THREE.Vector3(-0.3, 0.2, -0.9));
  welcome.spin.set(0.1, 0.3, 0.05);

  R.mountRack(R.create('crystal'), [1, 0, 0], 0);
  R.mountRack(R.create('botany'), [1, 0, 0], 4);
  R.mountRack(R.create('fluid'), [1, 0, 0], 5);
  // procedures are velcroed to the lab walls
  const stick = (doc: string, pos: THREE.Vector3, normal: THREE.Vector3) => {
    const p = makePaper(doc);
    p.quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    G.items.place(p, pos, new THREE.Vector3(), 'stuck');
  };
  stick('proc-crystal', new THREE.Vector3(5.2, -1.58, 0.9), new THREE.Vector3(0, 1, 0));
  stick('proc-botany', new THREE.Vector3(4.2, -1.58, 0.9), new THREE.Vector3(0, 1, 0));
  stick('proc-fluid', new THREE.Vector3(4.2, -1.58, -0.9), new THREE.Vector3(0, 1, 0));

  R.mountRack(R.create('dockpanel'), [0, 0, -1], 0);
  stick('proc-docking', new THREE.Vector3(0.9, -1.58, -4.2), new THREE.Vector3(0, 1, 0));
  R.mountRack(R.create('suit'), [0, 0, 1], 0);
  R.mountRack(R.create('airlockctl'), [0, 0, 1], 1);
  stick('proc-eva', new THREE.Vector3(0.6, -1.58, 4.4), new THREE.Vector3(0, 1, 0));
  G.eva.setupInterlocks();
  R.mountRack(R.create('powerpanel'), [0, 0, 0], 3);
  R.mountRack(R.create('lifesupport'), [0, 0, 0], 2);
  stick('manual', new THREE.Vector3(-5.58, 0.3, 0.6), new THREE.Vector3(1, 0, 0));

  // the first vehicle is already docked when you arrive
  G.cargo.arrive([newOrderForm()]);
  G.cargo.dock();
  G.player.pos.set(0, 0, 0);
}

buildFixed();
const saved = loadSave();
if (saved) {
  try {
    restoreGame(saved);
  } catch (e) {
    console.error('Could not restore the save, starting afresh', e);
    location.search = '?fresh';
  }
} else {
  seedNewGame();
}
G.days.morning.push(() => writeSave());
window.addEventListener('pagehide', () => writeSave());
window.addEventListener('beforeunload', () => writeSave());

// ---- interaction ----
const ray = new THREE.Raycaster();
ray.far = 3;
let focused: Interactable | null = null;

function isItemMesh(o: THREE.Object3D | null) {
  while (o) {
    if (o === G.items.group) return true;
    o = o.parent;
  }
  return false;
}

function updateInteraction() {
  ray.set(camera.position, G.player.forward);
  const hits = ray.intersectObjects([G.station.group, G.items.group, G.eva.anchors, ...G.racks.list.map((r) => r.group)], true);
  focused = null;
  let hit: THREE.Intersection | undefined;
  for (const h of hits) {
    if (h.object.userData.solid === false && !h.object.userData.it) continue;
    hit = h;
    const it = findInteract(h.object);
    if (it && h.distance <= (it.range ?? 2.6)) focused = it;
    break;
  }
  const held = G.items.held;
  const primary = focused?.label?.() ?? null;
  let secondary: string | null;
  let secondaryAction: (() => void) | undefined;
  if (held) {
    const acc = focused?.acceptLabel?.(held) ?? null;
    if (acc) {
      secondary = acc;
      secondaryAction = () => focused!.accept!(held);
    } else {
      const stick = hit && hit.distance < 2.6 && !isItemMesh(hit.object);
      secondary = stick ? `Stick ${held.name} here` : `Let go of ${held.name}`;
      secondaryAction = () => G.items.release(stick ? hit : undefined);
    }
  } else {
    secondary = focused?.altLabel?.() ?? null;
    secondaryAction = () => focused?.alt?.();
  }
  G.ui.setPrompt(primary, secondary);
  if (focused && G.input.clicked(0) && primary) focused.use?.();
  if (G.input.clicked(2) && secondary) secondaryAction?.();
  if (G.input.wasPressed('KeyR') && held && !G.items.readHeld()) G.ui.toast(`Nothing to read on the ${held.name}`);
}

function simulate(dt: number) {
  G.time += dt;
  if (G.cargo.docking) {
    G.cargo.updateDocking(dt);
  } else {
    G.player.update(dt);
    G.eva.update(dt);
    G.player.applyCamera(camera);
  }
  G.station.update(dt);
  G.cargo.update(dt);
  G.items.update(dt);
  G.racks.update(dt);
  G.power.update(dt);
  G.life.update(dt);
  if (!G.cargo.docking) updateInteraction();
}

// ---- loop ----
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (G.input.locked) simulate(dt);
  G.world.update(G.time);
  const mod = G.station.moduleAt(G.player.pos);
  const held = G.items.held ? `<br>Holding: ${G.items.held.name}` : '';
  const extra: [string, string][] = [];
  if (G.items.held?.kind === 'paper') extra.push(['R', `read ${G.items.held.name}`]);
  if (G.eva.tether && !G.player.canPush()) extra.push(['push towards tether', 'haul yourself in']);
  G.ui.setHints(extra);
  G.ui.setStatus(`Day ${G.day}<br>${mod ? mod.name : 'OUTSIDE'}${held}${G.eva.status()}`);
  G.ui.update();
  renderer.render(scene, camera);
  if (!G.cargo.docking) G.items.renderHeld(renderer);
  G.input.endFrame();
  requestAnimationFrame(frame);
}
G.player.applyCamera(camera);
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// debugging / test handles
Object.assign(window, {
  G,
  /** Advances the simulation n steps without rendering. Keys in `keys` are held down throughout. */
  sim(n: number, keys: string[] = [], press: string[] = []) {
    for (const k of press) G.input.pressed.add(k);
    for (const k of keys) G.input.down.add(k);
    for (let i = 0; i < n; i++) {
      simulate(1 / 60);
      G.input.endFrame();
    }
    for (const k of keys) G.input.down.delete(k);
  },
});
