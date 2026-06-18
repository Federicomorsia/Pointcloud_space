const modelModules = import.meta.glob<string>(
  '/public/models/*.{glb,obj,gltf,ply}',
  { query: '?url', import: 'default', eager: true }
);

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

const modelEntries = Object.entries(modelModules).map(([path, url]) => {
  const filename = path.replace('/public/models/', '');
  const normalized = normalizeModelKey(filename);
  const publicUrl = url.replace(/^\/public\//, '/');

  return {
    filename,
    normalized,
    url: publicUrl
  };
});

export const LOCAL_MODEL_FILES = modelEntries.map((entry) => entry.filename);

export function resolveLocalModelUrl(modelKey?: string | null, modelUrl?: string | null) {
  const preferredKey = normalizeModelKey(modelKey ?? '');
  const fallbackKey = normalizeModelKey(modelUrl ?? '');
  const key = preferredKey || fallbackKey;

  if (!key) {
    return modelUrl ?? null;
  }

  const exact = modelEntries.find((entry) => entry.normalized === key);
  if (exact) {
    return exact.url;
  }

  const numericAlias = getTrailingModelNumber(key);
  if (numericAlias) {
    const numericExact = modelEntries.find((entry) => {
      return getTrailingModelNumber(entry.normalized) === numericAlias;
    });

    if (numericExact) {
      return numericExact.url;
    }
  }

  const partial = modelEntries.find((entry) => {
    return entry.normalized.includes(key) || key.includes(entry.normalized);
  });
  if (partial) {
    return partial.url;
  }

  const firstWord = key.match(/[a-z]+/)?.[0];
  const loose = firstWord
    ? modelEntries.find((entry) => entry.normalized.includes(firstWord))
    : null;

  return loose?.url ?? modelUrl?.replace(/^\/public\//, '/') ?? null;
}
