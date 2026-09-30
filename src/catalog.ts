import * as THREE from 'three';
import { G } from './game';
import { Item, defineItem, simpleBox } from './items';
import { makePaper, registerDoc } from './docs';
import { labelMesh } from './textures';
import { RACK_TYPES } from './racks';

export interface CatalogEntry {
  id: string;
  name: string;
  cost: number;
  section: 'Modules' | 'Experiments' | 'Equipment' | 'Comforts';
  blurb: string;
  /** Creates the delivered items. */
  deliver(): Item[];
  /** Hidden until this returns true. */
  available?(): boolean;
}

export const CATALOG: CatalogEntry[] = [];

function rackCrate(type: string) {
  const rack = G.racks.create(type);
  return G.items.create('crate', `${rack.title} rack (packed)`, { rack });
}

export function decor(style: string, name: string) {
  return G.items.create('decor', name, { style });
}

CATALOG.push(
  {
    id: 'corridor', name: 'Corridor module', cost: 30, section: 'Modules',
    blurb: 'A standard pressurised module, packed flat. Installed from outside during a spacewalk. Four free walls for racks.',
    deliver: () => [G.items.create('modkit', 'Corridor module kit', { moduleType: 'corridor' }), makePaper('proc-install')],
  },
  {
    id: 'cupola', name: 'Observation cupola', cost: 55, section: 'Modules',
    blurb: 'A module with a large window. Needed for Earth photography.',
    deliver: () => [G.items.create('modkit', 'Cupola module kit', { moduleType: 'cupola' }), makePaper('proc-install')],
  },
  {
    id: 'exp-dosimetry', name: 'Radiation dosimetry experiment', cost: 35, section: 'Experiments',
    blurb: 'Measures the radiation dose in different parts of the station. Rack and procedure included.',
    deliver: () => [rackCrate('dosimetry'), makePaper('proc-dosimetry')],
    available: () => RACK_TYPES.has('dosimetry') && !G.science.owned.has('dosimetry'),
  },
  {
    id: 'exp-earthobs', name: 'Earth observation camera', cost: 50, section: 'Experiments',
    blurb: 'A large-format camera for photographing the Earth. Must be mounted beside a window. Rack and procedure included.',
    deliver: () => [rackCrate('earthcam'), makePaper('proc-earthcam')],
    available: () => RACK_TYPES.has('earthcam') && !G.science.owned.has('earthcam'),
  },
  {
    id: 'stowage', name: 'Stowage rack', cost: 10, section: 'Equipment',
    blurb: 'Soft stowage bags for keeping loose things tidy.',
    deliver: () => [rackCrate('stowage')],
  },
  {
    id: 'filters', name: 'CO₂ scrubber cartridges (2)', cost: 4, section: 'Equipment',
    blurb: 'Spare cartridges for the air scrubber.',
    deliver: () => [G.items.create('filter', 'CO₂ cartridge'), G.items.create('filter', 'CO₂ cartridge')],
  },
  {
    id: 'patches', name: 'Leak patch kits (2)', cost: 4, section: 'Equipment',
    blurb: 'Adhesive hull patches for small leaks.',
    deliver: () => [G.items.create('patch', 'Leak patch kit'), G.items.create('patch', 'Leak patch kit')],
  },
  {
    id: 'fuses', name: 'Spare fuses (3)', cost: 3, section: 'Equipment',
    blurb: 'Replacement fuses for the power distribution panel.',
    deliver: () => [0, 1, 2].map(() => G.items.create('fuse', 'Fuse, 10A')),
  },
  {
    id: 'brush', name: 'Soft brush', cost: 2, section: 'Equipment',
    blurb: 'For cleaning delicate surfaces.',
    deliver: () => [G.items.create('brush', 'Soft brush')],
  },
  {
    id: 'plant', name: 'Potted plant', cost: 6, section: 'Comforts',
    blurb: 'A cheerful fern in a velcro pot.', deliver: () => [decor('plant', 'Potted fern')],
  },
  {
    id: 'poster', name: 'Travel poster', cost: 4, section: 'Comforts',
    blurb: '"Visit Earth!" Vintage style.', deliver: () => [decor('poster', 'Travel poster')],
  },
  {
    id: 'lights', name: 'String lights', cost: 5, section: 'Comforts',
    blurb: 'Warm little lights for the long orbital nights.', deliver: () => [decor('lights', 'String lights')],
  },
  {
    id: 'flag', name: 'Agency pennant', cost: 3, section: 'Comforts',
    blurb: 'Show some team spirit.', deliver: () => [decor('flag', 'Agency pennant')],
  },
  {
    id: 'guitar', name: 'Travel guitar', cost: 12, section: 'Comforts',
    blurb: 'Out of tune by design.', deliver: () => [decor('guitar', 'Guitar')],
  },
);

