/**
 * Debug Models Configuration
 * 
 * Auto-scansiona i modelli nella cartella /public/models/
 * Niente da modificare, funziona automaticamente!
 */

// Glob automatico dei modelli disponibili
const modelModules = import.meta.glob<string>(
  '/public/models/*.{glb,obj}',
  { query: '?url', import: 'default', eager: true }
);

// Estrai i nomi dei file dal percorso
export const DEBUG_MODEL_FILES = Object.keys(modelModules)
  .map(path => path.replace('/public/models/', ''))
  .sort();

export async function loadDebugModels(
  onAddUrl: (url: string, animationDuration?: number) => Promise<void>,
  onNotice?: (message: string, type: 'info' | 'success' | 'error') => void,
  animationDuration = 600
): Promise<{ loaded: string[]; failed: string[] }> {
  const loaded: string[] = [];
  const failed: string[] = [];

  if (!DEBUG_MODEL_FILES.length) {
    const msg = 'Nessun modello trovato in /public/models/';
    onNotice?.(msg, 'info');
    throw new Error(msg);
  }

  onNotice?.(`Caricamento ${DEBUG_MODEL_FILES.length} modelli...`, 'info');

  // Costruisci URL assoluti con window.location.origin
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  // Stagger caricamenti per ridurre lag: 80ms tra ogni modello
  for (let i = 0; i < DEBUG_MODEL_FILES.length; i++) {
    const filename = DEBUG_MODEL_FILES[i];
    const url = `${baseUrl}/models/${filename}`;
    
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

  const summary = `${loaded.length}/${DEBUG_MODEL_FILES.length} modelli caricati`;
  onNotice?.(summary, loaded.length > 0 ? 'success' : 'error');

  return { loaded, failed };
}
