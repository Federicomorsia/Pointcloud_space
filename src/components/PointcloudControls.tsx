import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { loadDebugModels } from '../config/debugModels';
import type { EngineControlsState, EngineNotice } from '../hooks/usePointcloudEngine';

interface PointcloudControlsProps {
  controls: EngineControlsState;
  modelIds: string[];
  isBusy: boolean;
  notice: EngineNotice | null;
  isHidden: boolean;
  onDismissNotice: () => void;
  onAddFiles: (files: FileList | null) => Promise<void>;
  onAddUrl: (url: string, animationDuration?: number) => Promise<void>;
  onRemoveModel: (id: string) => void;
  onUpdateControls: (partial: Partial<EngineControlsState>) => void;
  onToggleVisibility: () => void;
}

export function PointcloudControls({
  controls,
  modelIds,
  isBusy,
  notice,
  isHidden,
  onDismissNotice,
  onAddFiles,
  onAddUrl,
  onRemoveModel,
  onUpdateControls,
  onToggleVisibility
}: PointcloudControlsProps) {
  const [removeId, setRemoveId] = useState('');
  const [urlValue, setUrlValue] = useState('');
  const [isLoadingDebug, setIsLoadingDebug] = useState(false);

  const hasModels = modelIds.length > 0;

  const handleFileInput = async (event: ChangeEvent<HTMLInputElement>) => {
    await onAddFiles(event.currentTarget.files);
    event.currentTarget.value = '';
  };

  const handleAddUrl = async () => {
    try {
      await onAddUrl(urlValue);
      setUrlValue('');
    } catch {
      // Notice is handled by the engine hook.
    }
  };

  const handleRemove = () => {
    onRemoveModel(removeId);
    setRemoveId('');
  };

  const handleLoadDebugModels = async () => {
    setIsLoadingDebug(true);
    try {
      await loadDebugModels(onAddUrl, (message, type) => {
        // Feedback visuale dei messaggi di caricamento
        console.log(`[${type.toUpperCase()}] ${message}`);
      });
    } catch (error) {
      // Error already handled via notice in loadDebugModels
    } finally {
      setIsLoadingDebug(false);
    }
  };

  return (
    <aside
      className={`pc-controls ${isHidden ? 'pc-controls-hidden' : ''}`}
      aria-label="Controlli pointcloud"
    >
      <div className="pc-controls-header">
        <div className="pc-controls-title">
          <h1>PCL Setup</h1>
          <p>Load models and configure rendering</p>
        </div>
        <button
          type="button"
          className="pc-controls-toggle"
          onClick={onToggleVisibility}
          aria-label={isHidden ? 'Mostra pannello setup' : 'Nascondi pannello setup'}
        >
          {isHidden ? 'Mostra' : 'Nascondi'}
        </button>
      </div>

      {notice && (
        <div className={`pc-notice pc-notice-${notice.type}`} role="status" aria-live="polite">
          <span>{notice.text}</span>
          <button type="button" onClick={onDismissNotice}>×</button>
        </div>
      )}

      <div className="pc-controls-content">
        {/* Import section */}
        <div className="pc-col">
          <label className="pc-label">
            <span>Load Files</span>
            <input
              type="file"
              accept=".obj,.glb"
              multiple
              onChange={handleFileInput}
              disabled={isBusy}
            />
            <button
              type="button"
              onClick={() => document.querySelector<HTMLInputElement>('input[type="file"]')?.click()}
              disabled={isBusy}
            >
              Select
            </button>
          </label>
        </div>

        {/* Remote URL section */}
        <div className="pc-col">
          <label className="pc-label">
            <span>Remote URL</span>
            <div className="pc-inline-group">
              <input
                type="url"
                value={urlValue}
                onChange={(event) => setUrlValue(event.currentTarget.value)}
                placeholder="https://..."
                disabled={isBusy}
              />
              <button type="button" onClick={handleAddUrl} disabled={isBusy}>
                Add
              </button>
            </div>
          </label>
        </div>

        {/* Debug Models section */}
        <div className="pc-col">
          <button
            type="button"
            onClick={handleLoadDebugModels}
            disabled={isBusy || isLoadingDebug}
            title="Carica i modelli configurati in src/config/debugModels.ts"
          >
            {isLoadingDebug ? '⟳ Loading...' : 'Load Debug Models'}
          </button>
        </div>

        {/* Row: Density + Size */}
        <div className="pc-row">
          <div>
            <label className="pc-label">
              <span>Density</span>
              <input
                type="range"
                min={1}
                max={20}
                step={1}
                value={controls.pointDensity}
                onChange={(event) =>
                  onUpdateControls({
                    pointDensity: Number.parseInt(event.currentTarget.value, 10)
                  })
                }
              />
              <span className="pc-label-value">{controls.pointDensity}</span>
            </label>
          </div>
          <div>
            <label className="pc-label">
              <span>Point Size</span>
              <input
                type="range"
                min={0.005}
                max={0.1}
                step={0.001}
                value={controls.pointSize}
                onChange={(event) =>
                  onUpdateControls({ pointSize: Number.parseFloat(event.currentTarget.value) })
                }
              />
              <span className="pc-label-value">{controls.pointSize.toFixed(3)}</span>
            </label>
          </div>
        </div>

        {/* Row: Brightness + Saturation */}
        <div className="pc-row">
          <div>
            <label className="pc-label">
              <span>Brightness</span>
              <input
                type="range"
                min={0.5}
                max={2.2}
                step={0.02}
                value={controls.exposure}
                onChange={(event) =>
                  onUpdateControls({ exposure: Number.parseFloat(event.currentTarget.value) })
                }
              />
              <span className="pc-label-value">{controls.exposure.toFixed(2)}</span>
            </label>
          </div>
          <div>
            <label className="pc-label">
              <span>Saturation</span>
              <input
                type="range"
                min={0.3}
                max={2}
                step={0.02}
                value={controls.saturation}
                onChange={(event) =>
                  onUpdateControls({ saturation: Number.parseFloat(event.currentTarget.value) })
                }
              />
              <span className="pc-label-value">{controls.saturation.toFixed(2)}</span>
            </label>
          </div>
        </div>

        {/* Remove Model */}
        <div className="pc-col">
          <label className="pc-label">
            <span>Remove Model</span>
            <div className="pc-inline-group">
              <select
                value={removeId}
                onChange={(event) => setRemoveId(event.currentTarget.value)}
                disabled={!hasModels || isBusy}
              >
                <option value="">— choose —</option>
                {modelIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <button type="button" onClick={handleRemove} disabled={!removeId || isBusy}>
                Remove
              </button>
            </div>
          </label>
        </div>

        {/* Row: Auto-Rotate + Bloom */}
        <div className="pc-row">
          <div>
            <label className="pc-toggle-row">
              <span>Auto-Rotate</span>
              <input
                type="checkbox"
                checked={controls.autoRotate}
                onChange={(event) => onUpdateControls({ autoRotate: event.currentTarget.checked })}
              />
            </label>
          </div>
          <div>
            <label className="pc-toggle-row">
              <span>Bloom</span>
              <input
                type="checkbox"
                checked={controls.bloomEnabled}
                onChange={(event) => onUpdateControls({ bloomEnabled: event.currentTarget.checked })}
              />
            </label>
          </div>
        </div>

        {/* Row: Bloom Strength + Radius */}
        <div className="pc-row">
          <div>
            <label className="pc-label">
              <span>Strength</span>
              <input
                type="range"
                min={0}
                max={3}
                step={0.05}
                value={controls.bloomStrength}
                onChange={(event) =>
                  onUpdateControls({ bloomStrength: Number.parseFloat(event.currentTarget.value) })
                }
              />
              <span className="pc-label-value">{controls.bloomStrength.toFixed(2)}</span>
            </label>
          </div>
          <div>
            <label className="pc-label">
              <span>Radius</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={controls.bloomRadius}
                onChange={(event) =>
                  onUpdateControls({ bloomRadius: Number.parseFloat(event.currentTarget.value) })
                }
              />
              <span className="pc-label-value">{controls.bloomRadius.toFixed(2)}</span>
            </label>
          </div>
        </div>

        {/* Bloom Threshold */}
        <div className="pc-col">
          <label className="pc-label">
            <span>Threshold</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={controls.bloomThreshold}
              onChange={(event) =>
                onUpdateControls({ bloomThreshold: Number.parseFloat(event.currentTarget.value) })
              }
            />
            <span className="pc-label-value">{controls.bloomThreshold.toFixed(2)}</span>
          </label>
        </div>

        {/* View Debug: Camera Position */}
        <div className="pc-row">
          <div>
            <label className="pc-label">
              <span>Cam X</span>
              <input
                type="range"
                min={-20}
                max={20}
                step={0.1}
                value={controls.cameraX}
                onChange={(event) =>
                  onUpdateControls({ cameraX: Number.parseFloat(event.currentTarget.value) })
                }
              />
              <span className="pc-label-value">{controls.cameraX.toFixed(1)}</span>
            </label>
          </div>
          <div>
            <label className="pc-label">
              <span>Cam Y</span>
              <input
                type="range"
                min={-20}
                max={20}
                step={0.1}
                value={controls.cameraY}
                onChange={(event) =>
                  onUpdateControls({ cameraY: Number.parseFloat(event.currentTarget.value) })
                }
              />
              <span className="pc-label-value">{controls.cameraY.toFixed(1)}</span>
            </label>
          </div>
        </div>

        <div className="pc-row">
          <div>
            <label className="pc-label">
              <span>Cam Z</span>
              <input
                type="range"
                min={1}
                max={40}
                step={0.1}
                value={controls.cameraZ}
                onChange={(event) =>
                  onUpdateControls({ cameraZ: Number.parseFloat(event.currentTarget.value) })
                }
              />
              <span className="pc-label-value">{controls.cameraZ.toFixed(1)}</span>
            </label>
          </div>
          <div>
            <label className="pc-label">
              <span>Target Y</span>
              <input
                type="range"
                min={-15}
                max={15}
                step={0.1}
                value={controls.targetY}
                onChange={(event) =>
                  onUpdateControls({ targetY: Number.parseFloat(event.currentTarget.value) })
                }
              />
              <span className="pc-label-value">{controls.targetY.toFixed(1)}</span>
            </label>
          </div>
        </div>

        <div className="pc-row">
          <div>
            <label className="pc-label">
              <span>Target X</span>
              <input
                type="range"
                min={-15}
                max={15}
                step={0.1}
                value={controls.targetX}
                onChange={(event) =>
                  onUpdateControls({ targetX: Number.parseFloat(event.currentTarget.value) })
                }
              />
              <span className="pc-label-value">{controls.targetX.toFixed(1)}</span>
            </label>
          </div>
          <div>
            <label className="pc-label">
              <span>Target Z</span>
              <input
                type="range"
                min={-15}
                max={15}
                step={0.1}
                value={controls.targetZ}
                onChange={(event) =>
                  onUpdateControls({ targetZ: Number.parseFloat(event.currentTarget.value) })
                }
              />
              <span className="pc-label-value">{controls.targetZ.toFixed(1)}</span>
            </label>
          </div>
        </div>
      </div>
    </aside>
  );
}
