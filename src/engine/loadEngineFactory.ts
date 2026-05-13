import type { CreatePointcloudEngine } from './pointcloudEngineTypes';

const DEFAULT_ENGINE_MODULES = [
  'pointcloud-tool',
  'pointcloud-tool/engine',
  'pointcloud_tool',
  'pointcloud_tool/engine'
] as const;

type EngineModuleLike = {
  createPointcloudEngine?: unknown;
};

const KNOWN_IMPORTERS: Record<string, () => Promise<EngineModuleLike>> = {
  'pointcloud-tool': () => import('pointcloud-tool'),
  'pointcloud-tool/engine': () => import('pointcloud-tool/engine'),
  pointcloud_tool: () => import('pointcloud-tool'),
  'pointcloud_tool/engine': () => import('pointcloud-tool/engine')
};

function moduleIdsFromEnvOrDefault(): string[] {
  const envValue = import.meta.env.VITE_POINTCLOUD_ENGINE_MODULE;
  if (typeof envValue === 'string' && envValue.trim()) {
    const preferred = envValue.trim();
    return [
      preferred,
      ...DEFAULT_ENGINE_MODULES.filter((moduleId) => moduleId !== preferred)
    ];
  }

  return [...DEFAULT_ENGINE_MODULES];
}

async function importFactory(moduleId: string): Promise<CreatePointcloudEngine> {
  const knownImporter = KNOWN_IMPORTERS[moduleId];
  const module = knownImporter
    ? await knownImporter()
    : await importFromPathLike(moduleId);

  if (typeof module.createPointcloudEngine !== 'function') {
    throw new Error('Export createPointcloudEngine non trovato');
  }

  return module.createPointcloudEngine as CreatePointcloudEngine;
}

async function importFromPathLike(moduleId: string): Promise<EngineModuleLike> {
  const isPathLike =
    moduleId.startsWith('./') ||
    moduleId.startsWith('../') ||
    moduleId.startsWith('/') ||
    moduleId.startsWith('http://') ||
    moduleId.startsWith('https://');

  if (!isPathLike) {
    throw new Error(
      'Modulo bare non supportato in import dinamico runtime. Usa pointcloud-tool oppure un path/URL esplicito.'
    );
  }

  return (await import(/* @vite-ignore */ moduleId)) as EngineModuleLike;
}

export async function loadCreatePointcloudEngine(): Promise<CreatePointcloudEngine> {
  const candidates = moduleIdsFromEnvOrDefault();
  const failures: string[] = [];

  for (const moduleId of candidates) {
    try {
      return await importFactory(moduleId);
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : 'errore sconosciuto';
      failures.push(`${moduleId}: ${message}`);
    }
  }

  throw new Error(
    'Impossibile caricare il motore pointcloud. Tentativi eseguiti: ' +
      failures.join(' | ') +
      '. Configura VITE_POINTCLOUD_ENGINE_MODULE con il module id corretto.'
  );
}
