import * as THREE from 'three';
import { SPEED_UNIT } from './constants';
import { collideSphere, nearestSurfaceDist } from './physics';
import { G } from './game';

/** Duration of the "push" part of a push-off cycle. */
const PUSH_T = 0.4;
/** Pause between cycles while the key is held (tapping lets you push again sooner). */
const HOLD_PAUSE = 0.55;
/** Minimum pause before a fresh key press can start another cycle. */
const TAP_PAUSE = 0.12;
const REACH = 2.1;

type CycleKind = 'fwd' | 'back';

interface Cycle {
  kind: CycleKind;
  t: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

export class Player {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  quat = new THREE.Quaternion();
  radius = 0.3;
  rollVel = 0;
  cycle: Cycle | null = null;
  /** Time since the last cycle ended. */
  idle = 10;
  /** A key press that arrived while a cycle was still running. */
  queued: CycleKind | null = null;
  lastKind: CycleKind | null = null;
  /** Set when an S-cycle brought us to a stop, so the next held cycle reverses. */
  stopped = false;
  frozen = false;
  /** Extra velocity sources (tether) add here. */
  mouseSens = 0.0022;

  get forward() {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
  }
  get up() {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
  }
  get right() {
    return new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
  }

  canPush() {
    return nearestSurfaceDist(this.pos, G.station.boxes()) < REACH;
  }

  private startCycle(kind: CycleKind, held: boolean) {
    // holding only differs from tapping by the longer pause between cycles
    const f = this.forward;
    const fs = this.vel.dot(f);
    let to: THREE.Vector3;
    if (!this.canPush()) {
      G.ui.toast('Nothing within reach to push off');
      this.idle = 0;
      return;
    }
    if (kind === 'fwd') {
      // every push adds one unit of speed along the view direction; there is no cap
      to = this.vel.clone().addScaledVector(f, SPEED_UNIT);
      this.stopped = false;
    } else if (this.vel.length() > 0.02 && !(held && this.stopped && fs < 0)) {
      // grab and slow down by up to one unit per cycle
      const sp = this.vel.length();
      to = this.vel.clone().multiplyScalar(Math.max(0, sp - SPEED_UNIT) / sp);
      if (to.lengthSq() === 0) this.stopped = true;
    } else {
      // already stopped (or already backing up while holding): push backwards
      to = this.vel.clone().addScaledVector(f, -SPEED_UNIT);
      this.stopped = true;
    }
    this.cycle = { kind, t: 0, from: this.vel.clone(), to };
    this.lastKind = kind;
    G.audio?.push();
  }

  update(dt: number) {
    const inp = G.input;
    if (this.frozen) return;
    // --- look ---
    const yaw = -inp.mouseDX * this.mouseSens;
    const pitch = -inp.mouseDY * this.mouseSens;
    let rollTarget = 0;
    if (inp.isDown('KeyQ')) rollTarget += 1.6;
    if (inp.isDown('KeyE')) rollTarget -= 1.6;
    this.rollVel += (rollTarget - this.rollVel) * Math.min(1, dt * 6);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, this.rollVel * dt, 'YXZ'));
    this.quat.multiply(q).normalize();

    // --- push-off cycles ---
    const wDown = inp.isDown('KeyW'), sDown = inp.isDown('KeyS');
    if (inp.wasPressed('KeyW')) this.queued = 'fwd';
    if (inp.wasPressed('KeyS')) this.queued = 'back';
    if (this.cycle) {
      const c = this.cycle;
      c.t += dt;
      const k = Math.min(1, c.t / PUSH_T);
      const e = k * k * (3 - 2 * k);
      // follow the planned velocity profile, while keeping any externally applied changes
      this.vel.copy(c.from).lerp(c.to, e);
      if (k >= 1) {
        this.cycle = null;
        this.idle = 0;
      }
    } else {
      this.idle += dt;
      if (this.queued && this.idle >= TAP_PAUSE) {
        const kind = this.queued;
        this.queued = null;
        this.startCycle(kind, false);
      } else if (this.idle >= HOLD_PAUSE && (wDown || sDown)) {
        const kind: CycleKind = wDown ? 'fwd' : 'back';
        this.startCycle(kind, kind === this.lastKind);
      }
    }
    if (!sDown && !wDown && !this.cycle) this.stopped = this.vel.length() < 0.05;

    // --- integrate ---
    this.pos.addScaledVector(this.vel, dt);
    const impact = collideSphere(this.pos, this.vel, this.radius, G.station.boxes());
    if (impact > 0.6) G.audio?.bump(impact);
    if (impact > 0 && this.cycle) {
      // hit something mid-push: abort the push
      this.cycle = null;
      this.idle = 0;
    }
  }

  applyCamera(cam: THREE.Camera) {
    cam.position.copy(this.pos);
    cam.quaternion.copy(this.quat);
  }
}
