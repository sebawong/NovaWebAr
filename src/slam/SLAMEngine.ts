import { FeatureDetector, Keypoint } from '../cv/FeatureDetector';
import { FeatureMatcher, Match } from '../cv/FeatureMatcher';
import { Initializer, InitializationResult } from './Initializer';
import { PoseEstimator, PoseEstimation } from './PoseEstimator';
import { MotionModel } from './MotionModel';
import { MapManager } from './MapManager';
import { CameraIntrinsics } from '../math/Projection';

export type SLAMState = 'uninitialized' | 'initializing' | 'tracking' | 'lost';

export interface SLAMFrameResult {
  state: SLAMState;
  rotation: Float64Array | null;
  translation: Float64Array | null;
  keypoints: Keypoint[];
  mapPointCount: number;
  keyframeCount: number;
  inlierCount: number;
  matchCount: number;
}

/**
 * Main SLAM pipeline.
 *
 * States:
 * - uninitialized: no reference frame yet
 * - initializing: have reference, waiting for enough parallax
 * - tracking: actively tracking camera pose against map
 * - lost: tracking failed, trying to relocalize
 */
export class SLAMEngine {
  private state: SLAMState = 'uninitialized';
  private detector: FeatureDetector;
  private matcher: FeatureMatcher;
  private initializer: Initializer;
  private poseEstimator: PoseEstimator;
  private motionModel: MotionModel;
  private map: MapManager;
  private intrinsics: CameraIntrinsics;

  private currentDescriptors: any = null;
  private currentKeypoints: Keypoint[] = [];
  private referenceDescriptors: any = null;
  private referenceKeypoints: Keypoint[] = [];
  private lostFrameCount = 0;
  private maxLostFrames = 30;

  constructor(intrinsics: CameraIntrinsics) {
    this.intrinsics = intrinsics;
    this.detector = new FeatureDetector(600);
    this.matcher = new FeatureMatcher(0.75);
    this.initializer = new Initializer();
    this.poseEstimator = new PoseEstimator();
    this.motionModel = new MotionModel();
    this.map = new MapManager();
  }

  processFrame(imageData: ImageData): SLAMFrameResult {
    // Convert to grayscale and detect features
    const gray = this.detector.imageToGray(imageData);
    const detection = this.detector.detect(gray);
    gray.delete();

    this.currentKeypoints = detection.keypoints;

    // Dispose previous descriptors
    if (this.currentDescriptors) {
      this.currentDescriptors.delete();
    }
    this.currentDescriptors = detection.descriptors;

    this.map.incrementFrame();

    let result: SLAMFrameResult;

    switch (this.state) {
      case 'uninitialized':
        result = this.handleUninitialized();
        break;
      case 'initializing':
        result = this.handleInitializing();
        break;
      case 'tracking':
        result = this.handleTracking();
        break;
      case 'lost':
        result = this.handleLost();
        break;
    }

    return result;
  }

  private handleUninitialized(): SLAMFrameResult {
    // Need enough features to start
    if (this.currentKeypoints.length >= 50) {
      this.initializer.setReferenceFrame(this.currentKeypoints, this.currentDescriptors);
      // Store reference for matching during initialization
      if (this.referenceDescriptors) this.referenceDescriptors.delete();
      this.referenceDescriptors = this.currentDescriptors.clone();
      this.referenceKeypoints = [...this.currentKeypoints];
      this.state = 'initializing';
    }

    return this.makeResult(0, 0);
  }

