import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();

function canvasTex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

/** Interior wall panelling. */
export function panelTexture(base: string, line: string) {
  return canvasTex(`panel-${base}-${line}`, 256, 256, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = line;
    g.lineWidth = 3;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      g.strokeRect(i * 128 + 4, j * 128 + 4, 120, 120);
    }
    g.fillStyle = line;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      for (const [a, b] of [[12, 12], [116, 12], [12, 116], [116, 116]]) {
        g.beginPath();
        g.arc(i * 128 + a, j * 128 + b, 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    // subtle noise
    const img = g.getImageData(0, 0, 256, 256);
    for (let k = 0; k < img.data.length; k += 4) {
      const n = (Math.random() - 0.5) * 10;
      img.data[k] += n; img.data[k + 1] += n; img.data[k + 2] += n;
    }
    g.putImageData(img, 0, 0);
  });
}

/** Exterior thermal blanket look. */
export function hullTexture() {
  return canvasTex('hull', 256, 256, (g) => {
    g.fillStyle = '#e9e7df';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 400; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      g.strokeStyle = `rgba(150,150,140,${Math.random() * 0.25})`;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 40);
      g.stroke();
    }
    g.strokeStyle = '#b8b5aa';
    g.lineWidth = 4;
    g.strokeRect(2, 2, 252, 252);
    g.beginPath();
    g.moveTo(128, 0); g.lineTo(128, 256);
    g.moveTo(0, 128); g.lineTo(256, 128);
    g.stroke();
  });
}

export function solarTexture() {
  return canvasTex('solar', 256, 512, (g) => {
    g.fillStyle = '#1b2a55';
    g.fillRect(0, 0, 256, 512);
    g.strokeStyle = '#8a7a45';
    g.lineWidth = 2;
    for (let x = 0; x <= 256; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
    for (let y = 0; y <= 512; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  });
}

/** A text label texture (stencil-style). */
export function labelTexture(text: string, opts: { fg?: string; bg?: string; w?: number; h?: number; font?: string } = {}) {
  const w = opts.w ?? 256, h = opts.h ?? 64;
  return canvasTex(`label-${text}-${opts.fg}-${opts.bg}-${w}-${h}-${opts.font}`, w, h, (g) => {
    if (opts.bg) {
      g.fillStyle = opts.bg;
      g.fillRect(0, 0, w, h);
    }
    g.fillStyle = opts.fg ?? '#222';
    g.font = opts.font ?? `bold ${Math.floor(h * 0.6)}px monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const lines = text.split('\n');
    const lh = h / lines.length;
    lines.forEach((l, i) => g.fillText(l, w / 2, lh * (i + 0.5)));
  });
}

export function labelMesh(text: string, width: number, height: number, opts: { fg?: string; bg?: string; px?: number } = {}) {
  const px = opts.px ?? 128;
  const tex = labelTexture(text, { fg: opts.fg, bg: opts.bg, w: Math.round(px * width / height), h: px });
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: !opts.bg, depthWrite: !!opts.bg });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  return m;
}

// ---- value noise for the planet ----
function hash(x: number, y: number, s: number) {
  let h = x * 374761393 + y * 668265263 + s * 982451653;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x: number, y: number, s: number, wrap: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const X0 = ((xi % wrap) + wrap) % wrap, X1 = (X0 + 1) % wrap;
  const a = hash(X0, yi, s), b = hash(X1, yi, s), c = hash(X0, yi + 1, s), d = hash(X1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, s: number, wrap: number, oct = 6) {
  let sum = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x * f, y * f, s + i, wrap * f);
    amp *= 0.5;
    f *= 2;
  }
  return sum;
}

const EW = 1024, EH = 512, EF = 8;

export type Terrain = 'ocean' | 'coast' | 'desert' | 'forest' | 'ice';

/** Terrain at a texel of the Earth texture (x in 0..EW, y in 0..EH). */
export function terrainAt(x: number, y: number): { t: Terrain; rgb: [number, number, number] } {
  const lat = Math.abs(y / EH - 0.5) * 2;
  const nx = (x / EW) * EF, ny = (y / EH) * EF * 0.5;
  const e = fbm(nx, ny, 1, EF) - 0.08 * lat;
  if (lat > 0.88) return { t: 'ice', rgb: [235, 240, 245] };
  if (e < 0.5) {
    const depth = (0.5 - e) * 2;
    return { t: 'ocean', rgb: [10 + 20 * (1 - depth), 40 + 60 * (1 - depth), 90 + 80 * (1 - depth)] };
  }
  if (e < 0.52) return { t: 'coast', rgb: [190, 180, 130] };
  const dry = fbm(nx + 50, ny, 7, EF, 4);
  const hh = (e - 0.5) * 3;
  let rgb: [number, number, number];
  let t: Terrain;
  if (dry > 0.55 && lat < 0.5) { rgb = [190 - hh * 40, 160 - hh * 40, 100 - hh * 30]; t = 'desert'; }
  else { rgb = [50 + hh * 60, 100 + hh * 30, 40 + hh * 30]; t = 'forest'; }
  if (lat > 0.7) { rgb = [rgb[0] * 0.5 + 110, rgb[1] * 0.5 + 110, rgb[2] * 0.5 + 110]; t = 'ice'; }
  return { t, rgb };
}

/** Cloud cover 0..1 at a texel. */
export function cloudAt(x: number, y: number) {
  const nx = (x / EW) * EF, ny = (y / EH) * EF * 0.5;
  const cl = fbm(nx * 1.3 + 13, ny * 1.3, 42, Math.round(EF * 1.3));
  return Math.max(0, Math.min(1, (cl - 0.5) * 4));
}

export function earthTextures() {
  const W = EW, H = EH;
  const color = document.createElement('canvas');
  color.width = W; color.height = H;
  const cg = color.getContext('2d')!;
  const ci = cg.createImageData(W, H);
  const clouds = document.createElement('canvas');
  clouds.width = W; clouds.height = H;
  const kg = clouds.getContext('2d')!;
  const ki = kg.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4;
      const { rgb } = terrainAt(x, y);
      ci.data[k] = rgb[0]; ci.data[k + 1] = rgb[1]; ci.data[k + 2] = rgb[2]; ci.data[k + 3] = 255;
      ki.data[k] = 255; ki.data[k + 1] = 255; ki.data[k + 2] = 255; ki.data[k + 3] = cloudAt(x, y) * 255;
    }
  }
  cg.putImageData(ci, 0, 0);
  kg.putImageData(ki, 0, 0);
  const ct = new THREE.CanvasTexture(color);
  ct.colorSpace = THREE.SRGBColorSpace;
  const kt = new THREE.CanvasTexture(clouds);
  kt.colorSpace = THREE.SRGBColorSpace;
  return { color: ct, clouds: kt };
}
