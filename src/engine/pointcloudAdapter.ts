import { loadCreatePointcloudEngine } from './loadEngineFactory';
import logoPiantalaUrl from '../logo piantala.png';
import type {
  PointcloudEngine,
  PointcloudEngineOptions,
  PointcloudRawModel
} from './pointcloudEngineTypes';

const FILE_MODEL_EXTENSIONS = new Set(['obj', 'glb', 'ply']);
const URL_MODEL_EXTENSIONS = new Set(['obj', 'glb', 'gltf', 'ply']);
const MODEL_SCALE = 3.8;
const SPAWN_ELLIPSE_RADIUS_X = 20;
const SPAWN_ELLIPSE_RADIUS_Y = 13;
const SPAWN_CENTER_CLEAR_RADIUS = 4.35;
const SPAWN_CENTER_FOOTPRINT_FACTOR = 0.36;
const SPAWN_COLLISION_PADDING = 1.45;
const SPAWN_CANDIDATE_LIMIT = 5200;
const SPAWN_DEPTH_LAYERS = [0.45, 0.2, 0, -0.2, -0.45] as const;
const SPAWN_CAMERA_MARGIN = MODEL_SCALE * 2.7;
const CAMERA_FIT_SAFE_VIEWPORT_FRACTION = 0.82;
const DEPTH_FOG_COLOR = '#000000';
const MESH_MODEL_ROTATION = { x: -Math.PI / 2, y: -Math.PI / 6, z: 0 };
const PLY_MODEL_ROTATION = { x: 0, y: -Math.PI / 6, z: 0 };
const WIND_UPDATE_FPS = 24;
const WIND_INTERVAL_MIN_MS = 6800;
const WIND_INTERVAL_MAX_MS = 15200;
const WIND_GUST_DURATION_MIN_MS = 1800;
const WIND_GUST_DURATION_MAX_MS = 3600;
const WIND_BASE_AMPLITUDE = 1.6;
const WIND_GUST_MIN = 0.4;
const WIND_GUST_MAX = 1.4;
const BLOOM_LAYER = 1;

interface WindGustState {
  nextAtMs: number;
  activeFromMs: number;
  durationMs: number;
  peakStrength: number;
}

interface PlantFootprint {
  x: number;
  y: number;
  z: number;
  radius: number;
}

interface PlantBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
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
  cameraZ: 44,
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