  private handleInitializing(): SLAMFrameResult {
    if (!this.initializer.hasReference() || this.currentKeypoints.length < 30) {
      return this.makeResult(0, 0);
    }

    // Match current frame against stored reference
    if (!this.referenceDescriptors || this.referenceDescriptors.rows === 0) {
      return this.makeResult(0, 0);
    }

    const matchResult = this.matcher.match(
      this.referenceDescriptors,
      this.currentDescriptors,
      this.referenceKeypoints,
      this.currentKeypoints,
    );

    if (matchResult.matches.length < 20) {
      return this.makeResult(0, matchResult.matches.length);
    }

    const initResult = this.initializer.tryInitialize(
      this.currentKeypoints,
      matchResult.matches,
      this.intrinsics,
    );

    if (initResult) {
      this.bootstrapMap(initResult);
      this.state = 'tracking';
      return this.makeResult(initResult.inlierIndices.length, matchResult.matches.length);
    }

    return this.makeResult(0, matchResult.matches.length);
  }

  private handleTracking(): SLAMFrameResult {
    const lastKf = this.map.getLastKeyFrame();
    if (!lastKf) {
      this.state = 'lost';
      return this.makeResult(0, 0);
    }

    // Match current frame against last keyframe
    const matchResult = this.matcher.match(
      lastKf.descriptors,
      this.currentDescriptors,
      lastKf.keypoints,
      this.currentKeypoints,
    );

    if (matchResult.matches.length < 10) {
      this.lostFrameCount++;
      if (this.lostFrameCount > this.maxLostFrames) {
        this.state = 'lost';
      }
      return this.makeResult(0, matchResult.matches.length);
    }

    // Build 2D-3D correspondences from matches
    const points2D: { x: number; y: number }[] = [];
    const points3D: { x: number; y: number; z: number }[] = [];
    const matchedIndices: number[] = [];

    for (const m of matchResult.matches) {
      const mpId = lastKf.mapPointIds[m.queryIdx];
      if (mpId < 0) continue;

      const mp = this.map.getMapPoint(mpId);
      if (!mp) continue;

      points2D.push({
        x: this.currentKeypoints[m.trainIdx].x,
        y: this.currentKeypoints[m.trainIdx].y,
      });
      points3D.push(mp.position);
      matchedIndices.push(m.trainIdx);
    }

    // If not enough 2D-3D matches, try pose from essential matrix
    if (points2D.length < 6) {
      this.lostFrameCount++;
      if (this.lostFrameCount > this.maxLostFrames) {
        this.state = 'lost';
      }
      return this.makeResult(0, matchResult.matches.length);
    }

    // Estimate pose via PnP
    const pose = this.poseEstimator.estimatePose(
      points2D, points3D, this.intrinsics,
    );

    if (!pose || pose.inlierCount < 6) {
      this.lostFrameCount++;
      if (this.lostFrameCount > this.maxLostFrames) {
        this.state = 'lost';
      }
      return this.makeResult(pose?.inlierCount ?? 0, matchResult.matches.length);
    }

    // Tracking success
    this.lostFrameCount = 0;
    this.motionModel.update(pose.rotation, pose.translation);

    // Mark seen map points
    for (const m of matchResult.matches) {
      const mpId = lastKf.mapPointIds[m.queryIdx];
      if (mpId >= 0) this.map.markPointSeen(mpId);
    }

    // Check if we need a new keyframe
    if (this.map.needsNewKeyframe(pose.inlierCount, this.map.getMapPointCount())) {
      this.addNewKeyframe(pose, matchResult.matches, lastKf);
    }

    // Periodic cleanup
    if (this.map.getCurrentFrame() % 50 === 0) {
      this.map.pruneMapPoints();
    }

    return {
      state: this.state,
      rotation: pose.rotation,
      translation: pose.translation,
      keypoints: this.currentKeypoints,
      mapPointCount: this.map.getMapPointCount(),
      keyframeCount: this.map.getKeyFrameCount(),
      inlierCount: pose.inlierCount,
      matchCount: matchResult.matches.length,
    };
  }

  private handleLost(): SLAMFrameResult {
    // Try to re-initialize
    if (this.currentKeypoints.length >= 50) {
      this.reset();
      this.initializer.setReferenceFrame(this.currentKeypoints, this.currentDescriptors);
      this.state = 'initializing';
    }
    return this.makeResult(0, 0);
  }

