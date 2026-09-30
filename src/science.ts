import * as THREE from 'three';
import { G } from './game';
import { Item, defineItem } from './items';
import { makeLetter } from './docs';
import type { Rack } from './racks';

export interface Report {
  exp: string;
  expTitle: string;
  run: number;
  points: number;
}

/** Tracks the agency's ledger of science points. Points are credited when reports reach the ground. */
export class Science {
  balance = 0;
  totalEarned = 0;
  /** Completed runs per experiment type. */
  progress: Record<string, number> = {};
  completed = new Set<string>();
  /** Per-frame hooks for things that change over time outside racks (thawing samples, ...). */
  tickers: ((dt: number) => void)[] = [];
  /** Hooks that get a last look at items as they leave for the ground (e.g. judging returned samples). */
  sendHooks: ((items: Item[]) => void)[] = [];

  update(dt: number) {
    for (const t of this.tickers) t(dt);
  }

  /** Experiment types currently aboard (mounted or packed). */
  get owned() {
    return new Set(G.racks.all().map((r) => r.type));
  }

  /** Prints a result slip out of a rack. points 0 means the run produced nothing useful. */
  printSlip(rack: Rack, localPos: THREE.Vector3, title: string, lines: string[], report: Report | null) {
    const rows = lines.map((l) => `<div>${l}</div>`).join('');
    const html = `<h1>${title}</h1><div class="meta">${rack.title} rack &middot; day ${G.day}</div>${rows}
      ${report ? `<p style="margin-top:18px">Run ${report.run}. Worth ${report.points} points once it reaches the ground.</p>` : ''}`;
    const slip = makeLetter(title, html, { typed: true, color: '#fbf8ef', report, slip: true });
    const world = localPos.clone().applyMatrix4(rack.group.matrixWorld);
    const out = new THREE.Vector3(0, 0, 1).applyQuaternion(rack.group.quaternion);
    slip.quat.copy(rack.group.quaternion);
    G.items.place(slip, world, out.multiplyScalar(0.25));
    slip.spin.set(0.2, 0.1, 0.3);
    G.audio?.paper();
    return slip;
  }

  /** Called when items reach the ground. Returns a summary for the statement letter. */
  receive(items: Item[]) {
    for (const h of this.sendHooks) h(items);
    const lines: string[] = [];
    let sum = 0;
    for (const it of items) {
      const r = it.data.report as Report | null | undefined;
      if (it.data.report === undefined) continue;
      if (!r || r.points <= 0) {
        lines.push(`<tr><td>${it.name}</td><td>no usable data</td><td>0</td></tr>`);
        continue;
      }
      lines.push(`<tr><td>${r.expTitle}</td><td>run ${r.run}</td><td>${r.points}</td></tr>`);
      sum += r.points;
    }
    this.balance += sum;
    this.totalEarned += sum;
    return { lines, sum };
  }
}

defineItem('film', {
  radius: 0.08,
  build() {
    const g = new THREE.Group();
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 16), new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.4, roughness: 0.4 }));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.02, 16), new THREE.MeshStandardMaterial({ color: 0xd8c020 }));
    cap.position.y = 0.055;
    g.add(can, cap);
    return g;
  },
  label: (item) => `Film canister: ${item.data.caption ?? 'exposed film'}`,
  use: () => G.ui.toast('Exposed film. Opening it here would ruin it.'),
});
