import * as THREE from 'three';
import { earthTextures } from './textures';

export const EARTH_R = 4000;
export const ALTITUDE = 420;
/** Real orbit is ~92 minutes; we compress it. */
export const ORBIT_PERIOD = 8 * 60;

/**
 * Earth, sun and stars. The station is fixed at the origin and the universe rotates around it:
 * Earth is "below" (-y) and the station flies along -z.
 */
export class World {
  earth: THREE.Mesh;
  clouds: THREE.Mesh;
  atmosphere: THREE.Mesh;
  earthPivot = new THREE.Group();
  sun: THREE.DirectionalLight;
  sunSprite: THREE.Sprite;
  ambient: THREE.AmbientLight;
  stars: THREE.Points;
  sunDir = new THREE.Vector3();
  sunlit = true;
  orbitAngle = 0;

  constructor(scene: THREE.Scene) {
    const tex = earthTextures();
    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_R, 96, 64),
      new THREE.MeshStandardMaterial({ map: tex.color, roughness: 0.9, metalness: 0 }),
    );
    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_R + 6, 96, 64),
      new THREE.MeshStandardMaterial({ map: tex.clouds, transparent: true, depthWrite: false, roughness: 1 }),
    );
    this.atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_R + 60, 96, 64),
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { sunDir: { value: new THREE.Vector3() } },
        vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
        fragmentShader: `uniform vec3 sunDir; varying vec3 vN; varying vec3 vW; void main(){ vec3 V = normalize(cameraPosition - vW); float rim = pow(1. - abs(dot(V, vN)), 3.0); float lit = smoothstep(-0.3, 0.4, dot(-vN, sunDir)); gl_FragColor = vec4(vec3(0.35,0.6,1.0)*rim*lit*1.4, rim*lit); }`,
      }),
    );
    this.earthPivot.position.set(0, -(EARTH_R + ALTITUDE), 0);
    this.earthPivot.add(this.earth, this.clouds, this.atmosphere);
    scene.add(this.earthPivot);

    this.sun = new THREE.DirectionalLight(0xfff6e8, 3.2);
    scene.add(this.sun, this.sun.target);
    const sprCanvas = document.createElement('canvas');
    sprCanvas.width = sprCanvas.height = 128;
    const g = sprCanvas.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.15, 'rgba(255,250,230,1)');
    grad.addColorStop(0.3, 'rgba(255,230,180,0.35)');
    grad.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(sprCanvas), depthWrite: false }));
    this.sunSprite.scale.setScalar(900);
    scene.add(this.sunSprite);

    this.ambient = new THREE.AmbientLight(0x404650, 0.6);
    scene.add(this.ambient);

    const starGeom = new THREE.BufferGeometry();
    const N = 4000;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(15000);
      pos.set([v.x, v.y, v.z], i * 3);
      const b = 0.4 + Math.random() * 0.6;
      col.set([b, b, b * (0.9 + Math.random() * 0.2)], i * 3);
    }
    starGeom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(starGeom, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true }));
    scene.add(this.stars);
  }

  update(time: number) {
    this.orbitAngle = (time / ORBIT_PERIOD) * Math.PI * 2;
    // Earth turns under us (we travel along -z, so the surface moves towards +z)
    // spin axis lies along x (the orbit normal), so we pass over the equator
    this.earth.rotation.set(0, 0, 0);
    this.earth.rotateX(this.orbitAngle);
    this.earth.rotateZ(Math.PI / 2);
    this.clouds.rotation.copy(this.earth.rotation);
    this.clouds.rotateY(time * 0.0004);
    // sun goes round us once per orbit, in the orbit plane (y/z), slightly inclined
    const a = this.orbitAngle + 0.9;
    this.sunDir.set(0.35, Math.cos(a), Math.sin(a)).normalize();
    const earthC = this.earthPivot.position;
    // eclipse test: does the ray from the station toward the sun hit the Earth?
    const oc = earthC.clone().negate();
    const b = oc.dot(this.sunDir);
    const c = oc.lengthSq() - (EARTH_R + 20) ** 2;
    const hit = b * b - c > 0 && b < 0;
    this.sunlit = !hit;
    this.sun.position.copy(this.sunDir).multiplyScalar(100);
    this.sun.intensity = this.sunlit ? 3.2 : 0;
    this.sunSprite.visible = this.sunlit;
    this.sunSprite.position.copy(this.sunDir).multiplyScalar(12000);
    (this.atmosphere.material as THREE.ShaderMaterial).uniforms.sunDir.value.copy(this.sunDir);
  }
}
