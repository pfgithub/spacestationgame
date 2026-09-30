import { G } from './game';

export class Days {
  sleeping = false;
  /** Callbacks run each night, in order. */
  nightly: (() => void)[] = [];
  /** Callbacks run after waking, e.g. to show letters. */
  morning: (() => void)[] = [];

  canSleep(): string | null {
    if (G.items.held?.kind === 'modkit') return 'Put that down first';
    if (G.eva.suited) return 'Take the spacesuit off first';
    const life = G.life.sleepBlocker();
    if (life) return life;
    return null;
  }

  sleep() {
    const why = this.canSleep();
    if (why) {
      G.ui.toast(why);
      return;
    }
    if (this.sleeping) return;
    this.sleeping = true;
    G.player.frozen = true;
    G.player.vel.set(0, 0, 0);
    G.ui.fade(() => {
      G.day++;
      G.time += 6 * 60;
      G.racks.sleep();
      for (const f of this.nightly) f();
      this.sleeping = false;
      G.player.frozen = false;
      G.ui.toast(`Day ${G.day}. Good morning.`, 4000);
      for (const f of this.morning) f();
    }, 1500);
  }
}