  private bootstrapMap(init: InitializationResult): void {
    this.map.reset();

    // Add first keyframe (identity pose)
    const identityR = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const zeroT = new Float64Array([0, 0, 0]);

    // Create map point IDs for reference keypoints
    const refMapPointIds = new Array(init.queryKeypoints.length).fill(-1);

    // Add 3D points and link to keypoint indices
    for (let i = 0; i < init.inlierIndices.length && i < init.points3D.length; i++) {
      const matchIdx = init.inlierIndices[i];
      if (matchIdx < init.queryKeypoints.length) {
        const ptId = this.map.addMapPoint(init.points3D[i]);
        refMapPointIds[matchIdx] = ptId;
      }
    }

    // We need reference descriptors — re-detect or use stored
    // For bootstrapping, we'll create a dummy keyframe with current data
    // and the identity pose
    this.map.addKeyFrame(
      identityR, zeroT,
      init.queryKeypoints,
      this.currentDescriptors, // using current as proxy
      refMapPointIds,
    );

    // Add second keyframe with recovered pose
    const currMapPointIds = new Array(this.currentKeypoints.length).fill(-1);

    // Link current keypoints to map points via inlier matches
    for (let i = 0; i < init.inlierIndices.length && i < init.points3D.length; i++) {
      const matchIdx = init.inlierIndices[i];
      if (matchIdx < refMapPointIds.length && refMapPointIds[matchIdx] >= 0) {
        // Find the trainIdx for this match
        // inlierIndices are indices into the original match array
        // For simplicity, use the same index mapping
        if (matchIdx < currMapPointIds.length) {
          currMapPointIds[matchIdx] = refMapPointIds[matchIdx];
        }
      }
    }

    this.map.addKeyFrame(
      init.rotation, init.translation,
      this.currentKeypoints,
      this.currentDescriptors,
      currMapPointIds,
    );

    this.motionModel.update(init.rotation, init.translation);
  }

  private addNewKeyframe(
    pose: PoseEstimation,
    matches: Match[],
    lastKf: { mapPointIds: number[]; keypoints: Keypoint[] },
  ): void {
    const mapPointIds = new Array(this.currentKeypoints.length).fill(-1);

    // Transfer existing map point associations
    for (const m of matches) {
      const mpId = lastKf.mapPointIds[m.queryIdx];
      if (mpId >= 0) {
        mapPointIds[m.trainIdx] = mpId;
      }
    }

    // Add new map points for unmatched features (triangulation would go here)
    // For now, skip triangulation of new points — future improvement

    this.map.addKeyFrame(
      pose.rotation,
      pose.translation,
      this.currentKeypoints,
      this.currentDescriptors,
      mapPointIds,
    );
  }

  private makeResult(inlierCount: number, matchCount: number): SLAMFrameResult {
    return {
      state: this.state,
      rotation: null,
      translation: null,
      keypoints: this.currentKeypoints,
      mapPointCount: this.map.getMapPointCount(),
      keyframeCount: this.map.getKeyFrameCount(),
      inlierCount,
      matchCount,
    };
  }

  getState(): SLAMState {
    return this.state;
  }

  reset(): void {
    this.state = 'uninitialized';
    this.initializer.reset();
    this.motionModel.reset();
    this.map.reset();
    this.lostFrameCount = 0;
    if (this.currentDescriptors) {
      this.currentDescriptors.delete();
      this.currentDescriptors = null;
    }
    if (this.referenceDescriptors) {
      this.referenceDescriptors.delete();
      this.referenceDescriptors = null;
    }
    this.referenceKeypoints = [];
  }

  dispose(): void {
    this.reset();
    this.detector.dispose();
    this.matcher.dispose();
    this.initializer.dispose();
    this.poseEstimator.dispose();
    this.map.dispose();
  }
}