function buildEllipseSpawnPoint(index: number, attempt: number): { x: number; y: number } {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const outerBiasedAttempt = (index + attempt) % 4 !== 0;
  const radius = outerBiasedAttempt
    ? Math.sqrt(randomBetween(0.22, 0.96))
    : Math.sqrt(Math.random() * 0.96);
  const angle =
    (index + attempt) * goldenAngle +
    randomBetween(-0.22, 0.22);

  return {
    x: Math.cos(angle) * radius * SPAWN_ELLIPSE_RADIUS_X,
    y: Math.sin(angle) * radius * SPAWN_ELLIPSE_RADIUS_Y
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizePlyRawModel(
  positions: Float32Array,
  normals: Float32Array,
  colors: Float32Array
): PointcloudRawModel {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];

    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;
  const maxSize = Math.max(
    1e-6,
    maxX - minX,
    maxY - minY,
    maxZ - minZ
  );
  const scale = 2 / maxSize;

  for (let i = 0; i < positions.length; i += 3) {
    const normalizedX = (positions[i] - centerX) * scale;
    const normalizedY = (positions[i + 1] - centerY) * scale;
    const normalizedZ = (positions[i + 2] - centerZ) * scale;

    positions[i] = normalizedX;
    positions[i + 1] = normalizedZ;
    positions[i + 2] = normalizedY;

    const normalY = normals[i + 1];
    const normalZ = normals[i + 2];
    normals[i + 1] = normalZ;
    normals[i + 2] = normalY;

    const normalLength = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= normalLength;
    normals[i + 1] /= normalLength;
    normals[i + 2] /= normalLength;

    colors[i] = clamp01(colors[i]);
    colors[i + 1] = clamp01(colors[i + 1]);
    colors[i + 2] = clamp01(colors[i + 2]);
  }

  return {
    positions,
    normals,
    colors,
    pointCount: positions.length / 3
  };
}

async function parsePlyRawModel(arrayBuffer: ArrayBuffer): Promise<PointcloudRawModel> {
  const [{ PLYLoader }] = await Promise.all([
    import('three/examples/jsm/loaders/PLYLoader.js')
  ]);
  const loader = new PLYLoader();
  const geometry = loader.parse(arrayBuffer);
  const positionAttribute = geometry.getAttribute('position');

  if (!positionAttribute?.count) {
    throw new Error('PLY senza punti leggibili.');
  }

  const pointCount = positionAttribute.count;
  const positions = new Float32Array(pointCount * 3);
  const normals = new Float32Array(pointCount * 3);
  const colors = new Float32Array(pointCount * 3);
  const normalAttribute = geometry.getAttribute('normal');
  const colorAttribute = geometry.getAttribute('color');

  for (let index = 0; index < pointCount; index += 1) {
    const target = index * 3;
    positions[target] = positionAttribute.getX(index);
    positions[target + 1] = positionAttribute.getY(index);
    positions[target + 2] = positionAttribute.getZ(index);

    normals[target] = normalAttribute?.getX(index) ?? 0;
    normals[target + 1] = normalAttribute?.getY(index) ?? 0;
    normals[target + 2] = normalAttribute?.getZ(index) ?? 1;

    colors[target] = colorAttribute?.getX(index) ?? 1;
    colors[target + 1] = colorAttribute?.getY(index) ?? 1;
    colors[target + 2] = colorAttribute?.getZ(index) ?? 1;
  }

  geometry.dispose();
  return normalizePlyRawModel(positions, normals, colors);
}

function makeObjectDarkenableInBloomPass(object: any): void {
  if (!object || object.isPoints || object.isMesh) {
    return;
  }

  // The upstream bloom pass darkens non-bloomed Mesh/Points only.
  // Mark sprites as mesh-like so logos/titles are also excluded from selective bloom.
  object.isMesh = true;
}

function getModelRotation(extension: string): { x: number; y: number; z: number } {
  return extension === 'ply' ? PLY_MODEL_ROTATION : MESH_MODEL_ROTATION;
}

function hasBloomLayer(object: any): boolean {
  return Boolean(object?.layers?.mask & (1 << BLOOM_LAYER));
}

export class PointcloudEngineAdapter {
  private readonly engine: PointcloudEngine;

  private readonly stage: HTMLElement;

  private spawnIndex = 0;

  private readonly modelSpawnPositions = new Map<string, PlantFootprint>();

  private readonly modelPointObjects = new Map<string, any>();

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

  private selectiveBloomTimeoutId: number | null = null;

  private selectiveBloomActiveKey: string | null = null;

  private selectiveBloomLayerSnapshot: Array<{ object: any; hadBloomLayer: boolean }> = [];

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
      pointDensity: 18,
      pointSize: 0.01,
      autoRotate: false,
      bloomEnabled: false,
      bloomStrength: 0.1,
      bloomRadius: 0,
      bloomThreshold: 0.15,
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

  private getPointObjects(): any[] {
    const scene = (this.engine as any).scene;
    const points: any[] = [];

    if (!scene || typeof scene.traverse !== 'function') {
      return points;
    }

    scene.traverse((object: any) => {
      if (object?.isPoints) {
        points.push(object);
      }
    });

    return points;
  }

  private captureModelPointObject(modelId: string, previousPoints: Set<any>): void {
    const nextPoint = this.getPointObjects().find((point) => !previousPoints.has(point));

    if (nextPoint) {
      nextPoint.userData = {
        ...(nextPoint.userData ?? {}),
        pointcloudModelId: modelId
      };
      this.modelPointObjects.set(modelId, nextPoint);
    }
  }

  private restoreAllModelBloomLayers(): void {
    if (this.selectiveBloomLayerSnapshot.length) {
      for (const { object, hadBloomLayer } of this.selectiveBloomLayerSnapshot) {
        if (!object?.layers) {
          continue;
        }

        if (hadBloomLayer) {
          object.layers.enable(BLOOM_LAYER);
        } else {
          object.layers.disable(BLOOM_LAYER);
        }
      }
      this.selectiveBloomLayerSnapshot = [];
    }

    this.selectiveBloomActiveKey = null;

    for (const point of this.modelPointObjects.values()) {
      if (typeof point?.layers?.enable === 'function') {
        point.layers.enable(BLOOM_LAYER);
      }
    }
  }

  triggerSelectiveBloom(
    modelIds: string[],
    durationMs: number,
    restoreOptions: Partial<EngineRuntimeOptions>
  ): boolean {
    this.assertNotDisposed();

    const targetIds = new Set(modelIds.filter((id) => this.modelPointObjects.has(id)));
    const targetKey = [...targetIds].sort().join('|');

    if (this.selectiveBloomTimeoutId !== null) {
      window.clearTimeout(this.selectiveBloomTimeoutId);
      this.selectiveBloomTimeoutId = null;

      if (targetKey && targetKey === this.selectiveBloomActiveKey) {
        this.selectiveBloomTimeoutId = window.setTimeout(() => {
          this.restoreAllModelBloomLayers();
          this.engine.setOptions({
            ...restoreOptions,
            selectiveBloomHideNonBloomed: false
          });
          this.selectiveBloomTimeoutId = null;
        }, Math.max(800, durationMs));
        return true;
      }

      if (this.selectiveBloomActiveKey !== null) {
        this.restoreAllModelBloomLayers();
        this.engine.setOptions({
          ...restoreOptions,
          selectiveBloomHideNonBloomed: false
        });
      }
    }

    if (!targetIds.size) {
      return false;
    }

    this.selectiveBloomLayerSnapshot = [];
    const scene = (this.engine as any).scene;
    if (scene && typeof scene.traverse === 'function') {
      scene.traverse((object: any) => {
        if (!object?.layers) {
          return;
        }

        this.selectiveBloomLayerSnapshot.push({
          object,
          hadBloomLayer: hasBloomLayer(object)
        });
      });
    }

    const objectModelIds = new Map<any, string>();
    for (const [modelId, point] of this.modelPointObjects.entries()) {
      objectModelIds.set(point, modelId);
    }

    const applySelectiveLayer = (point: any, modelId?: string) => {
      if (!point?.isPoints || !point?.layers) {
        return;
      }

      if (modelId && targetIds.has(modelId)) {
        point.layers.enable(BLOOM_LAYER);
      } else {
        point.layers.disable(BLOOM_LAYER);
      }
    };

    if (scene && typeof scene.traverse === 'function') {
      scene.traverse((object: any) => {
        applySelectiveLayer(
          object,
          object?.userData?.pointcloudModelId ?? objectModelIds.get(object)
        );
      });
    } else {
      for (const [modelId, point] of this.modelPointObjects.entries()) {
        applySelectiveLayer(point, modelId);
      }
    }

    const bloomOptions = {
      bloomEnabled: true,
      bloomStrength: restoreOptions.bloomStrength,
      bloomRadius: restoreOptions.bloomRadius,
      bloomThreshold: restoreOptions.bloomThreshold,
      selectiveBloomHideNonBloomed: true
    };

    console.info('[Piantala bloom] Bloom selettivo applicato', {
      modelIds: [...targetIds],
      bloomOptions
    });

    this.engine.setOptions(bloomOptions);
    this.selectiveBloomActiveKey = targetKey;

    this.selectiveBloomTimeoutId = window.setTimeout(() => {
      this.restoreAllModelBloomLayers();
      this.engine.setOptions({
        ...restoreOptions,
        selectiveBloomHideNonBloomed: false
      });
      this.selectiveBloomTimeoutId = null;
    }, Math.max(800, durationMs));

    return true;
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
      depthTest: false,
      depthWrite: false
    });

    const sprite = new THREE.Sprite(spriteMaterial);
    makeObjectDarkenableInBloomPass(sprite);
    sprite.renderOrder = 10000;
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
      depthTest: false,
      depthWrite: false
    });

    const sprite = new THREE.Sprite(spriteMaterial);
    makeObjectDarkenableInBloomPass(sprite);
    sprite.renderOrder = 10000;
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
        this.getCameraZForCurrentScene()
      );
    }

    if (typeof camera.far === 'number') {
      const cameraDistance = Math.max(
        4,
        Math.abs((camera.position?.z ?? this.viewDebug.cameraZ) - this.viewDebug.targetZ)
      );
      camera.far = Math.max(200, cameraDistance * 4);
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

  private getCameraZForCurrentScene(): number {
    const camera = (this.engine as any).camera;
    const fallbackZ = this.viewDebug.cameraZ;

    if (!camera || typeof camera.fov !== 'number') {
      return fallbackZ;
    }

    const bounds = this.getPlantFramingBounds();
    if (!bounds) {
      return fallbackZ;
    }

    const targetX = this.viewDebug.targetX;
    const targetY = this.viewDebug.targetY;
    const verticalFov = (camera.fov * Math.PI) / 180;
    const tanHalfFov = Math.tan(verticalFov / 2);
    const aspect = camera.aspect || 1;
    const requiredHalfWidth =
      (Math.max(Math.abs(bounds.minX - targetX), Math.abs(bounds.maxX - targetX)) +
        SPAWN_CAMERA_MARGIN) /
      CAMERA_FIT_SAFE_VIEWPORT_FRACTION;
    const requiredHalfHeight =
      (Math.max(Math.abs(bounds.minY - targetY), Math.abs(bounds.maxY - targetY)) +
        SPAWN_CAMERA_MARGIN) /
      CAMERA_FIT_SAFE_VIEWPORT_FRACTION;
    const requiredDistance = Math.max(
      requiredHalfHeight / tanHalfFov,
      requiredHalfWidth / (tanHalfFov * aspect)
    );

    return Math.max(fallbackZ, requiredDistance + this.viewDebug.targetZ);
  }

  private getPlantFramingBounds(): PlantBounds | null {
    let bounds: PlantBounds | null = null;

    const includePoint = (x: number, y: number) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }

      if (!bounds) {
        bounds = { minX: x, maxX: x, minY: y, maxY: y };
        return;
      }

      bounds.minX = Math.min(bounds.minX, x);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxY = Math.max(bounds.maxY, y);
    };

    for (const footprint of this.modelSpawnPositions.values()) {
      includePoint(footprint.x - footprint.radius, footprint.y - footprint.radius);
      includePoint(footprint.x + footprint.radius, footprint.y + footprint.radius);
    }

    for (const point of this.modelPointObjects.values()) {
      if (!point?.geometry) {
        continue;
      }

      point.updateMatrixWorld?.(true);

      if (!point.geometry.boundingBox && typeof point.geometry.computeBoundingBox === 'function') {
        point.geometry.computeBoundingBox();
      }

      const box = point.geometry.boundingBox;
      if (!box?.min || !box?.max || !point.matrixWorld) {
        continue;
      }

      const worldPoint = box.min.clone?.();
      if (!worldPoint?.set || typeof worldPoint.applyMatrix4 !== 'function') {
        continue;
      }

      const min = box.min;
      const max = box.max;
      const corners = [
        [min.x, min.y, min.z],
        [min.x, min.y, max.z],
        [min.x, max.y, min.z],
        [min.x, max.y, max.z],
        [max.x, min.y, min.z],
        [max.x, min.y, max.z],
        [max.x, max.y, min.z],
        [max.x, max.y, max.z]
      ] as const;

      for (const [x, y, z] of corners) {
        worldPoint.set(x, y, z).applyMatrix4(point.matrixWorld);
        includePoint(worldPoint.x, worldPoint.y);
      }
    }

    return bounds;
  }

  private nextSpawnPosition(): { x: number; y: number; z: number } {
    let bestCandidate: { x: number; y: number; z: number } | null = null;
    let bestClearance = -Infinity;

    for (let attempt = 0; attempt < SPAWN_CANDIDATE_LIMIT; attempt += 1) {
      const depthIndex = (this.spawnIndex + attempt) % SPAWN_DEPTH_LAYERS.length;
      const point = buildEllipseSpawnPoint(this.spawnIndex, attempt);
      const candidate = {
        x: point.x,
        y: point.y,
        z: SPAWN_DEPTH_LAYERS[depthIndex]
      };

      if (this.isSpawnPositionFree(candidate)) {
        this.spawnIndex += attempt + 1;
        return candidate;
      }

      const clearance = this.getSpawnClearance(candidate);
      if (clearance > bestClearance) {
        bestClearance = clearance;
        bestCandidate = candidate;
      }
    }

    this.spawnIndex += 1;
    return bestCandidate ?? { x: 0, y: 0, z: SPAWN_DEPTH_LAYERS[0] };
  }

  private buildScaleMultiplierForDepth(depthZ: number): number {
    let multiplier = 0.62;

    if (depthZ >= 0.35) {
      multiplier = 1.06;
    } else if (depthZ >= 0.1) {
      multiplier = 1.03;
    } else if (depthZ >= -0.1) {
      multiplier = 1;
    } else if (depthZ >= -0.35) {
      multiplier = 0.97;
    } else {
      multiplier = 0.94;
    }

    return multiplier;
  }

  private buildScaleForDepth(depthZ: number): { x: number; y: number; z: number } {
    const multiplier = this.buildScaleMultiplierForDepth(depthZ);
    const scale = MODEL_SCALE * multiplier;
    return { x: scale, y: scale, z: scale };
  }

  private buildFootprintForPosition(position: { x: number; y: number; z: number }): PlantFootprint {
    const scaleMultiplier = this.buildScaleMultiplierForDepth(position.z);

    return {
      ...position,
      radius: MODEL_SCALE * scaleMultiplier * 0.98
    };
  }

  private getSpawnClearance(candidate: { x: number; y: number; z: number }): number {
    const candidateFootprint = this.buildFootprintForPosition(candidate);

    const centerClearRadius =
      SPAWN_CENTER_CLEAR_RADIUS + candidateFootprint.radius * SPAWN_CENTER_FOOTPRINT_FACTOR;

    if (Math.hypot(candidate.x, candidate.y) < centerClearRadius) {
      return -Infinity;
    }

    if (!this.modelSpawnPositions.size) {
      return Infinity;
    }

    let minClearance = Infinity;
    for (const occupied of this.modelSpawnPositions.values()) {
      const dx = occupied.x - candidate.x;
      const dy = occupied.y - candidate.y;
      const requiredDistance =
        occupied.radius + candidateFootprint.radius + SPAWN_COLLISION_PADDING;
      const clearance = Math.hypot(dx, dy) - requiredDistance;
      minClearance = Math.min(minClearance, clearance);
    }

    return minClearance;
  }

  private isSpawnPositionFree(candidate: { x: number; y: number; z: number }): boolean {
    return this.getSpawnClearance(candidate) >= 0;
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
          `Formato non valido per "${file.name}". Usa file .obj, .glb o .ply.`
        );
      }

      const id = buildModelId(file.name);
      const position = this.nextSpawnPosition();
      const scale = this.buildScaleForDepth(position.z);
      this.modelSpawnPositions.set(id, this.buildFootprintForPosition(position));
      try {
        const previousPoints = new Set(this.getPointObjects());
        const addOptions = {
          id,
          randomPlacement: false,
          frame: false,
          loadingAnimationDuration: animationDuration,
          scale,
          position,
          rotation: getModelRotation(extension)
        };

        if (extension === 'ply') {
          if (!this.engine.addModelFromRawModel) {
            throw new Error('Il motore pointcloud non supporta modelli raw PLY.');
          }
          const rawModel = await parsePlyRawModel(await file.arrayBuffer());
          this.engine.addModelFromRawModel(rawModel, addOptions);
        } else {
          await this.engine.addModelFromFile(file, addOptions);
        }
        this.captureModelPointObject(id, previousPoints);
        this.ensureWindLoop();
        this.ensureDepthPointShading();
        this.updateDepthPointShading();
        addedIds.push(id);
      } catch (error) {
        this.modelSpawnPositions.delete(id);
        throw normalizeEngineError(
          error,
          `Parsing fallito per "${file.name}". Verifica che il modello non sia corrotto.`
        );
      }
    }

    if (!this.engine.getModelIds().length) {
      throw new Error('Nessun modello valido disponibile dopo il caricamento.');
    }

    this.applyFrontCameraPose();
    this.updateTitleScale();

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
      throw new Error('Formato URL non valido. Usa .obj, .glb, .gltf o .ply.');
    }

    const id = buildModelId(trimmedUrl);
    const position = this.nextSpawnPosition();
    const scale = this.buildScaleForDepth(position.z);
    this.modelSpawnPositions.set(id, this.buildFootprintForPosition(position));

    try {
      const previousPoints = new Set(this.getPointObjects());
      const addOptions = {
        id,
        randomPlacement: false,
        frame: false,
        loadingAnimationDuration: animationDuration,
        scale,
        position,
        rotation: getModelRotation(extension)
      };

      if (extension === 'ply') {
        if (!this.engine.addModelFromRawModel) {
          throw new Error('Il motore pointcloud non supporta modelli raw PLY.');
        }
        const response = await fetch(trimmedUrl);
        if (!response.ok) {
          throw new Error(`Impossibile caricare PLY: ${response.status}`);
        }
        const rawModel = await parsePlyRawModel(await response.arrayBuffer());
        this.engine.addModelFromRawModel(rawModel, addOptions);
      } else {
        await this.engine.addModelFromUrl(trimmedUrl, addOptions);
      }
      this.captureModelPointObject(id, previousPoints);
      this.applyFrontCameraPose();
      this.updateTitleScale();
      this.ensureWindLoop();
      this.ensureDepthPointShading();
      this.updateDepthPointShading();
      return id;
    } catch (error) {
      this.modelSpawnPositions.delete(id);
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
    this.modelPointObjects.delete(id);

    if (!this.engine.getModelIds().length) {
      this.spawnIndex = 0;
      this.modelSpawnPositions.clear();
      this.modelPointObjects.clear();
      this.stopWindLoop();
    }

    this.applyFrontCameraPose();
    this.updateTitleScale();
  }

  clearModels(): void {
    this.assertNotDisposed();
    this.engine.clearModels();
    this.spawnIndex = 0;
    this.modelSpawnPositions.clear();
    this.modelPointObjects.clear();
    this.stopWindLoop();
    this.applyFrontCameraPose();
    this.updateTitleScale();
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
    if (this.selectiveBloomTimeoutId !== null) {
      window.clearTimeout(this.selectiveBloomTimeoutId);
      this.selectiveBloomTimeoutId = null;
    }
    this.engine.dispose();
    this.disposed = true;
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error('Engine gia dismesso. Ricarica la pagina per riavviare lo stage.');
    }
  }
}
