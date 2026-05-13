# Pointcloud Space

Integrazione production-ready di `createPointcloudEngine` in una pagina standalone React + TypeScript (Vite), con adapter locale riusabile, UI dark theme professionale (copiato dallo stile del GitHub pointcloud-tool origine), e lifecycle management robusto.

## Design e Stile

- **Dark theme**: Ispirato al design del progetto sorgente pointcloud-tool (GitHub)
- **Font**: Space Grotesk per titoli, Space Mono per valori
- **Layout**: Pannello controlli a sinistra (300px fisso), stage 3D a destra (responsive)
- **Sezioni collassabili**: Raggruppa controlli per categoria (Import, Remote URL, Models, Camera, Motion, Bloom)
- **Badge stats**: Monitoraggio live di modelli e punti totali sulla canvas

## Architettura

- `src/engine/pointcloudAdapter.ts`
  - Wrapper locale dell'engine.
  - Valida formati file/URL.
  - Carica modelli con random placement.
  - Esegue `frameAllModels()` dopo batch di caricamento.
  - Espone API pulite per UI (`add`, `remove`, `reset`, `setRuntimeOptions`, `syncSize`, `dispose`).

- `src/engine/loadEngineFactory.ts`
  - Carica dinamicamente il modulo che esporta `createPointcloudEngine`.
  - Modulo configurabile via `VITE_POINTCLOUD_ENGINE_MODULE`.
  - Supporto automatico per varianti: `pointcloud-tool`, `pointcloud-tool/engine`, `pointcloud_tool`.

- `src/hooks/usePointcloudEngine.ts`
  - Wiring lifecycle React.
  - Init engine robusta con `stage` + `canvas`.
  - `ResizeObserver` con `requestAnimationFrame`.
  - Cleanup completo in unmount e `beforeunload`.

- `src/components/ControlSection.tsx`
  - Componente collassabile riusabile per raggruppare controlli.

- `src/components/PointcloudControls.tsx`
  - Pannello controlli con sezioni organizzate.

- `src/components/PointcloudStage.tsx`
  - Stage/canvas mount point con badge stats.

- `src/pages/PointcloudPage.tsx`
  - Orchestrazione pagina standalone.

- `src/styles.css`
  - Dark theme completo, spacing coerente, responsive design.


## Requisiti

- Node.js 18+
- Modulo engine che esporta `createPointcloudEngine`

Per default viene usato `pointcloud-tool`. Se il tuo engine e privato o locale, imposta nel file `.env`:

```bash
VITE_POINTCLOUD_ENGINE_MODULE=@my-scope/pointcloud-tool
```

Oppure un path locale risolvibile da Vite, ad esempio:

```bash
VITE_POINTCLOUD_ENGINE_MODULE=./src/vendor/pointcloud-engine
```

Nota: installando da `github:federicomorsia/Pointcloud_tool` il nome pacchetto risolto da npm resta `pointcloud-tool`.
Il loader locale prova comunque automaticamente anche `pointcloud_tool` e i subpath `/engine`.

## Avvio

```bash
npm install
npm run dev
```

Build produzione:

```bash
npm run build
npm run preview
```

## Controlli disponibili

- Aggiungi modelli da file (`.obj`, `.glb`) con upload multiplo
- Aggiungi modello da URL (`.obj`, `.glb`, `.gltf`)
- Rimuovi modello per `id`
- Reset camera
- Toggle auto-rotate
- Densita punti
- Point size
- Bloom on/off + strength/radius/threshold

## Error handling

Messaggi utente espliciti per i casi principali:

- formato non valido
- parsing fallito
- nessun modello disponibile per azioni camera
- engine non pronto

## Note performance e lifecycle

- L'engine viene creato una sola volta per mount.
- Le modifiche dei controlli usano `setOptions`, senza ricreare engine/scena.
- Resize gestito via observer con debounce a frame.
- Cleanup completo con `dispose()` per prevenire memory leak.

## Checklist verifica manuale

1. Avvia app e verifica che lo stage sia visibile e senza errori in console.
2. Carica 2 o piu file validi (`.obj/.glb`) e conferma che appaiano tutti in point cloud.
3. Verifica disposizione casuale nello spazio tra caricamenti multipli.
4. Usa `reset camera` e controlla framing su tutti i modelli.
5. Attiva/disattiva `auto-rotate` e controlla effetto immediato.
6. Modifica `densita punti` e `point size` e verifica update live.
7. Attiva/disattiva bloom e regola strength/radius/threshold.
8. Rimuovi un modello e verifica aggiornamento scena e statistiche.
9. Inserisci URL non valido o formato non supportato e verifica messaggio chiaro.
10. Naviga via dalla pagina o ricarica e verifica assenza errori legati a dispose.
