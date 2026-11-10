/*
 * Renderer abstraction: WebGL2 (verified path) with WebGPU opt-in.
 * Owns the Three.js scene graph, camera, shadow config, and quality tiers.
 *
 * ADR-001: WebGL2 is the default and the only path we claim to have measured.
 * WebGPU is exposed behind a settings toggle labelled experimental; if it fails
 * to initialise we fall back and record the event for Diagnostics.
 */

import * as THREE from 'three';
import type { GraphicsSettings, QualityTable } from '../settings/settings';

export type RendererBackend = 'webgl2' | 'webgpu';

export interface RendererStats {
  drawCalls: number;
  triangles: number;
  programs: number;
  geometries: number;
  textures: number;
  backend: RendererBackend;
}

export class Renderer {
  readonly app: THREE.WebGLRenderer | null = null;
  readonly canvas: HTMLCanvasElement;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Dedicated camera for the first-person viewmodel (narrow FOV, own layer). */
  readonly viewCamera: THREE.PerspectiveCamera;
  static readonly VIEWMODEL_LAYER = 1;
  renderScale = 1;
  backend: RendererBackend = 'webgl2';
  private stats: RendererStats = {
    drawCalls: 0, triangles: 0, programs: 0, geometries: 0, textures: 0, backend: 'webgl2',
  };
  private resizeHandler: () => void;

  constructor(container: HTMLElement, settings: GraphicsSettings, private onEvent: (msg: string) => void) {
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 4000);
    this.camera.rotation.order = 'YXZ';
    this.viewCamera = new THREE.PerspectiveCamera(55, 1, 0.01, 12);
    this.viewCamera.rotation.order = 'YXZ';
    this.viewCamera.layers.set(Renderer.VIEWMODEL_LAYER);
    // The viewmodel is parented to this camera, and Three.js only traverses
    // objects reachable from the scene root. Without this line the weapon is
    // never drawn at all. (The camera itself renders nothing; the second pass
    // nulls scene.background so it cannot wipe the world pass.)
    this.scene.add(this.viewCamera);

    let renderer: THREE.WebGLRenderer | null = null;
    let backend: RendererBackend = 'webgl2';
    try {
      if (settings.rendererBackend === 'webgpu' && ('gpu' in navigator)) {
        // WebGPU path is intentionally opt-in. If any part of init throws we
        // fall back to WebGL2 rather than shipping a blank screen.
        const THREE_WGPU = (THREE as unknown as { WebGPURenderer?: new (o: object) => THREE.WebGLRenderer }).WebGPURenderer;
        if (THREE_WGPU) {
          renderer = new THREE_WGPU({
            canvas: this.canvas,
            antialias: settings.antialias,
            powerPreference: 'high-performance',
          });
          backend = 'webgpu';
          this.onEvent('WebGPU backend initialised (experimental)');
        }
      }
    } catch {
      this.onEvent('WebGPU initialisation failed - fell back to WebGL2');
      backend = 'webgl2';
      renderer = null;
    }

    if (!renderer) {
      renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: settings.antialias,
        powerPreference: 'high-performance',
        stencil: false,
        // Required so the canvas keeps its contents between the render call and
        // the browser's composite/screenshot step. Without it the drawing buffer
        // is cleared after compositing and the canvas can appear blank.
        preserveDrawingBuffer: true,
      });
    }
    this.app = renderer;
    this.backend = backend;
    this.ensureDrawingBuffer(settings);

    this.scene.background = new THREE.Color(0x15181c);
    // Fog starts well beyond the objective distance so the village is readable
    // from the spawn point; it only softens the far horizon.
    this.scene.fog = new THREE.Fog(0x9aa0a8, 260, 1400);

    this.resizeHandler = () => this.resize();
    window.addEventListener('resize', this.resizeHandler);
    this.resize();
  }

  private ensureDrawingBuffer(s: GraphicsSettings): void {
    const r = this.app;
    if (!r) return;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = s.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.shadowMap.needsUpdate = true;
  }

  applyQuality(q: QualityTable, s: GraphicsSettings): void {
    this.renderScale = q.renderScale;
    const r = this.app;
    if (!r) return;
    r.shadowMap.enabled = s.shadows;
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = w / h;
    this.viewCamera.updateProjectionMatrix();
    if (this.app) this.app.setSize(w, h, false);
  }

  setFov(deg: number): void {
    this.camera.fov = deg;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    if (!this.app) return;
    const info = this.app.info;
    // Accumulate stats across BOTH passes: the second pass would otherwise
    // reset the counters and the profiler would always read zero.
    info.autoReset = false;
    info.reset();
    // Pass 1: the world, on the main camera (viewmodel layer excluded).
    // The world camera must see layer 0 (world geometry) AND layer 2 (the
    // scene lights). `layers.set(0)` alone made the camera blind to every
    // light, which is why the whole world rendered as black silhouettes.
    this.camera.layers.enable(0);
    this.camera.layers.enable(2);
    this.app.autoClear = true;
    this.app.render(this.scene, this.camera);
    // Pass 2: the viewmodel, on its own camera, depth cleared so it never clips.
    // scene.background is painted on EVERY render() call regardless of
    // autoClear, so it must be detached for the second pass or it wipes the
    // world we just drew.
    const bg = this.scene.background;
    this.scene.background = null;
    this.viewCamera.position.copy(this.camera.position);
    this.viewCamera.quaternion.copy(this.camera.quaternion);
    this.app.autoClear = false;
    this.app.clearDepth();
    this.app.render(this.scene, this.viewCamera);
    this.scene.background = bg;
    this.app.autoClear = true;
    this.stats.drawCalls = info.render.calls;
    this.stats.triangles = info.render.triangles;
    this.stats.programs = info.programs?.length ?? 0;
    this.stats.geometries = info.memory.geometries;
    this.stats.textures = info.memory.textures;
    this.stats.backend = this.backend;
  }

  getStats(): RendererStats {
    return { ...this.stats };
  }

  dispose(): void {
    window.removeEventListener('resize', this.resizeHandler);
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.app?.dispose();
    this.canvas.remove();
  }
}

/** Reusable material cache so textures load once and share across meshes. */
const materialCache = new Map<string, THREE.Material>();
export function sharedMaterial(key: string, make: () => THREE.Material): THREE.Material {
  let m = materialCache.get(key);
  if (!m) {
    m = make();
    materialCache.set(key, m);
  }
  return m;
}
