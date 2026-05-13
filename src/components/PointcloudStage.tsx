import type { RefObject } from 'react';

interface PointcloudStageProps {
  stageRef: RefObject<HTMLDivElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  isReady: boolean;
  modelCount: number;
  totalPoints: number;
}

export function PointcloudStage({
  stageRef,
  canvasRef,
  isReady,
  modelCount,
  totalPoints
}: PointcloudStageProps) {
  return (
    <section className="pc-stage-panel" aria-label="Stage pointcloud">
      <div className="pc-stage" ref={stageRef}>
        <canvas ref={canvasRef} className="pc-canvas" />
        
        <div className="pc-stage-overlay">
          <div className="pc-stage-title">
            <h2>PIANTALA</h2>
            <h3>2028</h3>
          </div>
        </div>

        <div className="pc-stage-badge">
          <span>{isReady ? '■ online' : '○ init'}</span>
          <span>M: {modelCount}</span>
          <span>Pts: {totalPoints.toLocaleString('en-US')}</span>
        </div>
      </div>
    </section>
  );
}
