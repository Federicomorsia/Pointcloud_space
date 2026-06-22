const modelModules = import.meta.glob<string>(
  '/public/models/*.{glb,obj,gltf,ply}',
  { query: '?url', import: 'default', eager: true }
);

type PlantModelDefinition = {
  code: string;
  legacyCode: string;
  name: string;
  filename: string;
};

export type LocalPlantModel = PlantModelDefinition & {
  url: string;
};

/**
 * Catalogo dei modelli distribuiti con il giardino.
 * `legacyCode` mantiene compatibili i QR/eventi PIANTA-xxx gia esistenti.
 */
export const PLANT_MODEL_CATALOG = [
  {
    code: 'sv-001',
    legacyCode: 'PIANTA-001',
    name: 'Phalaenopsis Rosa',
    filename: 'Phalaenopsis Rosa sv-001.glb'
  },
  {
    code: 'sv-002',
    legacyCode: 'PIANTA-002',
    name: 'Monstera Deliciosa',
    filename: 'Monstera Deliciosa sv-002.ply'
  },
  {
    code: 'sv-003',
    legacyCode: 'PIANTA-003',
    name: 'Agave Blu',
    filename: 'Agave Blu sv-003.glb'
  },
  {
    code: 'sv-004',
    legacyCode: 'PIANTA-004',
    name: 'Alocasia Black Velvet',
    filename: 'Alocasia Black Velvet sv-004.ply'
  },
  {
    code: 'sv-005',
    legacyCode: 'PIANTA-005',
    name: 'Calathea Zebrina',
    filename: 'Calathea Zebrina sv-005.ply'
  },
  {
    code: 'sv-006',
    legacyCode: 'PIANTA-006',
    name: 'Tradescantia Zebrina',
    filename: 'Tradescantia Zebrina sv-006.ply'
  },
  {
    code: 'sv-007',
    legacyCode: 'PIANTA-007',
    name: 'Crassula Ovata',
    filename: 'Crassula Ovata sv-007.ply'
  },
  {
    code: 'sv-008',
    legacyCode: 'PIANTA-008',
    name: "Fittonia Albivenis 'Minima'",
    filename: "Fittonia Albivenis 'Minima' sv-008.ply"
  },
  {
    code: 'sv-009',
    legacyCode: 'PIANTA-009',
    name: 'Asparagus Setaceus',
    filename: 'Asparagus Setaceus sv-009.ply'
  },
  {
    code: 'sv-010',
    legacyCode: 'PIANTA-010',
    name: 'Dracaena Trifasciata',
    filename: 'Dracaena Trifasciata sv-010.ply'
  }
] as const satisfies readonly PlantModelDefinition[];

const normalizeModelKey = (value: string) =>
  value
    .split('?')[0]
    .split('#')[0]
    .split('/')
    .pop()
    ?.replace(/\.(obj|glb|gltf|ply)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim() ?? '';

const getTrailingModelNumber = (value: string) =>
  value.match(/(\d+)$/)?.[1]?.replace(/^0+/, '') || null;

const discoveredModels = Object.entries(modelModules).map(([path, url]) => ({
  filename: path.replace('/public/models/', ''),
  url: url.replace(/^\/public\//, '/')
}));

const discoveredByFilename = new Map(
  discoveredModels.map((model) => [model.filename, model.url])
);

const catalogModels: LocalPlantModel[] = PLANT_MODEL_CATALOG.flatMap((definition) => {
  const url = discoveredByFilename.get(definition.filename);
  return url ? [{ ...definition, url }] : [];
});

// Eventuali modelli extra restano disponibili senza richiedere modifiche al catalogo.
const catalogFilenames = new Set<string>(PLANT_MODEL_CATALOG.map((model) => model.filename));
const extraModels: LocalPlantModel[] = discoveredModels
  .filter((model) => !catalogFilenames.has(model.filename))
  .sort((a, b) => a.filename.localeCompare(b.filename))
  .map((model) => ({
    code: '',
    legacyCode: '',
    name: model.filename.replace(/\.(obj|glb|gltf|ply)$/i, ''),
    ...model
  }));

export const LOCAL_PLANT_MODELS: LocalPlantModel[] = [...catalogModels, ...extraModels];
export const LOCAL_MODEL_FILES = LOCAL_PLANT_MODELS.map((model) => model.filename);

const getAliases = (model: LocalPlantModel) =>
  [model.code, model.legacyCode, model.name, model.filename]
    .map(normalizeModelKey)
    .filter(Boolean);

function findLocalModel(key: string): LocalPlantModel | undefined {
  const exact = LOCAL_PLANT_MODELS.find((model) => getAliases(model).includes(key));
  if (exact) {
    return exact;
  }

  const numericAlias = getTrailingModelNumber(key);
  if (numericAlias) {
    const numericExact = LOCAL_PLANT_MODELS.find((model) => {
      return getTrailingModelNumber(normalizeModelKey(model.code || model.filename)) === numericAlias;
    });

    if (numericExact) {
      return numericExact;
    }
  }

  const partial = LOCAL_PLANT_MODELS.find((model) => {
    return getAliases(model).some((alias) => alias.includes(key) || key.includes(alias));
  });
  if (partial) {
    return partial;
  }

  const firstWord = key.match(/[a-z]+/)?.[0];
  return firstWord
    ? LOCAL_PLANT_MODELS.find((model) => normalizeModelKey(model.name).includes(firstWord))
    : undefined;
}

export function resolveLocalModelUrl(modelKey?: string | null, modelUrl?: string | null) {
  const lookupKeys = [modelKey, modelUrl]
    .map((value) => normalizeModelKey(value ?? ''))
    .filter(Boolean);

  for (const key of lookupKeys) {
    const localModel = findLocalModel(key);
    if (localModel) {
      return localModel.url;
    }
  }

  return modelUrl?.replace(/^\/public\//, '/') ?? null;
}
