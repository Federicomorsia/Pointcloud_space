import type { RefObject } from 'react';
import logoPiantalaUrl from '../logo piantala.png';

interface PointcloudStageProps {
  stageRef: RefObject<HTMLDivElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  isReady: boolean;
  modelCount: number;
  totalPoints: number;
  showControlsButton?: boolean;
  onShowControls?: () => void;
}

export function PointcloudStage({
  stageRef,
  canvasRef,
  isReady,
  modelCount,
  totalPoints,
  showControlsButton = false,
  onShowControls
}: PointcloudStageProps) {
  return (
    <section className="pc-stage-panel" aria-label="Stage pointcloud">
      <div className="pc-stage" ref={stageRef}>
        <canvas ref={canvasRef} className="pc-canvas" />
        
        <div className="pc-stage-overlay">
          <div className="pc-stage-title">
            <img
              src={logoPiantalaUrl}
              alt="Piantala 2028"
              className="pc-stage-logo"
            />
          </div>
        </div>

        <div className="pc-stage-badge">
          <span>{isReady ? '■ online' : '○ init'}</span>
          <span>M: {modelCount}</span>
          <span>Pts: {totalPoints.toLocaleString('en-US')}</span>
        </div>

        {showControlsButton && (
          <button
            type="button"
            className="pc-show-controls"
            onClick={onShowControls}
            aria-label="Mostra pannello setup"
          >
            Mostra setup
          </button>
        )}
      </div>
    </section>
  );
}
