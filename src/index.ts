export { Session } from './core/Session';
export { EventEmitter } from './core/EventEmitter';
export { CVPipeline } from './cv/CVPipeline';
export { FeatureDetector } from './cv/FeatureDetector';
export { FeatureMatcher } from './cv/FeatureMatcher';
export type {
  SessionConfig,
  SessionEventMap,
  CameraConfig,
  Feature,
  Pose,
  Plane,
  Marker,
  HitTestResult,
  FrameData,
  TrackingResult,
} from './core/Config';
export type { CameraIntrinsics } from './math/Projection';

import { Session } from './core/Session';
import { SessionConfig } from './core/Config';

export const WebSLAM = {
  async createSession(config: SessionConfig): Promise<Session> {
    const session = new Session(config);
    await session.start();
    return session;
  },
};

export default WebSLAM;
