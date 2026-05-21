import { loadCreatePointcloudEngine } from './loadEngineFactory';
import logoPiantalaUrl from '../logo piantala.png';
import type {
  PointcloudEngine,
  PointcloudEngineOptions
} from './pointcloudEngineTypes';

const FILE_MODEL_EXTENSIONS = new Set(['obj', 'glb']);
const URL_MODEL_EXTENSIONS = new Set(['obj', 'glb', 'gltf']);
const MODEL_SCALE = 0.72;
const SPAWN_SLOTS_PER_RING = 8;
const SPAWN_RING_STEP = 1.05;
const SPAWN_MIN_DISTANCE_XY = 1.25;
const SPAWN_CANDIDATE_LIMIT = 240;
const SPAWN_DEPTH_LAYERS = [1.7, 1.1, 0.4, -0.2, -0.75] as const;
const DEPTH_FOG_COLOR = '#000000';
const UPRIGHT_ROTATION = { x: -Math.PI / 2, y: 0, z: 0 };
const WIND_UPDATE_FPS = 24;
const WIND_INTERVAL_MIN_MS = 6800;
const WIND_INTERVAL_MAX_MS = 15200;
const WIND_GUST_DURATION_MIN_MS = 1800;
const WIND_GUST_DURATION_MAX_MS = 3600;
const WIND_BASE_AMPLITUDE = 1.6;
const WIND_GUST_MIN = 0.4;
const WIND_GUST_MAX = 1.4;

interface WindGustState {
  nextAtMs: number;
  activeFromMs: number;
  durationMs: number;
  peakStrength: number;
}

