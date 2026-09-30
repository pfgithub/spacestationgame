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

document.addEventListener('pointerlockchange', () => {
  if (!G.audio && document.pointerLockElement) {
    G.audio = new Audio();
    G.audio.setHum(1);
  }
});

// ---- initial station ----
function buildInitialStation() {
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
  st.reserved.add(cellKey([0, 0, -2]));
  for (let y = 1; y < 4; y++) st.reserved.add(cellKey([0, y, 0]));

  // solar truss above the node
  const m = stationMats;
  st.addExteriorBox(new THREE.Vector3(-0.2, 2, -0.2), new THREE.Vector3(0.2, 9.8, 0.2), m.truss);
  st.addExteriorBox(new THREE.Vector3(-11, 9.8, -0.25), new THREE.Vector3(11, 10.2, 0.25), m.truss);
  st.rebuild();
}
buildInitialStation();

G.player.pos.set(0, 0, 0);

// ---- interaction ----
const ray = new THREE.Raycaster();
ray.far = 3;
let focused: Interactable | null = null;

function updateInteraction() {
  ray.set(camera.position, G.player.forward);
  const hits = ray.intersectObjects([G.station.group], true);
  focused = null;
  for (const h of hits) {
    if (h.object.userData.solid === false && !h.object.userData.it) continue;
    const it = findInteract(h.object);
    if (it && h.distance <= (it.range ?? 2.6)) focused = it;
    break;
  }
  const primary = focused?.label?.() ?? null;
  const secondary = focused?.altLabel?.() ?? null;
  G.ui.setPrompt(primary, secondary);
  if (focused && G.input.clicked(0) && primary) focused.use?.();
  if (focused && G.input.clicked(2) && secondary) focused.alt?.();
}

function simulate(dt: number) {
  G.time += dt;
  G.player.update(dt);
  G.station.update(dt);
  G.player.applyCamera(camera);
  updateInteraction();
}

// ---- loop ----
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (G.input.locked) simulate(dt);
  G.world.update(G.time);
  const mod = G.station.moduleAt(G.player.pos);
  G.ui.setStatus(`Day ${G.day}<br>${mod ? mod.name : 'OUTSIDE'}<br>speed ${G.player.vel.length().toFixed(1)} m/s`);
  G.ui.update();
  renderer.render(scene, camera);
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
