import { Keypoint } from '../cv/FeatureDetector';

export interface MapPoint {
  id: number;
  position: { x: number; y: number; z: number };
  descriptor: Uint8Array | null;
  observations: number; // number of keyframes that see this point
  lastSeen: number;     // frame index
}

export interface KeyFrame {
  id: number;
  rotation: Float64Array;
  translation: Float64Array;
  keypoints: Keypoint[];
  descriptors: any;       // cv.Mat (cloned)
  mapPointIds: number[];  // mapPoint id for each keypoint (-1 if no association)
  timestamp: number;
}

/**
 * Manages the 3D map: keyframes and map points.
 */
export class MapManager {
  private mapPoints: Map<number, MapPoint> = new Map();
  private keyframes: KeyFrame[] = [];
  private nextPointId = 0;
  private nextKeyframeId = 0;
  private frameIndex = 0;

  addMapPoint(
    position: { x: number; y: number; z: number },
    descriptor?: Uint8Array,
  ): number {
    const id = this.nextPointId++;
    this.mapPoints.set(id, {
      id,
      position: { ...position },
      descriptor: descriptor ?? null,
      observations: 1,
      lastSeen: this.frameIndex,
    });
    return id;
  }

  addKeyFrame(
    rotation: Float64Array,
    translation: Float64Array,
    keypoints: Keypoint[],
    descriptors: any,
    mapPointIds: number[],
  ): KeyFrame {
    const kf: KeyFrame = {
      id: this.nextKeyframeId++,
      rotation: new Float64Array(rotation),
      translation: new Float64Array(translation),
      keypoints: [...keypoints],
      descriptors: descriptors.clone(),
      mapPointIds: [...mapPointIds],
      timestamp: performance.now(),
    };
    this.keyframes.push(kf);
    return kf;
  }

  getMapPoint(id: number): MapPoint | undefined {
    return this.mapPoints.get(id);
  }

  getAllMapPoints(): MapPoint[] {
    return Array.from(this.mapPoints.values());
  }

  getVisibleMapPoints(): MapPoint[] {
    // Return points seen recently (within last 30 frames)
    const threshold = this.frameIndex - 30;
    return this.getAllMapPoints().filter(p => p.lastSeen >= threshold);
  }

  getLastKeyFrame(): KeyFrame | null {
    return this.keyframes.length > 0
      ? this.keyframes[this.keyframes.length - 1]
      : null;
  }

  getKeyFrameCount(): number {
    return this.keyframes.length;
  }

  getMapPointCount(): number {
    return this.mapPoints.size;
  }

  updateMapPointPosition(id: number, position: { x: number; y: number; z: number }): void {
    const mp = this.mapPoints.get(id);
    if (mp) {
      mp.position = { ...position };
    }
  }

  markPointSeen(id: number): void {
    const mp = this.mapPoints.get(id);
    if (mp) {
      mp.observations++;
      mp.lastSeen = this.frameIndex;
    }
  }

  incrementFrame(): void {
    this.frameIndex++;
  }

  getCurrentFrame(): number {
    return this.frameIndex;
  }

  /**
   * Determine if we need a new keyframe based on tracking quality.
   */
  needsNewKeyframe(inlierCount: number, totalMapPoints: number): boolean {
    if (this.keyframes.length === 0) return true;

    // New keyframe if tracking less than 60% of map points
    const ratio = inlierCount / Math.max(totalMapPoints, 1);
    if (ratio < 0.6) return true;

    // Or if more than 20 frames since last keyframe
    const lastKf = this.getLastKeyFrame();
    if (lastKf && this.frameIndex - lastKf.id > 20) return true;

    return false;
  }

  /**
   * Remove map points with very few observations (cleanup).
   */
  pruneMapPoints(): void {
    const minObservations = 2;
    const staleThreshold = this.frameIndex - 60;

    for (const [id, mp] of this.mapPoints) {
      if (mp.observations < minObservations && mp.lastSeen < staleThreshold) {
        this.mapPoints.delete(id);
      }
    }
  }

  reset(): void {
    // Clean up OpenCV mats in keyframes
    for (const kf of this.keyframes) {
      if (kf.descriptors && typeof kf.descriptors.delete === 'function') {
        kf.descriptors.delete();
      }
    }
    this.mapPoints.clear();
    this.keyframes = [];
    this.nextPointId = 0;
    this.nextKeyframeId = 0;
    this.frameIndex = 0;
  }

  dispose(): void {
    this.reset();
  }
}