export interface ViewDebugOptions {
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

export const DEFAULT_VIEW_DEBUG: ViewDebugOptions = {
  cameraX: 0,
  cameraY: 0,
  cameraZ: 8.8,
  targetX: 0,
  targetY: 0,
  targetZ: 0
};

export type EngineRuntimeOptions = Pick<
  PointcloudEngineOptions,
  | 'pointDensity'
  | 'pointSize'
  | 'exposure'
  | 'saturation'
  | 'autoRotate'
  | 'bloomEnabled'
  | 'bloomStrength'
  | 'bloomRadius'
  | 'bloomThreshold'
>;

export interface PointcloudAdapterOptions {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  initialOptions?: Partial<PointcloudEngineOptions>;
}

export interface PointcloudStats {
  totalPoints: number;
  modelCount: number;
  activeModelId?: string;
}

function getExtension(source: string): string {
  const cleanSource = source.toLowerCase().trim();
  const dotIndex = cleanSource.lastIndexOf('.');

  if (dotIndex < 0 || dotIndex === cleanSource.length - 1) {
    return '';
  }

  return cleanSource.slice(dotIndex + 1);
}

function getUrlExtension(url: string): string {
  const trimmedUrl = url.trim();

  try {
    const parsed = new URL(
      trimmedUrl,
      typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    );
    return getExtension(parsed.pathname);
  } catch {
    return getExtension(trimmedUrl.split('?')[0]?.split('#')[0] ?? trimmedUrl);
  }
}

function buildModelId(source: string): string {
  const normalized = source
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  const base = normalized || 'model';
  const token = Math.random().toString(36).slice(2, 8);
  return `${base}-${token}`;
}

function normalizeEngineError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return new Error(error.message || fallback);
  }

  return new Error(fallback);
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class PointcloudEngineAdapter {
  private readonly engine: PointcloudEngine;

  private readonly stage: HTMLElement;

  private spawnIndex = 0;

  private readonly modelSpawnPositions = new Map<string, { x: number; y: number; z: number }>();

  private viewDebug: ViewDebugOptions = { ...DEFAULT_VIEW_DEBUG };

  private titleSprite: {
    position: { z: number; set: (x: number, y: number, z: number) => void };
    scale: { set: (x: number, y: number, z: number) => void };
  } | null = null;

  private titleSpriteAspect = 512 / 2048;

  private depthShadedMaterial: {
    uniforms?: Record<string, { value: number }>;
    vertexShader?: string;
    fragmentShader?: string;
    needsUpdate?: boolean;
    userData?: Record<string, unknown>;
  } | null = null;

  private windRafId: number | null = null;

  private windLastStepMs = 0;

  private readonly windStepMs = 1000 / WIND_UPDATE_FPS;

  private windGust: WindGustState = {
    nextAtMs: 0,
    activeFromMs: 0,
    durationMs: 0,
    peakStrength: 0
  };

  private disposed = false;

  private constructor(engine: PointcloudEngine, stage: HTMLElement) {
    this.engine = engine;
    this.stage = stage;
    this.syncSize();
  }

  static async create({
    canvas,
    stage,
    initialOptions
  }: PointcloudAdapterOptions): Promise<PointcloudEngineAdapter> {
    const createPointcloudEngine = await loadCreatePointcloudEngine();

    const engine = createPointcloudEngine({
      canvas,
      stage,
      autostart: true,
      pointDensity: 1,
      pointSize: 0.01,
      autoRotate: false,
      bloomEnabled: false,
      bloomStrength: 0,
      bloomRadius: 0,
      bloomThreshold: 0.55,
      randomPlacementRange: 5,
      randomPlacementPadding: 1.6,
      randomPlacementAttempts: 200,
      background: '#201203',
      ...initialOptions
    });

    const adapter = new PointcloudEngineAdapter(engine, stage);
    adapter.applyFrontCameraPose();
    adapter.lockCameraInteraction();
    await adapter.add3dLogo(logoPiantalaUrl);
    return adapter;
  }

  getModelIds(): string[] {
    return this.engine.getModelIds();
  }

  getStats(): PointcloudStats {
    return this.engine.getStats();
  }

  private async add3dLogo(imageUrl: string): Promise<void> {
    const scene = (this.engine as any).scene;
    if (!scene) {
      return;
    }

    const THREE = await import('three');

    const loader = new THREE.TextureLoader();
    let texture: import('three').Texture | null = null;
    try {
      texture = await new Promise<import('three').Texture>((resolve, reject) => {
        loader.load(
          imageUrl,
          (loadedTexture: import('three').Texture) => resolve(loadedTexture),
          undefined,
          (error: unknown) => reject(error)
        );
      });
    } catch {
      await this.add3dTitle('PIANTALA 2028');
      return;
    }

    if (!texture) {
      await this.add3dTitle('PIANTALA 2028');
      return;
    }

    texture.needsUpdate = true;

    const image = texture.image as { width?: number; height?: number } | undefined;
    if (image?.width && image?.height) {
      this.titleSpriteAspect = image.height / image.width;
    }

    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: true,
      depthWrite: false
    });

    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.set(0, 0, 0.1);

    scene.add(sprite);
    this.titleSprite = sprite;
    this.updateDepthAtmosphere();
    this.updateTitleScale();
  }

  private async add3dTitle(text: string): Promise<void> {
    const scene = (this.engine as any).scene;
    if (!scene) {
      return;
    }

    const THREE = await import('three');

    this.titleSpriteAspect = 512 / 2048;

    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 512;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(240, 240, 240)';
    ctx.font = '700 220px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: true,
      depthWrite: false
    });

    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.set(0, 0, 0.1);

    scene.add(sprite);
    this.titleSprite = sprite;
    this.updateDepthAtmosphere();
    this.updateTitleScale();
  }

  private updateDepthAtmosphere(): void {
    const scene = (this.engine as any).scene;
    const camera = (this.engine as any).camera;
    const fog = scene?.fog;

    if (!fog || !camera?.position) {
      return;
    }

    const cameraDistance = Math.max(4, Math.abs(camera.position.z ?? this.viewDebug.cameraZ));
    const near = Math.max(1.2, cameraDistance - 1.4);
    const far = near + 1.8;

    fog.near = near;
    fog.far = far;

    if (typeof fog.color?.set === 'function') {
      fog.color.set(DEPTH_FOG_COLOR);
    }

    this.updateDepthPointShading(cameraDistance);
  }

  private ensureDepthPointShading(): void {
    if (this.depthShadedMaterial) {
      return;
    }

    const scene = (this.engine as any).scene;
    if (!scene || typeof scene.traverse !== 'function') {
      return;
    }

    scene.traverse((object: any) => {
      if (this.depthShadedMaterial) {
        return;
      }

      const material = object?.material;
      if (!material || typeof material !== 'object') {
        return;
      }

      if (material.userData?.depthShadingPatched) {
        this.depthShadedMaterial = material;
        this.patchWindInPointMaterial(material);
        return;
      }

      if (
        typeof material.vertexShader !== 'string' ||
        typeof material.fragmentShader !== 'string' ||
        !material.uniforms?.uExposure ||
        !material.uniforms?.uSaturation
      ) {
        return;
      }

      material.uniforms.uDepthDarkNear = { value: 7.1 };
      material.uniforms.uDepthDarkFar = { value: 8.9 };
      material.uniforms.uDepthDarkStrength = { value: 0.94 };

      material.vertexShader = material.vertexShader
        .replace(
          'varying vec3 vColor;',
          'varying vec3 vColor;\n\t\t\tvarying float vViewDepth;'
        )
        .replace('vColor = color;', 'vColor = color;\n\t\t\tvViewDepth = -mvPosition.z;');

      material.fragmentShader = material.fragmentShader
        .replace(
          'varying vec3 vColor;',
          'varying vec3 vColor;\n\t\t\tvarying float vViewDepth;\n\t\t\tuniform float uDepthDarkNear;\n\t\t\tuniform float uDepthDarkFar;\n\t\t\tuniform float uDepthDarkStrength;'
        )
        .replace(
          'vec3 displayColor = pow(max(saturatedColor * uExposure, vec3(0.0)), vec3(1.0 / 2.2));',
          'float depthFactor = smoothstep(uDepthDarkNear, uDepthDarkFar, vViewDepth);\n\t\t\tfloat depthLight = mix(1.0, 1.0 - uDepthDarkStrength, depthFactor);\n\t\t\tvec3 displayColor = pow(max(saturatedColor * uExposure * depthLight, vec3(0.0)), vec3(1.0 / 2.2));'
        );

      material.needsUpdate = true;
      material.userData = {
        ...(material.userData ?? {}),
        depthShadingPatched: true
      };

      this.patchWindInPointMaterial(material);
      this.depthShadedMaterial = material;
    });
  }

  private patchWindInPointMaterial(material: {
    uniforms?: Record<string, { value: number }>;
    vertexShader?: string;
    needsUpdate?: boolean;
    userData?: Record<string, unknown>;
  }): void {
    if (
      typeof material.vertexShader !== 'string' ||
      !material.uniforms
    ) {
      return;
    }

    if (material.userData?.windVertexPatched) {
      return;
    }

    material.uniforms.uWindTime = { value: 0 };
    material.uniforms.uWindAmplitude = { value: WIND_BASE_AMPLITUDE };
    material.uniforms.uWindGust = { value: 0 };

    material.vertexShader = material.vertexShader
      .replace(
        'attribute vec3 color;',
        'attribute vec3 color;\n\t\t\tuniform float uWindTime;\n\t\t\tuniform float uWindAmplitude;\n\t\t\tuniform float uWindGust;'
      )
      .replace(
        'vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
        'float pointSeed = fract(sin(dot(position.xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);\n\t\t\tfloat gust = 1.0 + uWindGust;\n\t\t\tfloat heightMask = smoothstep(-0.2, 1.0, position.z);\n\t\t\tfloat micro = sin(uWindTime * (1.3 + pointSeed * 1.8) + position.x * 5.4 + position.y * 2.8) * 0.0045;\n\t\t\tvec3 animatedPosition = position;\n\t\t\tanimatedPosition.x += (sin(uWindTime * 0.85 + position.y * 2.2) * 0.017 + micro) * uWindAmplitude * heightMask * gust;\n\t\t\tanimatedPosition.y += cos(uWindTime * 0.62 + position.x * 1.6 + pointSeed * 6.2831) * 0.01 * uWindAmplitude * heightMask * gust;\n\t\t\tvec4 mvPosition = modelViewMatrix * vec4(animatedPosition, 1.0);'
      );

    material.needsUpdate = true;
    material.userData = {
      ...(material.userData ?? {}),
      windVertexPatched: true
    };
  }

  private updateDepthPointShading(cameraDistance?: number): void {
    this.ensureDepthPointShading();

    const material = this.depthShadedMaterial;
    if (!material?.uniforms) {
      return;
    }

    const distance = cameraDistance ?? Math.max(4, Math.abs(this.viewDebug.cameraZ));
    const near = Math.max(6.4, distance - 1.2);
    const far = near + 1.25;

    if (material.uniforms.uDepthDarkNear) {
      material.uniforms.uDepthDarkNear.value = near;
    }

    if (material.uniforms.uDepthDarkFar) {
      material.uniforms.uDepthDarkFar.value = far;
    }

    if (material.uniforms.uDepthDarkStrength) {
      material.uniforms.uDepthDarkStrength.value = 0.94;
    }
  }

  private initWindSchedule(nowMs: number): void {
    this.windGust = {
      nextAtMs: nowMs + randomBetween(WIND_INTERVAL_MIN_MS, WIND_INTERVAL_MAX_MS),
      activeFromMs: 0,
      durationMs: 0,
      peakStrength: 0
    };
  }

  private getGustMultiplier(nowMs: number): number {
    const gust = this.windGust;

    if (!gust.nextAtMs) {
      this.initWindSchedule(nowMs);
    }

    if (!gust.activeFromMs && nowMs >= gust.nextAtMs) {
      gust.activeFromMs = nowMs;
      gust.durationMs = randomBetween(WIND_GUST_DURATION_MIN_MS, WIND_GUST_DURATION_MAX_MS);
      gust.peakStrength = randomBetween(WIND_GUST_MIN, WIND_GUST_MAX);
    }

    if (!gust.activeFromMs || !gust.durationMs) {
      return 0;
    }

    const progress = (nowMs - gust.activeFromMs) / gust.durationMs;
    if (progress >= 1) {
      gust.activeFromMs = 0;
      gust.durationMs = 0;
      gust.peakStrength = 0;
      gust.nextAtMs = nowMs + randomBetween(WIND_INTERVAL_MIN_MS, WIND_INTERVAL_MAX_MS);
      return 0;
    }

    // Envelop morbida: salita/discesa naturale senza scatti.
    return Math.sin(progress * Math.PI) * gust.peakStrength;
  }

  private updateWindPointShading(nowMs: number, gust: number): void {
    this.ensureDepthPointShading();

    const material = this.depthShadedMaterial;
    if (!material?.uniforms) {
      return;
    }

    if (material.uniforms.uWindTime) {
      material.uniforms.uWindTime.value = nowMs * 0.001;
    }

    if (material.uniforms.uWindAmplitude) {
      material.uniforms.uWindAmplitude.value = WIND_BASE_AMPLITUDE;
    }

    if (material.uniforms.uWindGust) {
      material.uniforms.uWindGust.value = gust;
    }
  }

  private applyWindStep(nowMs: number): void {
    const modelIds = this.engine.getModelIds();
    if (!modelIds.length) {
      return;
    }
    const gust = this.getGustMultiplier(nowMs);
    this.updateWindPointShading(nowMs, gust);
  }

  private runWindLoop = (nowMs: number): void => {
    if (this.disposed) {
      return;
    }

    this.windRafId = requestAnimationFrame(this.runWindLoop);

    if (nowMs - this.windLastStepMs < this.windStepMs) {
      return;
    }

    this.windLastStepMs = nowMs;
    this.applyWindStep(nowMs);
  };

  private ensureWindLoop(): void {
    if (this.windRafId !== null) {
      return;
    }

    const nowMs = performance.now();
    this.windLastStepMs = nowMs;
    this.initWindSchedule(nowMs);
    this.windRafId = requestAnimationFrame(this.runWindLoop);
  }

  private stopWindLoop(): void {
    if (this.windRafId !== null) {
      cancelAnimationFrame(this.windRafId);
      this.windRafId = null;
    }
  }

  private updateTitleScale(): void {
    const sprite = this.titleSprite;
    const camera = (this.engine as any).camera;

    if (!sprite || !camera || typeof camera.fov !== 'number' || !camera.position) {
      return;
    }

    const distance = Math.abs((camera.position.z ?? 0) - sprite.position.z);
    if (!Number.isFinite(distance) || distance <= 0) {
      return;
    }

    const vFov = (camera.fov * Math.PI) / 180;
    const visibleHeight = 2 * Math.tan(vFov / 2) * distance;
    const visibleWidth = visibleHeight * camera.aspect;
    const targetWidth = visibleWidth * 0.5;
    const targetHeight = targetWidth * this.titleSpriteAspect;

    sprite.scale.set(targetWidth, targetHeight, 1);
  }

  private lockCameraInteraction(): void {
    const controls = (this.engine as any).controls;
    if (!controls) {
      return;
    }

    controls.enabled = false;
    controls.enableRotate = false;
    controls.enableZoom = false;
    controls.enablePan = false;

    if (typeof controls.update === 'function') {
      controls.update();
    }
  }

  private applyFrontCameraPose(): void {
    const camera = (this.engine as any).camera;
    const controls = (this.engine as any).controls;

    if (!camera) {
      return;
    }

    if (camera.position?.set) {
      camera.position.set(
        this.viewDebug.cameraX,
        this.viewDebug.cameraY,
        this.viewDebug.cameraZ
      );
    }

    if (camera.up?.set) {
      camera.up.set(0, 1, 0);
    }

    if (typeof camera.lookAt === 'function') {
      camera.lookAt(
        this.viewDebug.targetX,
        this.viewDebug.targetY,
        this.viewDebug.targetZ
      );
    }

    if (typeof camera.updateProjectionMatrix === 'function') {
      camera.updateProjectionMatrix();
    }

    if (controls?.target?.set) {
      controls.target.set(
        this.viewDebug.targetX,
        this.viewDebug.targetY,
        this.viewDebug.targetZ
      );
    }

    if (typeof controls?.update === 'function') {
      controls.update();
    }

    this.updateDepthAtmosphere();
  }

  setViewDebug(options: Partial<ViewDebugOptions>): void {
    this.assertNotDisposed();
    this.viewDebug = { ...this.viewDebug, ...options };
    this.applyFrontCameraPose();
    this.updateTitleScale();
  }

  private nextSpawnPosition(): { x: number; y: number; z: number } {
    for (let attempt = 0; attempt < SPAWN_CANDIDATE_LIMIT; attempt += 1) {
      const index = this.spawnIndex + attempt;
      const slot = index % SPAWN_SLOTS_PER_RING;
      const ring = Math.floor(index / SPAWN_SLOTS_PER_RING);
      const stagger = ring % 2 === 0 ? 0 : Math.PI / SPAWN_SLOTS_PER_RING;
      const angle = (slot / SPAWN_SLOTS_PER_RING) * Math.PI * 2 + stagger;

      // Ellisse contenuta nel viewport con camera fissa.
      const radius = 0.95 + ring * SPAWN_RING_STEP;
      const candidate = {
        x: Math.cos(angle) * radius * 1.1,
        y: Math.sin(angle) * radius * 0.75,
        z: SPAWN_DEPTH_LAYERS[index % SPAWN_DEPTH_LAYERS.length]
      };

      if (this.isSpawnPositionFree(candidate)) {
        this.spawnIndex = index + 1;
        return candidate;
      }
    }

    // Fallback: evita blocchi anche con molte piante caricate.
    const fallback = {
      x: (Math.random() - 0.5) * 2.2,
      y: (Math.random() - 0.5) * 1.6,
      z: SPAWN_DEPTH_LAYERS[Math.floor(Math.random() * SPAWN_DEPTH_LAYERS.length)]
    };
    this.spawnIndex += 1;
    return fallback;
  }

  private buildScaleForDepth(depthZ: number): { x: number; y: number; z: number } {
    let multiplier = 0.62;

    if (depthZ >= 1.4) {
      multiplier = 1.36;
    } else if (depthZ >= 0.85) {
      multiplier = 1.18;
    } else if (depthZ >= 0.2) {
      multiplier = 1;
    } else if (depthZ >= -0.45) {
      multiplier = 0.82;
    } else if (depthZ >= -1) {
      multiplier = 0.68;
    }

    const scale = MODEL_SCALE * multiplier;
    return { x: scale, y: scale, z: scale };
  }

  private isSpawnPositionFree(candidate: { x: number; y: number; z: number }): boolean {
    for (const occupied of this.modelSpawnPositions.values()) {
      const dx = occupied.x - candidate.x;
      const dy = occupied.y - candidate.y;
      if (Math.hypot(dx, dy) < SPAWN_MIN_DISTANCE_XY) {
        return false;
      }
    }

    return true;
  }

  async addModelsFromFiles(files: FileList | File[], animationDuration = 1200): Promise<string[]> {
    this.assertNotDisposed();

    const queue = Array.from(files);
    if (!queue.length) {
      throw new Error('Nessun file selezionato.');
    }

    const addedIds: string[] = [];

    for (const file of queue) {
      const extension = getExtension(file.name);
      if (!FILE_MODEL_EXTENSIONS.has(extension)) {
        throw new Error(
          `Formato non valido per "${file.name}". Usa file .obj o .glb.`
        );
      }

      const id = buildModelId(file.name);
      const position = this.nextSpawnPosition();
      const scale = this.buildScaleForDepth(position.z);
      try {
        await this.engine.addModelFromFile(file, {
          id,
          randomPlacement: false,
          frame: false,
          loadingAnimationDuration: animationDuration,
          scale,
          position,
          rotation: UPRIGHT_ROTATION
        });
        this.ensureWindLoop();
        this.ensureDepthPointShading();
        this.updateDepthPointShading();
        addedIds.push(id);
        this.modelSpawnPositions.set(id, position);
      } catch (error) {
        throw normalizeEngineError(
          error,
          `Parsing fallito per "${file.name}". Verifica che il modello non sia corrotto.`
        );
      }
    }

    if (!this.engine.getModelIds().length) {
      throw new Error('Nessun modello valido disponibile dopo il caricamento.');
    }

    return addedIds;
  }

  async addModelFromUrl(url: string, animationDuration = 600): Promise<string> {
    this.assertNotDisposed();

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      throw new Error('Inserisci un URL valido per il modello.');
    }

    const extension = getUrlExtension(trimmedUrl);
    if (!URL_MODEL_EXTENSIONS.has(extension)) {
      throw new Error('Formato URL non valido. Usa .obj, .glb o .gltf.');
    }

    const id = buildModelId(trimmedUrl);
    const position = this.nextSpawnPosition();
    const scale = this.buildScaleForDepth(position.z);

    try {
      await this.engine.addModelFromUrl(trimmedUrl, {
        id,
        randomPlacement: false,
        frame: true,
        loadingAnimationDuration: animationDuration,
        scale,
        position,
        rotation: UPRIGHT_ROTATION
      });
      this.ensureWindLoop();
      this.ensureDepthPointShading();
      this.updateDepthPointShading();
      this.modelSpawnPositions.set(id, position);
      return id;
    } catch (error) {
      throw normalizeEngineError(
        error,
        'Parsing fallito dal URL indicato. Controlla formato e accessibilita del file.'
      );
    }
  }

  removeModel(id: string): void {
    this.assertNotDisposed();

    if (!id) {
      throw new Error('Seleziona prima un modello da rimuovere.');
    }

    this.engine.removeModel(id);
    this.modelSpawnPositions.delete(id);

    if (!this.engine.getModelIds().length) {
      this.spawnIndex = 0;
      this.modelSpawnPositions.clear();
      this.stopWindLoop();
    }

  }

  clearModels(): void {
    this.assertNotDisposed();
    this.engine.clearModels();
    this.spawnIndex = 0;
    this.modelSpawnPositions.clear();
    this.stopWindLoop();
  }

  frameAllModels(): void {
    this.assertNotDisposed();

    if (!this.engine.getModelIds().length) {
      throw new Error('Nessun modello da inquadrare.');
    }

    this.engine.frameAllModels();
  }

  resetCamera(): void {
    this.assertNotDisposed();

    if (!this.engine.getModelIds().length) {
      throw new Error('Nessun modello disponibile per il reset camera.');
    }

    this.engine.resetCamera();
  }

  setRuntimeOptions(options: Partial<EngineRuntimeOptions>): void {
    this.assertNotDisposed();
    this.engine.setOptions(options);
  }

  syncSize(): void {
    this.assertNotDisposed();

    const width = this.stage.clientWidth;
    const height = this.stage.clientHeight;

    if (!width || !height) {
      return;
    }

    if (this.engine.renderer) {
      this.engine.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.engine.renderer.setSize(width, height, false);
    }

    if (this.engine.camera) {
      this.engine.camera.aspect = width / height;
      this.engine.camera.updateProjectionMatrix();
    }

    if (this.engine.composer?.setSize) {
      this.engine.composer.setSize(width, height);
    }

    this.applyFrontCameraPose();
    this.updateDepthAtmosphere();
    this.updateTitleScale();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.stopWindLoop();
    this.engine.dispose();
    this.disposed = true;
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error('Engine gia dismesso. Ricarica la pagina per riavviare lo stage.');
    }
  }
}
