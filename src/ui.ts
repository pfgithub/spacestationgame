import { G } from './game';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

export class UI {
  root: HTMLElement;
  prompt: HTMLElement;
  toasts: HTMLElement;
  status: HTMLElement;
  overlay: HTMLElement;
  pause: HTMLElement;
  fadeEl: HTMLElement;
  vignette: HTMLElement;
  overlayOpen = false;
  private onClose: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    el('div', 'crosshair', this.root);
    this.prompt = el('div', 'prompt', this.root);
    this.toasts = el('div', 'toasts', this.root);
    this.status = el('div', 'status', this.root);
    this.vignette = el('div', 'vignette', this.root);
    this.fadeEl = el('div', 'fade', parent);
    this.overlay = el('div', 'overlay hidden', parent);
    this.pause = el('div', 'pause', parent);
    this.pause.innerHTML = `
      <h1>ORBITAL</h1>
      <p class="sub">a quiet life aboard a small space station</p>
      <div class="keys">
        <div><b>Mouse</b> look</div>
        <div><b>W A S D</b> push off forwards / left / back / right</div>
        <div><b>Space / Shift</b> push off up / down</div>
        <div><b></b> pushing back against your motion stops you</div>
        <div><b>Q / E</b> roll</div>
        <div><b>Left click</b> use</div>
        <div><b>Right click</b> grab / place / let go</div>
        <div><b>R</b> read the paper you are holding</div>
        <div><b>T</b> clip tether (spacewalk) &nbsp; <b>F</b> (hold) reel in tether</div>
      </div>
      <p class="go">Click to continue</p>
      <p class="saved">The game saves itself every morning.</p>
      <button class="fresh">Start over</button>`;
    this.pause.addEventListener('click', () => G.input.lock());
    this.pause.querySelector('.fresh')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('Abandon this station and start again from day 1?')) {
        window.onbeforeunload = null;
        G.resetting = true;
        location.search = '?fresh';
      }
    });
    window.addEventListener('keydown', (e) => {
      if (!this.overlayOpen) return;
      if (e.code === 'Escape' || e.code === 'KeyR' || e.code === 'Tab') {
        e.preventDefault();
        this.closeOverlay();
      }
    });
  }

  setPrompt(primary: string | null, secondary: string | null) {
    const parts: string[] = [];
    if (primary) parts.push(`<span class="btn">LMB</span> ${primary}`);
    if (secondary) parts.push(`<span class="btn">RMB</span> ${secondary}`);
    this.prompt.innerHTML = parts.join('<br>');
  }

  toast(msg: string, ms = 2600) {
    const last = this.toasts.lastElementChild as HTMLElement | null;
    if (last && last.dataset.msg === msg) return;
    const t = el('div', 'toast', this.toasts);
    t.dataset.msg = msg;
    t.textContent = msg;
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 600);
  }

  setStatus(html: string) {
    if (this.status.innerHTML !== html) this.status.innerHTML = html;
  }

  /** Shows arbitrary content in a modal overlay. */
  openOverlay(content: HTMLElement, onClose?: () => void) {
    this.overlay.innerHTML = '';
    this.overlay.appendChild(content);
    const close = el('button', 'close', this.overlay);
    close.textContent = 'Done  [Esc]';
    close.addEventListener('click', () => this.closeOverlay());
    this.overlay.classList.remove('hidden');
    this.overlayOpen = true;
    this.onClose = onClose ?? null;
    G.input.enabled = false;
    document.exitPointerLock?.();
    G.audio?.paper();
  }

  closeOverlay() {
    if (!this.overlayOpen) return;
    this.overlay.classList.add('hidden');
    this.overlayOpen = false;
    G.input.enabled = true;
    G.input.pressed.clear();
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
    G.input.lock();
  }

  /** Fades to black, runs fn, fades back. */
  fade(fn: () => void, holdMs = 1200) {
    this.fadeEl.classList.add('on');
    setTimeout(() => {
      fn();
      setTimeout(() => this.fadeEl.classList.remove('on'), holdMs);
    }, 900);
  }

  update() {
    this.pause.style.display = !G.input.locked && !this.overlayOpen ? 'flex' : 'none';
  }
}