// ------------------------------------------------------------------------------------------------
// The order form
// ------------------------------------------------------------------------------------------------

export function newOrderForm() {
  return G.items.create('paper', 'Order form', { doc: 'order', selected: [] as string[] });
}

export function orderTotal(item: Item) {
  return (item.data.selected as string[]).reduce((s, id) => s + (CATALOG.find((c) => c.id === id)?.cost ?? 0), 0);
}

registerDoc('order', {
  title: 'Order form',
  cover: 'SUPPLY ORDER FORM',
  color: '#fff6d6',
  html: (item) => {
    const div = document.createElement('div');
    const sel = item.data.selected as string[];
    div.innerHTML = `<h1>SUPPLY ORDER FORM</h1>
      <div class="meta">Tick what you would like. Leave this form in the cargo vehicle before you sleep.<br>
      Balance on your last statement: <b>${G.science.balance} points</b></div>`;
    let section = '';
    for (const c of CATALOG) {
      if (c.available && !c.available()) continue;
      if (c.section !== section) {
        section = c.section;
        const h = document.createElement('h2');
        h.textContent = section;
        div.appendChild(h);
      }
      const row = document.createElement('label');
      row.className = 'form-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = sel.includes(c.id);
      cb.addEventListener('change', () => {
        const i = sel.indexOf(c.id);
        if (cb.checked && i < 0) sel.push(c.id);
        if (!cb.checked && i >= 0) sel.splice(i, 1);
        total.textContent = `Total: ${orderTotal(item)} points`;
      });
      row.appendChild(cb);
      const name = document.createElement('span');
      name.className = 'name';
      name.innerHTML = `<b>${c.name}</b><br><span class="note">${c.blurb}</span>`;
      row.appendChild(name);
      const cost = document.createElement('span');
      cost.className = 'cost';
      cost.textContent = `${c.cost} pts`;
      row.appendChild(cost);
      div.appendChild(row);
    }
    const total = document.createElement('div');
    total.className = 'total';
    total.textContent = `Total: ${orderTotal(item)} points`;
    div.appendChild(total);
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Orders exceeding your balance (including reports sent with this form) cannot be filled and will be returned.';
    div.appendChild(note);
    return div;
  },
});

// ------------------------------------------------------------------------------------------------
// Items the catalog delivers
// ------------------------------------------------------------------------------------------------

defineItem('modkit', {
  radius: 0.45,
  build(item) {
    const l = labelMesh(`${String(item.data.moduleType).toUpperCase()} MODULE`, 0.8, 0.14, { fg: '#111' });
    const g = simpleBox(0.9, 0.7, 0.5, 0xd7d2c4, l);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 8, 20), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.6 }));
    ring.position.set(0, 0, -0.26);
    g.add(ring);
    return g;
  },
  label: () => null,
});

defineItem('patch', {
  radius: 0.1,
  build: () => simpleBox(0.22, 0.16, 0.04, 0xd0a020, labelMesh('PATCH', 0.18, 0.06, { fg: '#111' })),
});

defineItem('fuse', {
  radius: 0.05,
  build() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.07, 10), new THREE.MeshStandardMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.7 }));
    body.rotation.z = Math.PI / 2;
    const c1 = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.015, 10), new THREE.MeshStandardMaterial({ color: 0xb0b0b0, metalness: 0.8 }));
    c1.rotation.z = Math.PI / 2;
    c1.position.x = 0.035;
    const c2 = c1.clone();
    c2.position.x = -0.035;
    g.add(body, c1, c2);
    g.scale.setScalar(1.8);
    return g;
  },
});

defineItem('brush', {
  radius: 0.15,
  build() {
    const g = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 8), new THREE.MeshStandardMaterial({ color: 0x3355aa }));
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.06), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    head.position.y = 0.21;
    g.add(handle, head);
    return g;
  },
});

