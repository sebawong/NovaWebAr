import { getOpenCV } from './WasmLoader';

export interface Keypoint {
  x: number;
  y: number;
  size: number;
  angle: number;
  response: number;
  octave: number;
}

export interface DetectionResult {
  keypoints: Keypoint[];
  descriptors: any; // cv.Mat — kept as OpenCV mat for matching
}

export class FeatureDetector {
  private orb: any;
  private maxFeatures: number;

  constructor(maxFeatures = 500) {
    this.maxFeatures = maxFeatures;
    const cv = getOpenCV();
    this.orb = new cv.ORB(this.maxFeatures);
  }

  detect(grayMat: any): DetectionResult {
    const cv = getOpenCV();

    const keypoints = new cv.KeyPointVector();
    const descriptors = new cv.Mat();

    this.orb.detectAndCompute(grayMat, new cv.Mat(), keypoints, descriptors);

    const kpArray: Keypoint[] = [];
    for (let i = 0; i < keypoints.size(); i++) {
      const kp = keypoints.get(i);
      kpArray.push({
        x: kp.pt.x,
        y: kp.pt.y,
        size: kp.size,
        angle: kp.angle,
        response: kp.response,
        octave: kp.octave,
      });
    }

    keypoints.delete();
    return { keypoints: kpArray, descriptors };
  }

  imageToGray(imageData: ImageData): any {
    const cv = getOpenCV();
    const mat = cv.matFromImageData(imageData);
    const gray = new cv.Mat();
    cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
    mat.delete();
    return gray;
  }

  dispose(): void {
    if (this.orb) {
      this.orb.delete();
      this.orb = null;
    }
  }
}
