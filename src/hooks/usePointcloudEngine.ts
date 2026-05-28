import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  DEFAULT_VIEW_DEBUG,
  PointcloudEngineAdapter,
  type EngineRuntimeOptions,
  type PointcloudStats,
  type ViewDebugOptions
} from '../engine/pointcloudAdapter';

export interface EngineNotice {
  type: 'success' | 'error' | 'info';
  text: string;
}

export interface EngineControlsState extends EngineRuntimeOptions {
  pointDensity: number;
  pointSize: number;
  exposure: number;
  saturation: number;
  autoRotate: boolean;
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

const DEFAULT_CONTROLS: EngineControlsState = {
  pointDensity: 1,
  pointSize: 0.01,
  exposure: 1.18,
  saturation: 1.14,
  autoRotate: false,
  bloomEnabled: false,
  bloomStrength: 0,
  bloomRadius: 0,
  bloomThreshold: 0.55,
  ...DEFAULT_VIEW_DEBUG
};

function toRuntimeOptions(
  partial: Partial<EngineControlsState>
): Partial<EngineRuntimeOptions> {
  const runtime: Partial<EngineRuntimeOptions> = {};

  if (partial.pointDensity !== undefined) runtime.pointDensity = partial.pointDensity;
  if (partial.pointSize !== undefined) runtime.pointSize = partial.pointSize;
  if (partial.exposure !== undefined) runtime.exposure = partial.exposure;
  if (partial.saturation !== undefined) runtime.saturation = partial.saturation;
  if (partial.autoRotate !== undefined) runtime.autoRotate = partial.autoRotate;
  if (partial.bloomEnabled !== undefined) runtime.bloomEnabled = partial.bloomEnabled;
  if (partial.bloomStrength !== undefined) runtime.bloomStrength = partial.bloomStrength;
  if (partial.bloomRadius !== undefined) runtime.bloomRadius = partial.bloomRadius;
  if (partial.bloomThreshold !== undefined) runtime.bloomThreshold = partial.bloomThreshold;

  return runtime;
}

function toViewDebugOptions(
  partial: Partial<EngineControlsState>
): Partial<ViewDebugOptions> {
  const view: Partial<ViewDebugOptions> = {};

  if (partial.cameraX !== undefined) view.cameraX = partial.cameraX;
  if (partial.cameraY !== undefined) view.cameraY = partial.cameraY;
  if (partial.cameraZ !== undefined) view.cameraZ = partial.cameraZ;
  if (partial.targetX !== undefined) view.targetX = partial.targetX;
  if (partial.targetY !== undefined) view.targetY = partial.targetY;
  if (partial.targetZ !== undefined) view.targetZ = partial.targetZ;

  return view;
}

function parseUserError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Operazione non completata per un errore inatteso.';
}

interface UsePointcloudEngineArgs {
  stageRef: RefObject<HTMLDivElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
}

interface UsePointcloudEngineResult {
  isReady: boolean;
  isBusy: boolean;
  controls: EngineControlsState;
  modelIds: string[];
  stats: PointcloudStats;
  notice: EngineNotice | null;
  setNotice: (notice: EngineNotice | null) => void;
  addFromFiles: (files: FileList | null) => Promise<string[]>;
  addFromUrl: (url: string, animationDuration?: number) => Promise<string | null>;
  removeModel: (id: string) => void;
  resetCamera: () => void;
  triggerSelectiveBloom: (modelIds: string[], durationMs?: number) => boolean;
  updateControls: (partial: Partial<EngineControlsState>) => void;
}

