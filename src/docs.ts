import * as THREE from 'three';
import { G } from './game';
import { Item, defineItem } from './items';

export interface Doc {
  title: string;
  /** Short heading printed on the outside of the paper. */
  cover?: string;
  typed?: boolean;
  html: string | ((item: Item) => string | HTMLElement);
  color?: string;
}

export const DOCS: Record<string, Doc> = {};

export function registerDoc(id: string, doc: Doc) {
  DOCS[id] = doc;
}

const texCache = new Map<string, THREE.Texture>();
function paperTexture(title: string, color: string) {
  const key = `${title}|${color}`;
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 210;
  c.height = 297;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, 210, 297);
  g.fillStyle = '#222';
  g.font = 'bold 17px Georgia';
  g.textAlign = 'center';
  const words = title.split(' ');
  let line = '';
  let y = 40;
  for (const w of words) {
    if (g.measureText(line + w).width > 180) {
      g.fillText(line, 105, y);
      y += 20;
      line = '';
    }
    line += w + ' ';
  }
  g.fillText(line, 105, y);
  g.fillStyle = '#888';
  for (let i = 0; i < 14; i++) {
    const w = 120 + Math.random() * 50;
    g.fillRect(20, y + 30 + i * 13, w, 3);
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

export function docOf(item: Item): Doc {
  if (item.data.doc && DOCS[item.data.doc]) return DOCS[item.data.doc];
  return {
    title: item.data.title ?? item.name,
    typed: item.data.typed,
    html: item.data.html ?? '',
    color: item.data.color,
  };
}

export function readDoc(item: Item) {
  const doc = docOf(item);
  const div = document.createElement('div');
  div.className = 'paper' + (doc.typed ? ' typed' : '');
  const content = typeof doc.html === 'function' ? doc.html(item) : doc.html;
  if (typeof content === 'string') div.innerHTML = content;
  else div.appendChild(content);
  if (doc.color) div.style.background = doc.color;
  G.ui.openOverlay(div, () => item.data.onClose?.());
  item.data.read = true;
}

defineItem('paper', {
  radius: 0.12,
  build(item) {
    const doc = docOf(item);
    const color = doc.color ?? '#f4efe1';
    const mat = new THREE.MeshStandardMaterial({ map: paperTexture(doc.cover ?? doc.title, color), side: THREE.DoubleSide, roughness: 1 });
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.297, 0.004), [
      mat, mat, mat, mat, mat, mat,
    ]);
    g.add(m);
    return g;
  },
  label: (item) => `Read ${docOf(item).title}`,
  use: (item) => readDoc(item),
  read: (item) => readDoc(item),
});

export function makePaper(docId: string, pos?: THREE.Vector3) {
  return G.items.create('paper', DOCS[docId]?.title ?? docId, { doc: docId }, pos);
}

/** A one-off paper with custom content (letters, reports). */
export function makeLetter(title: string, html: string, extra: Record<string, any> = {}) {
  return G.items.create('paper', title, { title, html, ...extra });
}

// ---------------------------------------------------------------------------------------------
// Stock documents
// ---------------------------------------------------------------------------------------------

registerDoc('welcome', {
  title: 'Welcome aboard',
  html: `
<h1>ORBITAL RESEARCH AGENCY</h1>
<div class="meta">Mission Control &middot; Ground Operations &middot; Letter No. 1</div>
<p>Dear Station Keeper,</p>
<p>Welcome aboard. You are now the sole occupant of our little station. We hope you will find it a quiet and
rewarding place to work.</p>
<p>As you know, the station carries no computers and no radio: every word between us travels on paper.
Here is how things work.</p>
<h2>Science</h2>
<p>The racks in the LAB are experiments. Each has a written <b>procedure</b> somewhere aboard &mdash; we recommend
you read it before touching anything. When an experiment produces a result it prints a report slip.
Send the slips down to us and we will credit you with <b>science points</b>.</p>
<h2>Mail and supplies</h2>
<p>A cargo vehicle visits every night while you sleep. Anything you leave inside the docked vehicle comes
home with it &mdash; that is how your reports and order forms reach us. The next vehicle brings whatever you
ordered, paid for with your science points, along with our letters.</p>
<p>New vehicles wait near the station until you dock them from the DOCKING module.</p>
<h2>Housekeeping</h2>
<p>Things break. When something seems wrong, the <b>Station Operations Manual</b> lists symptoms and cures.
You are never in any danger &mdash; the station is very forgiving &mdash; but some work will stop until it is fixed.</p>
<p>Your crew quarters are in the HAB. Sleep well, and good luck.</p>
<p style="text-align:right">&mdash; Ground Operations</p>`,
});

registerDoc('handbook', {
  title: 'Crew Handbook',
  cover: 'CREW HANDBOOK',
  html: `
<h1>CREW HANDBOOK</h1>
<div class="meta">Living aboard</div>
<h2>Moving about</h2>
<p>There is no up or down aboard. The blue-grey deck panels mark "down" in every module, and the pale panels mark
"up", to help you keep your bearings.</p>
<p>You move by pushing off whatever is nearest. Each push (W) adds to your speed, and nothing but a wall will stop you
from going faster and faster. Holding W pushes again every second or so; quick repeated pushes add speed sooner.
A and D push you left and right, Space and Shift up and down.</p>
<p>To slow down, grab a handrail (S). Each grab takes off some speed; keep holding on and you will come to a stop,
and then push off backwards. Q and E roll you around.</p>
<p>Outside the station there is not always something within reach. That is what the tether is for.</p>
<h2>Hatches</h2>
<p>Every module is separated from its neighbours by a hatch. They are normally left open. Close a hatch with
its yellow lever to isolate a module &mdash; for example to contain a leak.</p>
<h2>Your belongings</h2>
<p>You can carry one thing at a time (right click). Let go of it in the middle of a module and it will drift;
let go of it against a wall and it will stick there with velcro. Papers can be read while held (R).</p>
<h2>Racks</h2>
<p>Every rack is built to a standard size and can be unbolted from its wall (right click on the rack's frame),
packed into a crate and installed on any free wall of any module. Rearrange the station however you like.</p>
<h2>Sleep</h2>
<p>Sleep in your crew quarters. The night is when mail goes down and supplies come up.</p>`,
});
