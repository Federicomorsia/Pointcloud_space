import { useRef } from 'react';
import { PointcloudControls } from '../components/PointcloudControls';
import { PointcloudStage } from '../components/PointcloudStage';
import { usePointcloudEngine } from '../hooks/usePointcloudEngine';

export function PointcloudPage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const {
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
    updateControls
  } = usePointcloudEngine({
    stageRef,
    canvasRef
  });

  return (
    <main className="pc-layout">
      <PointcloudControls
        controls={controls}
        modelIds={modelIds}
        isBusy={isBusy}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        onAddFiles={addFromFiles}
        onAddUrl={addFromUrl}
        onRemoveModel={removeModel}
        onUpdateControls={updateControls}
      />
      <PointcloudStage
        stageRef={stageRef}
        canvasRef={canvasRef}
        isReady={isReady}
        modelCount={stats.modelCount}
        totalPoints={stats.totalPoints}
      />
    </main>
  );
}
