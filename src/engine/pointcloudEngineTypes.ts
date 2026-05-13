export interface PointcloudEngineOptions {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  autostart?: boolean;
  pointDensity?: number;
  pointSize?: number;
  exposure?: number;
  saturation?: number;
  tint?: string;
  background?: string;
  autoRotate?: boolean;
  rotationSpeed?: number;
  bloomEnabled?: boolean;
  bloomStrength?: number;
  bloomRadius?: number;
  bloomThreshold?: number;
  randomPlacementRange?: number;
  randomPlacementPadding?: number;
  randomPlacementAttempts?: number;
  onStatsChange?: (stats: {
    totalPoints: number;
    modelCount: number;
    activeModelId?: string;
  }) => void;
}

export interface PointcloudModelAddOptions {
  id?: string;
  replace?: boolean;
  frame?: boolean;
  randomPlacement?: boolean;
  randomPlacementRange?: number;
  randomPlacementPadding?: number;
  randomPlacementAttempts?: number;
  loadingAnimationDuration?: number;
  scale?: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  position?: { x: number; y: number; z: number };
}

export interface PointcloudEngine {
  scene?: unknown;
  renderer?: {
    setPixelRatio: (ratio: number) => void;
    setSize: (width: number, height: number, updateStyle?: boolean) => void;
  };
  camera?: {
    aspect: number;
    updateProjectionMatrix: () => void;
  };
  composer?: {
    setSize: (width: number, height: number) => void;
  };
  start: () => void;
  stop: () => void;
  dispose: () => void;
  setOptions: (options: Partial<PointcloudEngineOptions>) => void;
  addModelFromFile: (
    file: File,
    options?: PointcloudModelAddOptions
  ) => Promise<unknown>;
  addModelFromUrl: (
    url: string,
    options?: PointcloudModelAddOptions
  ) => Promise<unknown>;
  removeModel: (id: string) => void;
  clearModels: () => void;
  getModelIds: () => string[];
  getStats: () => {
    totalPoints: number;
    modelCount: number;
    activeModelId?: string;
  };
  frameAllModels: () => void;
  resetCamera: () => void;
}

export type CreatePointcloudEngine = (
  options: PointcloudEngineOptions
) => PointcloudEngine;
