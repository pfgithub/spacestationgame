export class Input {
  down = new Set<string>();
  pressed = new Set<string>();
  released = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  clicks = new Set<number>();
  locked = false;
  /** When false, game keys are ignored (e.g. while reading a document). */
  enabled = true;

  /** ?test in the URL fakes pointer lock so the game can be driven by scripts. */
  testMode = new URLSearchParams(location.search).has('test');

  constructor(private canvas: HTMLElement) {
    if (this.testMode) this.locked = true;
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      const k = e.code;
      if (!this.down.has(k)) this.pressed.add(k);
      this.down.add(k);
      if (['Tab', 'Space'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.clicks.add(e.button);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = this.testMode || document.pointerLockElement === this.canvas;
      if (!this.locked) this.down.clear();
    });
  }

  lock() {
    this.canvas.requestPointerLock?.();
  }

  isDown(k: string) {
    return this.enabled && this.down.has(k);
  }
  wasPressed(k: string) {
    return this.enabled && this.pressed.has(k);
  }
  clicked(b: number) {
    return this.enabled && this.clicks.has(b);
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.clicks.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}