export function usePointcloudEngine({
  stageRef,
  canvasRef
}: UsePointcloudEngineArgs): UsePointcloudEngineResult {
  const engineRef = useRef<PointcloudEngineAdapter | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const resizeRafRef = useRef<number | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState<EngineNotice | null>(null);
  const [controls, setControls] = useState<EngineControlsState>(DEFAULT_CONTROLS);
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [stats, setStats] = useState<PointcloudStats>({
    totalPoints: 0,
    modelCount: 0,
    activeModelId: undefined
  });

  const syncFromEngine = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    setModelIds(engine.getModelIds());
    setStats(engine.getStats());
  }, []);

  useEffect(() => {
    if (engineRef.current) {
      return;
    }

    const stage = stageRef.current;
    const canvas = canvasRef.current;

    if (!stage || !canvas) {
      return;
    }

    let cancelled = false;

    const onBeforeUnload = () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };

    const setup = async () => {
      setIsBusy(true);

      try {
        const engine = await PointcloudEngineAdapter.create({
          stage,
          canvas,
          initialOptions: {
            ...toRuntimeOptions(DEFAULT_CONTROLS)
          }
        });

        engine.setViewDebug(toViewDebugOptions(DEFAULT_CONTROLS));

        if (cancelled) {
          engine.dispose();
          return;
        }

        engineRef.current = engine;
        engine.syncSize();
        syncFromEngine();
        setIsReady(true);
        setNotice(null);

        const observer = new ResizeObserver(() => {
          if (resizeRafRef.current) {
            cancelAnimationFrame(resizeRafRef.current);
          }

          resizeRafRef.current = requestAnimationFrame(() => {
            engineRef.current?.syncSize();
          });
        });

        observer.observe(stage);
        resizeObserverRef.current = observer;
        window.addEventListener('beforeunload', onBeforeUnload);
      } catch (error) {
        if (!cancelled) {
          setNotice({ type: 'error', text: parseUserError(error) });
          setIsReady(false);
        }
      } finally {
        if (!cancelled) {
          setIsBusy(false);
        }
      }
    };

    void setup();

    return () => {
      cancelled = true;
      window.removeEventListener('beforeunload', onBeforeUnload);

      if (resizeRafRef.current) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }

      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }

      engineRef.current?.dispose();
      engineRef.current = null;
      setIsReady(false);
      setModelIds([]);
      setStats({ totalPoints: 0, modelCount: 0, activeModelId: undefined });
    };
  }, [canvasRef, stageRef, syncFromEngine]);

  const addFromFiles = useCallback(
    async (files: FileList | null) => {
      const engine = engineRef.current;
      if (!engine) {
        setNotice({ type: 'error', text: 'Engine non pronto: attendi il caricamento.' });
        return [];
      }

      if (!files || !files.length) {
        setNotice({ type: 'error', text: 'Nessun file selezionato.' });
        return [];
      }

      setIsBusy(true);
      try {
        const addedIds = await engine.addModelsFromFiles(files);
        syncFromEngine();
        setNotice({
          type: 'success',
          text: `Modelli caricati con successo: ${addedIds.length}.`
        });
        return addedIds;
      } catch (error) {
        setNotice({ type: 'error', text: parseUserError(error) });
        throw error;
      } finally {
        setIsBusy(false);
      }
    },
    [syncFromEngine]
  );

  const addFromUrl = useCallback(
    async (url: string, animationDuration?: number) => {
      const engine = engineRef.current;
      if (!engine) {
        setNotice({ type: 'error', text: 'Engine non pronto: attendi il caricamento.' });
        return null;
      }

      setIsBusy(true);
      try {
        const modelId = await engine.addModelFromUrl(url, animationDuration);
        syncFromEngine();
        setNotice({
          type: 'success',
          text: `Modello aggiunto da URL con id ${modelId}.`
        });
        return modelId;
      } catch (error) {
        setNotice({ type: 'error', text: parseUserError(error) });
        throw error;
      } finally {
        setIsBusy(false);
      }
    },
    [syncFromEngine]
  );

  const removeModel = useCallback(
    (id: string) => {
      const engine = engineRef.current;
      if (!engine) {
        setNotice({ type: 'error', text: 'Engine non pronto: attendi il caricamento.' });
        return;
      }

      try {
        engine.removeModel(id);
        syncFromEngine();
        setNotice({ type: 'info', text: `Modello rimosso: ${id}.` });
      } catch (error) {
        setNotice({ type: 'error', text: parseUserError(error) });
      }
    },
    [syncFromEngine]
  );

  const resetCamera = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) {
      setNotice({ type: 'error', text: 'Engine non pronto: attendi il caricamento.' });
      return;
    }

    try {
      engine.resetCamera();
      setNotice({ type: 'info', text: 'Camera resettata su tutti i modelli.' });
    } catch (error) {
      setNotice({ type: 'error', text: parseUserError(error) });
    }
  }, []);

  const updateControls = useCallback((partial: Partial<EngineControlsState>) => {
    const engine = engineRef.current;
    if (!engine) {
      setNotice({ type: 'error', text: 'Engine non pronto: attendi il caricamento.' });
      return;
    }

    setControls((previous) => {
      const next = { ...previous, ...partial };

      const runtimeOptions = toRuntimeOptions(partial);
      if (Object.keys(runtimeOptions).length > 0) {
        engine.setRuntimeOptions(runtimeOptions);
      }

      const viewDebug = toViewDebugOptions(partial);
      if (Object.keys(viewDebug).length > 0) {
        engine.setViewDebug(viewDebug);
      }

      return next;
    });
  }, []);

  const triggerSelectiveBloom = useCallback(
    (modelIds: string[], durationMs = 4200) => {
      const engine = engineRef.current;
      if (!engine) {
        setNotice({ type: 'error', text: 'Engine non pronto: attendi il caricamento.' });
        return false;
      }

      const didTrigger = engine.triggerSelectiveBloom(modelIds, durationMs, {
        bloomEnabled: controls.bloomEnabled,
        bloomStrength: controls.bloomStrength,
        bloomRadius: controls.bloomRadius,
        bloomThreshold: controls.bloomThreshold
      });

      if (!didTrigger) {
        setNotice({
          type: 'info',
          text: 'Nessuna pianta trovata per il QR appena letto.'
        });
        return false;
      }

      setNotice({
        type: 'success',
        text: `Bloom attivato su ${modelIds.length} piante.`
      });
      return true;
    },
    [controls.bloomEnabled, controls.bloomRadius, controls.bloomStrength, controls.bloomThreshold]
  );

  return {
    isReady,
    isBusy,
    controls,
    modelIds,
    stats,
    notice,
    setNotice,
    addFromFiles,
    addFromUrl,
    removeModel,
    resetCamera,
    triggerSelectiveBloom,
    updateControls
  };
}
