import { LOCAL_PLANT_MODELS } from './modelRegistry';

/**
 * Debug Models Configuration
 *
 * Usa lo stesso catalogo del caricamento realtime, evitando di ricostruire
 * manualmente gli URL dei file con spazi o caratteri speciali.
 */

export const DEBUG_MODEL_FILES = LOCAL_PLANT_MODELS.map((model) => model.filename);

export async function loadDebugModels(
  onAddUrl: (url: string, animationDuration?: number) => Promise<void>,
  onNotice?: (message: string, type: 'info' | 'success' | 'error') => void,
  animationDuration = 600
): Promise<{ loaded: string[]; failed: string[] }> {
  const loaded: string[] = [];
  const failed: string[] = [];

  if (!LOCAL_PLANT_MODELS.length) {
    const msg = 'Nessun modello trovato in /public/models/';
    onNotice?.(msg, 'info');
    throw new Error(msg);
  }

  onNotice?.(`Caricamento ${LOCAL_PLANT_MODELS.length} modelli...`, 'info');

  // Stagger caricamenti per ridurre lag: 80ms tra ogni modello
  for (let i = 0; i < LOCAL_PLANT_MODELS.length; i++) {
    const { filename, url } = LOCAL_PLANT_MODELS[i];

    // Delay progressivo per distribuzione carico
    await new Promise(resolve => setTimeout(resolve, i * 80));

    try {
      // Check if file exists with HEAD request
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok) {
        await onAddUrl(url, animationDuration);
        loaded.push(filename);
        onNotice?.(`✓ Caricato: ${filename}`, 'success');
      } else {
        failed.push(filename);
        onNotice?.(`✗ File non trovato: ${filename}`, 'error');
      }
    } catch (error) {
      failed.push(filename);
      onNotice?.(`✗ Errore caricamento: ${filename}`, 'error');
    }
  }

  const summary = `${loaded.length}/${LOCAL_PLANT_MODELS.length} modelli caricati`;
  onNotice?.(summary, loaded.length > 0 ? 'success' : 'error');

  return { loaded, failed };
}
