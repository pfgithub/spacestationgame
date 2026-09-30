import * as THREE from 'three';
import { SPEED_UNIT } from './constants';
import { collideSphere, nearestSurfaceDist } from './physics';
import { G } from './game';

/** Duration of one push. Acceleration follows a smoothstep curve, strongest in the middle of the push. */
const PUSH_T = 0.4;
/** Pause before pushing again while a key is held. A fresh key press never waits. */
const HOLD_PAUSE = 0.35;
const REACH = 2.1;
/** Pitch at which looking further up/down starts tipping the whole reference frame over. */
const PITCH_LIMIT = THREE.MathUtils.degToRad(75);
/** A push stops you instead if it points more than 120 degrees away from the way you're moving. */
const STOP_DOT = -0.5;
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

/** Push keys and the view-relative direction each pushes you in. */
const PUSH_KEYS: [string, [number, number, number]][] = [
  ['KeyW', [0, 0, -1]],
  ['KeyS', [0, 0, 1]],
  ['KeyA', [-1, 0, 0]],
  ['KeyD', [1, 0, 0]],
  ['Space', [0, 1, 0]],
  ['ShiftLeft', [0, -1, 0]],
  ['ShiftRight', [0, -1, 0]],
];

interface Push {
  key: string;
  t: number;
  /** Total velocity change this push applies, spread over its duration. */
  delta: THREE.Vector3;
  eased: number;
}

export class Player {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  /** View orientation. Derived from base/yaw/pitch; setting it from outside re-bases the look. */
  quat = new THREE.Quaternion();
  /**
   * Mouse look works like a normal FPS (yaw then pitch) relative to a base orientation, so circling the mouse never
   * rolls you. Looking beyond the pitch limit rotates the base instead, which lets you loop right over.
   */
  base = new THREE.Quaternion();
  yaw = 0;
  pitch = 0;
  private lastQuat = new THREE.Quaternion();
  radius = 0.3;
  rollVel = 0;
  push: Push | null = null;
  /** Time since the last push ended. */
  idle = 10;
  /** A key whose push brought us to a stop: it won't push again until released. */
  blockedKey: string | null = null;
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

  /**
   * Starts a push for a key. Pushing adds one unit of speed in that direction and cancels motion in every other
   * direction. If we're moving against that direction, the push brings us to a complete stop instead.
   * Starting a push abandons any push still in progress (keeping the speed it has already given).
   */
  private startPush(key: string, local: [number, number, number]) {
    if (!this.canPush()) {
      G.ui.toast('Nothing within reach to push off');
      this.push = null;
      this.idle = 0;
      return;
    }
    const dir = new THREE.Vector3(...local).applyQuaternion(this.quat);
    const along = this.vel.dot(dir);
    const speed = this.vel.length();
    let target: THREE.Vector3;
    if (speed > 0.05 && along / speed < STOP_DOT) {
      target = new THREE.Vector3();
      this.blockedKey = key;
    } else {
      target = dir.multiplyScalar(Math.max(0, along) + SPEED_UNIT);
    }
    this.push = { key, t: 0, delta: target.sub(this.vel), eased: 0 };
    G.audio?.push();
  }

  update(dt: number) {
    const inp = G.input;
    if (this.frozen) return;
    // --- look ---
    if (!this.quat.equals(this.lastQuat)) {
      // someone else set our orientation (loading, scripts): look straight ahead from there
      this.base.copy(this.quat);
      this.yaw = this.pitch = 0;
    }
    this.yaw -= inp.mouseDX * this.mouseSens;
    this.pitch -= inp.mouseDY * this.mouseSens;
    const excess = this.pitch > PITCH_LIMIT ? this.pitch - PITCH_LIMIT : this.pitch < -PITCH_LIMIT ? this.pitch + PITCH_LIMIT : 0;
    if (excess) {
      // tip the reference frame over about the current horizontal axis instead of pitching further
      const yawQ = new THREE.Quaternion().setFromAxisAngle(Y, this.yaw);
      const tip = new THREE.Quaternion().setFromAxisAngle(X, excess);
      this.base.multiply(yawQ).multiply(tip).multiply(yawQ.invert()).normalize();
      this.pitch -= excess;
    }
    let rollTarget = 0;
    if (inp.isDown('KeyQ')) rollTarget += 1.6;
    if (inp.isDown('KeyE')) rollTarget -= 1.6;
    this.rollVel += (rollTarget - this.rollVel) * Math.min(1, dt * 6);
    if (Math.abs(this.rollVel) > 1e-4) {
      // roll about the line of sight
      this.base.premultiply(new THREE.Quaternion().setFromAxisAngle(this.forward, this.rollVel * dt)).normalize();
    }
    this.quat.copy(this.base)
      .multiply(new THREE.Quaternion().setFromAxisAngle(Y, this.yaw))
      .multiply(new THREE.Quaternion().setFromAxisAngle(X, this.pitch));
    this.lastQuat.copy(this.quat);

    // --- pushing ---
    if (this.blockedKey && !inp.isDown(this.blockedKey)) this.blockedKey = null;
    let pressed: (typeof PUSH_KEYS)[number] | null = null;
    let held: (typeof PUSH_KEYS)[number] | null = null;
    for (const entry of PUSH_KEYS) {
      if (inp.wasPressed(entry[0])) pressed = entry;
      if (inp.isDown(entry[0]) && entry[0] !== this.blockedKey && (!held || entry[0] === this.push?.key)) held = entry;
    }
    if (pressed) {
      this.startPush(pressed[0], pressed[1]);
    } else if (!this.push && held && this.idle >= HOLD_PAUSE) {
      this.startPush(held[0], held[1]);
    }
    if (this.push) {
      const p = this.push;
      p.t += dt;
      const k = Math.min(1, p.t / PUSH_T);
      const e = k * k * (3 - 2 * k);
      // apply this frame's share of the push, keeping any other forces (tether, collisions)
      this.vel.addScaledVector(p.delta, e - p.eased);
      p.eased = e;
      if (k >= 1) {
        this.push = null;
        this.idle = 0;
      }
    } else {
      this.idle += dt;
    }

    // --- integrate ---
    this.pos.addScaledVector(this.vel, dt);
    const impact = collideSphere(this.pos, this.vel, this.radius, G.station.boxes());
    if (impact > 0.6) G.audio?.bump(impact);
    if (impact > 0 && this.push) {
      // hit something mid-push: abort the push
      this.push = null;
      this.idle = 0;
    }
  }

  applyCamera(cam: THREE.Camera) {
    cam.position.copy(this.pos);
    cam.quaternion.copy(this.quat);
  }
}
