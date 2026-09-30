import * as THREE from 'three';

export interface Interactable {
  /** Prompt for the primary action (left click). null = no primary action right now. */
  label?(): string | null;
  use?(): void;
  /** Prompt for the secondary action (right click). */
  altLabel?(): string | null;
  alt?(): void;
  /** Max reach in metres (default 2.6). */
  range?: number;
}

export function setInteract(obj: THREE.Object3D, it: Interactable) {
  obj.userData.it = it;
  return obj;
}

export function findInteract(obj: THREE.Object3D | null): Interactable | null {
  while (obj) {
    if (obj.userData.it) return obj.userData.it as Interactable;
    if (obj.userData.solid === false) return null;
    obj = obj.parent;
  }
  return null;
}
