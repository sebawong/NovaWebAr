import { getOpenCV } from '../cv/WasmLoader';
import { CameraIntrinsics, intrinsicsToMatrix } from '../math/Projection';

export interface PoseEstimation {
  rotation: Float64Array;    // 3x3 row-major
  translation: Float64Array; // 3-element
  inlierCount: number;
  reprojectionError: number;
}

/**
 * Estimates camera pose from 2D-3D correspondences using solvePnP (EPnP + RANSAC).
 */
export class PoseEstimator {
  private distCoeffs: any = null;

  estimatePose(
    points2D: { x: number; y: number }[],
    points3D: { x: number; y: number; z: number }[],
    intrinsics: CameraIntrinsics,
  ): PoseEstimation | null {
    if (points2D.length < 6 || points2D.length !== points3D.length) return null;

    const cv = getOpenCV();
    const K = intrinsicsToMatrix(intrinsics);

    // Build OpenCV mats
    const objPoints = cv.matFromArray(points3D.length, 1, cv.CV_64FC3,
      points3D.flatMap(p => [p.x, p.y, p.z]),
    );
    const imgPoints = cv.matFromArray(points2D.length, 1, cv.CV_64FC2,
      points2D.flatMap(p => [p.x, p.y]),
    );
    const cameraMat = cv.matFromArray(3, 3, cv.CV_64F, Array.from(K));

    if (!this.distCoeffs) {
      this.distCoeffs = cv.matFromArray(4, 1, cv.CV_64F, [0, 0, 0, 0]);
    }

    const rvec = new cv.Mat();
    const tvec = new cv.Mat();
    const inliers = new cv.Mat();

    let success: boolean;
    try {
      success = cv.solvePnPRansac(
        objPoints, imgPoints, cameraMat, this.distCoeffs,
        rvec, tvec, false, 100, 8.0, 0.99, inliers,
      );
    } catch {
      objPoints.delete(); imgPoints.delete(); cameraMat.delete();
      rvec.delete(); tvec.delete(); inliers.delete();
      return null;
    }

    if (!success || inliers.rows < 6) {
      objPoints.delete(); imgPoints.delete(); cameraMat.delete();
      rvec.delete(); tvec.delete(); inliers.delete();
      return null;
    }

    // Convert rotation vector to matrix
    const rotMat = new cv.Mat();
    cv.Rodrigues(rvec, rotMat);

    const rotation = new Float64Array(9);
    for (let i = 0; i < 9; i++) {
      rotation[i] = rotMat.doubleAt(Math.floor(i / 3), i % 3);
    }

    const translation = new Float64Array(3);
    for (let i = 0; i < 3; i++) {
      translation[i] = tvec.doubleAt(i, 0);
    }

    // Compute reprojection error
    const reprojError = this.computeReprojectionError(
      cv, objPoints, imgPoints, rvec, tvec, cameraMat, inliers,
    );

    const inlierCount = inliers.rows;

    // Cleanup
    objPoints.delete(); imgPoints.delete(); cameraMat.delete();
    rvec.delete(); tvec.delete(); rotMat.delete(); inliers.delete();

    return { rotation, translation, inlierCount, reprojectionError: reprojError };
  }

  private computeReprojectionError(
    cv: any,
    objPoints: any,
    imgPoints: any,
    rvec: any,
    tvec: any,
    cameraMat: any,
    inliers: any,
  ): number {
    const projected = new cv.Mat();
    cv.projectPoints(objPoints, rvec, tvec, cameraMat, this.distCoeffs, projected);

    let totalError = 0;
    let count = 0;

    for (let i = 0; i < inliers.rows; i++) {
      const idx = inliers.intAt(i, 0);
      const px = projected.doubleAt(idx, 0);
      const py = projected.doubleAt(idx, 1);
      const ox = imgPoints.doubleAt(idx, 0);
      const oy = imgPoints.doubleAt(idx, 1);
      const dx = px - ox;
      const dy = py - oy;
      totalError += Math.sqrt(dx * dx + dy * dy);
      count++;
    }

    projected.delete();
    return count > 0 ? totalError / count : Infinity;
  }

  dispose(): void {
    if (this.distCoeffs) {
      this.distCoeffs.delete();
      this.distCoeffs = null;
    }
  }
}
