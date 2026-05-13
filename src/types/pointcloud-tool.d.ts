declare module 'pointcloud-tool' {
  import type { CreatePointcloudEngine } from '../engine/pointcloudEngineTypes';

  export const createPointcloudEngine: CreatePointcloudEngine;
  export default createPointcloudEngine;
}

declare module 'pointcloud-tool/engine' {
  import type { CreatePointcloudEngine } from '../engine/pointcloudEngineTypes';

  export const createPointcloudEngine: CreatePointcloudEngine;
  export default createPointcloudEngine;
}
