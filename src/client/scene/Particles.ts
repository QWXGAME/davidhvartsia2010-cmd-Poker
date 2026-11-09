// Точечные частицы одним draw call: дым, пыль в луче. Размер в метрах, альфа и поворот на частицу.

import * as THREE from 'three';

export interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  size: number; alpha: number; rot: number; life: number; seed: number;
}

export class Particles {
  readonly points: THREE.Points;
  readonly list: P[] = [];
  private pos: Float32Array;
  private aux: Float32Array;
  private geo: THREE.BufferGeometry;
  readonly material: THREE.ShaderMaterial;

  constructor(count: number, o: { additive?: boolean; color: THREE.Color; texture: THREE.Texture }) {
    this.pos = new Float32Array(count * 3);
    this.aux = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.list.push({ x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, size: 0.05, alpha: 0, rot: 0, life: 0, seed: Math.random() });
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aux', new THREE.BufferAttribute(this.aux, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: o.texture },
        color: { value: o.color },
        scale: { value: 800 },
        fogColor: { value: new THREE.Color(0x050203) },
        fogDensity: { value: 0.0 },
      },
      vertexShader: /* glsl */`
        attribute vec3 aux; // size, alpha, rot
        uniform float scale;
        varying float vAlpha; varying float vRot; varying float vDepth;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aux.x * scale / -mv.z;
          vAlpha = aux.y; vRot = aux.z; vDepth = -mv.z;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform vec3 color; uniform vec3 fogColor; uniform float fogDensity;
        varying float vAlpha; varying float vRot; varying float vDepth;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float s = sin(vRot), k = cos(vRot);
          vec2 uv = vec2(k * c.x - s * c.y, s * c.x + k * c.y) + 0.5;
          vec4 t = texture2D(map, uv);
          float fog = 1.0 - exp(-fogDensity * fogDensity * vDepth * vDepth);
          gl_FragColor = vec4(mix(color, fogColor, fog), t.a * vAlpha * (1.0 - fog));
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
  }

  forEach(fn: (p: P, i: number) => void) { this.list.forEach(fn); }

  commit() {
    const { pos, aux } = this;
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i];
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      aux[i * 3] = p.size; aux[i * 3 + 1] = p.alpha; aux[i * 3 + 2] = p.rot;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aux as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Пересчёт пиксельного масштаба при ресайзе: высота вьюпорта / (2·tan(fov/2)) */
  setScale(viewportHeightPx: number, fovDeg: number) {
    this.material.uniforms.scale.value = viewportHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }
}
