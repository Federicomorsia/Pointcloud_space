import { useRef, useState } from 'react';
import { PointcloudControls } from '../components/PointcloudControls';
import { PointcloudStage } from '../components/PointcloudStage';
import { usePointcloudEngine } from '../hooks/usePointcloudEngine';

export function PointcloudPage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [controlsHidden, setControlsHidden] = useState(false);

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
    <main className={`pc-layout ${controlsHidden ? 'pc-layout--controls-hidden' : ''}`}>
      <PointcloudControls
        controls={controls}
        modelIds={modelIds}
        isBusy={isBusy}
        notice={notice}
        isHidden={controlsHidden}
        onDismissNotice={() => setNotice(null)}
        onAddFiles={addFromFiles}
        onAddUrl={addFromUrl}
        onRemoveModel={removeModel}
        onUpdateControls={updateControls}
        onToggleVisibility={() => setControlsHidden((current) => !current)}
      />
      <PointcloudStage
        stageRef={stageRef}
        canvasRef={canvasRef}
        isReady={isReady}
        modelCount={stats.modelCount}
        totalPoints={stats.totalPoints}
        showControlsButton={controlsHidden}
        onShowControls={() => setControlsHidden(false)}
      />
    </main>
  );
}
