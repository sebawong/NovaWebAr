import { getOpenCV } from './WasmLoader';
import { Keypoint } from './FeatureDetector';

export interface Match {
  queryIdx: number;
  trainIdx: number;
  distance: number;
}

export interface MatchResult {
  matches: Match[];
  queryKeypoints: Keypoint[];
  trainKeypoints: Keypoint[];
}

export class FeatureMatcher {
  private matcher: any;
  private ratioThreshold: number;

  constructor(ratioThreshold = 0.75) {
    this.ratioThreshold = ratioThreshold;
    const cv = getOpenCV();
    this.matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
  }

  match(
    desc1: any,
    desc2: any,
    keypoints1: Keypoint[],
    keypoints2: Keypoint[],
  ): MatchResult {
    const cv = getOpenCV();

    if (desc1.rows === 0 || desc2.rows === 0) {
      return { matches: [], queryKeypoints: keypoints1, trainKeypoints: keypoints2 };
    }

    // KNN match with k=2 for Lowe's ratio test
    const knnMatches = new cv.DMatchVectorVector();
    this.matcher.knnMatch(desc1, desc2, knnMatches, 2);

    const goodMatches: Match[] = [];

    for (let i = 0; i < knnMatches.size(); i++) {
      const matchPair = knnMatches.get(i);
      if (matchPair.size() < 2) continue;

      const m = matchPair.get(0);
      const n = matchPair.get(1);

      // Lowe's ratio test
      if (m.distance < this.ratioThreshold * n.distance) {
        goodMatches.push({
          queryIdx: m.queryIdx,
          trainIdx: m.trainIdx,
          distance: m.distance,
        });
      }
    }

    knnMatches.delete();

    return {
      matches: goodMatches,
      queryKeypoints: keypoints1,
      trainKeypoints: keypoints2,
    };
  }

  dispose(): void {
    if (this.matcher) {
      this.matcher.delete();
      this.matcher = null;
    }
  }
}
