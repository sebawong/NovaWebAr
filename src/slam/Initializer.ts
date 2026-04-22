import { getOpenCV } from '../cv/WasmLoader';
import { Keypoint } from '../cv/FeatureDetector';
import { Match } from '../cv/FeatureMatcher';
import { CameraIntrinsics, intrinsicsToMatrix } from '../math/Projection';

export interface InitializationResult {
  rotation: Float64Array;    // 3x3 rotation matrix (row-major)
  translation: Float64Array; // 3-element translation vector
  points3D: { x: number; y: number; z: number }[];
  inlierIndices: number[];
  queryKeypoints: Keypoint[];
  trainKeypoints: Keypoint[];
}

/**
 * SLAM Map Initializer
 *
 * Uses two-view geometry to bootstrap the 3D map:
 * 1. Compute fundamental matrix from feature matches (RANSAC)
 * 2. Recover essential matrix from fundamental + intrinsics
 * 3. Decompose essential matrix into R, t
 * 4. Triangulate initial map points
 */
export class Initializer {
  private referenceFrame: { keypoints: Keypoint[]; descriptors: any } | null = null;
  private minMatches = 30;
  private minParallax = 1.0; // minimum average pixel displacement

  setReferenceFrame(keypoints: Keypoint[], descriptors: any): void {
    this.referenceFrame = { keypoints, descriptors: descriptors.clone() };
  }

  hasReference(): boolean {
    return this.referenceFrame !== null;
  }

  tryInitialize(
    currentKeypoints: Keypoint[],
    matches: Match[],
    intrinsics: CameraIntrinsics,
  ): InitializationResult | null {
    if (!this.referenceFrame) return null;
    if (matches.length < this.minMatches) return null;

    // Check parallax (average displacement between matched points)
    const avgDisplacement = this.computeAverageDisplacement(
      this.referenceFrame.keypoints,
      currentKeypoints,
      matches,
    );
    if (avgDisplacement < this.minParallax) return null;

    const cv = getOpenCV();
    const K = intrinsicsToMatrix(intrinsics);

    // Build point correspondences
    const pts1: number[] = [];
    const pts2: number[] = [];
    for (const m of matches) {
      const kp1 = this.referenceFrame.keypoints[m.queryIdx];
      const kp2 = currentKeypoints[m.trainIdx];
      pts1.push(kp1.x, kp1.y);
      pts2.push(kp2.x, kp2.y);
    }

    const points1 = cv.matFromArray(matches.length, 1, cv.CV_64FC2, pts1);
    const points2 = cv.matFromArray(matches.length, 1, cv.CV_64FC2, pts2);
    const cameraMat = cv.matFromArray(3, 3, cv.CV_64F, Array.from(K));

    // Find Essential Matrix with RANSAC
    const mask = new cv.Mat();
    const E = cv.findEssentialMat(
      points1, points2, cameraMat,
      cv.RANSAC, 0.999, 1.0, mask,
    );

    if (E.empty()) {
      points1.delete(); points2.delete(); cameraMat.delete(); mask.delete(); E.delete();
      return null;
    }

    // Recover pose (R, t) from Essential matrix
    const R = new cv.Mat();
    const t = new cv.Mat();
    const inlierCount = cv.recoverPose(E, points1, points2, cameraMat, R, t, mask);

    if (inlierCount < this.minMatches * 0.5) {
      points1.delete(); points2.delete(); cameraMat.delete();
      mask.delete(); E.delete(); R.delete(); t.delete();
      return null;
    }

    // Extract rotation and translation
    const rotation = new Float64Array(9);
    for (let i = 0; i < 9; i++) rotation[i] = R.doubleAt(Math.floor(i / 3), i % 3);

    const translation = new Float64Array(3);
    for (let i = 0; i < 3; i++) translation[i] = t.doubleAt(i, 0);

    // Triangulate initial 3D points
    const points3D = this.triangulatePoints(
      cv, points1, points2, cameraMat, R, t, mask,
    );

    // Collect inlier indices
    const inlierIndices: number[] = [];
    for (let i = 0; i < mask.rows; i++) {
      if (mask.ucharAt(i, 0) > 0) inlierIndices.push(i);
    }

    // Cleanup
    points1.delete(); points2.delete(); cameraMat.delete();
    mask.delete(); E.delete(); R.delete(); t.delete();

    if (points3D.length < 10) return null;

    return {
      rotation,
      translation,
      points3D,
      inlierIndices,
      queryKeypoints: this.referenceFrame.keypoints,
      trainKeypoints: currentKeypoints,
    };
  }