defineItem('decor', {
  radius: 0.15,
  build(item) {
    const g = new THREE.Group();
    const style = item.data.style;
    if (style === 'plant') {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.12, 12), new THREE.MeshStandardMaterial({ color: 0xb0603a }));
      pot.rotation.x = Math.PI / 2;
      pot.position.z = 0.06;
      g.add(pot);
      const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f8f35, side: THREE.DoubleSide });
      for (let i = 0; i < 9; i++) {
        const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.28), leafMat);
        leaf.geometry.translate(0, 0.14, 0);
        leaf.position.z = 0.12;
        leaf.rotation.set(Math.PI / 2 - 0.6, 0, (i / 9) * Math.PI * 2);
        g.add(leaf);
      }
    } else if (style === 'poster') {
      const c = document.createElement('canvas');
      c.width = 200; c.height = 280;
      const x = c.getContext('2d')!;
      const grad = x.createLinearGradient(0, 0, 0, 280);
      grad.addColorStop(0, '#0b1a3a'); grad.addColorStop(1, '#233f7a');
      x.fillStyle = grad; x.fillRect(0, 0, 200, 280);
      x.fillStyle = '#2d7fd0'; x.beginPath(); x.arc(100, 330, 200, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#3c9a4a'; x.beginPath(); x.ellipse(70, 180, 50, 20, 0.3, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#ffe9b0'; x.font = 'bold 30px Georgia'; x.textAlign = 'center';
      x.fillText('VISIT', 100, 50); x.fillText('EARTH!', 100, 88);
      x.font = '13px Georgia'; x.fillText('Oceans · Weather · Gravity', 100, 115);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      g.add(new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide })));
    } else if (style === 'lights') {
      const colors = [0xffcc66, 0xff8866, 0x88ccff, 0xaaff88];
      for (let i = 0; i < 12; i++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshStandardMaterial({ color: colors[i % 4], emissive: colors[i % 4], emissiveIntensity: 2 }));
        b.position.set((i - 5.5) * 0.12, Math.sin(i * 0.9) * 0.05, 0.02);
        g.add(b);
      }
      const l = new THREE.PointLight(0xffc880, 0.8, 3);
      l.position.z = 0.2;
      g.add(l);
    } else if (style === 'flag') {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.25), new THREE.MeshStandardMaterial({ map: labelMesh('ORA', 0.4, 0.25, { fg: '#fff', bg: '#1d4f9a' }).material.map, side: THREE.DoubleSide }));
      g.add(f);
    } else if (style === 'guitar') {
      const wood = new THREE.MeshStandardMaterial({ color: 0x9a6232 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 20), wood);
      body.rotation.x = Math.PI / 2;
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 0.03), new THREE.MeshStandardMaterial({ color: 0x3a2515 }));
      neck.position.y = 0.3;
      g.add(body, neck);
    } else {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.02), new THREE.MeshStandardMaterial({ color: 0xffffff })));
    }
    return g;
  },
  label: (item) => (item.data.style === 'guitar' ? 'Play the guitar' : null),
  use: (item) => {
    if (item.data.style !== 'guitar' || !G.audio) return;
    const notes = [196, 247, 294, 392, 494, 587];
    notes.forEach((n, i) => setTimeout(() => G.audio?.beep(n * (1 + (Math.random() - 0.5) * 0.02), 0.6), i * 70));
  },
});

registerDoc('proc-install', {
  title: 'Instructions: installing a module',
  cover: 'MODULE INSTALLATION',
  html: `
<h1>MODULE INSTALLATION</h1>
<div class="meta">For all standard packed modules</div>
<p>Modules are shipped packed into a crate small enough to carry through a hatch. They are installed from
<b>outside</b> the station.</p>
<ol>
<li>Carry the kit to the AIRLOCK and perform a spacewalk (see the EVA checklist in the airlock).</li>
<li>Take the kit to the outside of the module you want to extend. The chosen wall must be bare on the inside:
remove any rack mounted on it first.</li>
<li>Hold the kit against the hull and deploy it (right click). The module unfolds and berths itself.</li>
<li>The new module's hatch is delivered <b>closed</b>. Open it from inside.</li>
</ol>
<h2>Restrictions</h2>
<ul>
<li>Nothing may be berthed where it would block the solar array mast, the airlock's outer hatch, or the cargo
vehicle's approach corridor.</li>
<li>Modules may be stacked no more than one level above or below the main deck.</li>
</ul>
<h2>Packing a module</h2>
<p>An unused module can be packed back into its crate from outside, to move it elsewhere. It must be empty (no racks,
no loose items), attached to the station at only one hatch, and that hatch must be closed.
Deploy-and-pack works only for corridor-type modules: the node, airlock and docking module are permanent.</p>`,
});