  private triangulatePoints(
    cv: any,
    points1: any,
    points2: any,
    K: any,
    R: any,
    t: any,
    mask: any,
  ): { x: number; y: number; z: number }[] {
    // Projection matrix for camera 1: K * [I | 0]
    const P1 = cv.matFromArray(3, 4, cv.CV_64F, [
      K.doubleAt(0, 0), K.doubleAt(0, 1), K.doubleAt(0, 2), 0,
      K.doubleAt(1, 0), K.doubleAt(1, 1), K.doubleAt(1, 2), 0,
      K.doubleAt(2, 0), K.doubleAt(2, 1), K.doubleAt(2, 2), 0,
    ]);

    // Projection matrix for camera 2: K * [R | t]
    const Rt = new Array(12);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        Rt[row * 4 + col] = R.doubleAt(row, col);
      }
      Rt[row * 4 + 3] = t.doubleAt(row, 0);
    }

    const KRt = new Array(12);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        let sum = 0;
        for (let k = 0; k < 3; k++) {
          sum += K.doubleAt(row, k) * Rt[k * 4 + col];
        }
        KRt[row * 4 + col] = sum;
      }
    }

    const P2 = cv.matFromArray(3, 4, cv.CV_64F, KRt);

    // Filter inlier points
    const inlierPts1: number[] = [];
    const inlierPts2: number[] = [];
    let inlierCount = 0;

    for (let i = 0; i < mask.rows; i++) {
      if (mask.ucharAt(i, 0) > 0) {
        inlierPts1.push(points1.doubleAt(i, 0), points1.doubleAt(i, 1));
        inlierPts2.push(points2.doubleAt(i, 0), points2.doubleAt(i, 1));
        inlierCount++;
      }
    }

    if (inlierCount < 5) {
      P1.delete(); P2.delete();
      return [];
    }

    const srcPts1 = cv.matFromArray(inlierCount, 1, cv.CV_64FC2, inlierPts1);
    const srcPts2 = cv.matFromArray(inlierCount, 1, cv.CV_64FC2, inlierPts2);
    const points4D = new cv.Mat();

    cv.triangulatePoints(P1, P2, srcPts1, srcPts2, points4D);

    const result: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < points4D.cols; i++) {
      const w = points4D.doubleAt(3, i);
      if (Math.abs(w) < 1e-10) continue;

      const x = points4D.doubleAt(0, i) / w;
      const y = points4D.doubleAt(1, i) / w;
      const z = points4D.doubleAt(2, i) / w;

      // Filter points behind camera or too far
      if (z > 0 && z < 100) {
        result.push({ x, y, z });
      }
    }

    P1.delete(); P2.delete(); srcPts1.delete(); srcPts2.delete(); points4D.delete();
    return result;
  }

  private computeAverageDisplacement(
    kp1: Keypoint[], kp2: Keypoint[], matches: Match[],
  ): number {
    let totalDisp = 0;
    for (const m of matches) {
      const dx = kp1[m.queryIdx].x - kp2[m.trainIdx].x;
      const dy = kp1[m.queryIdx].y - kp2[m.trainIdx].y;
      totalDisp += Math.sqrt(dx * dx + dy * dy);
    }
    return totalDisp / matches.length;
  }

  reset(): void {
    if (this.referenceFrame?.descriptors) {
      this.referenceFrame.descriptors.delete();
    }
    this.referenceFrame = null;
  }

  dispose(): void {
    this.reset();
  }
}
