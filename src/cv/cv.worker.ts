// Web Worker for heavy CV processing — runs off main thread
import { loadOpenCV, getOpenCV, isOpenCVLoaded } from './WasmLoader';
import { FeatureDetector, Keypoint } from './FeatureDetector';
import { FeatureMatcher, MatchResult } from './FeatureMatcher';

let detector: FeatureDetector | null = null;
let matcher: FeatureMatcher | null = null;
let prevDescriptors: any = null;
let prevKeypoints: Keypoint[] = [];
let initialized = false;

export interface CVWorkerMessage {
  type: 'init' | 'processFrame' | 'dispose';
  payload?: any;
}

export interface CVWorkerResponse {
  type: 'ready' | 'frameResult' | 'error';
  payload?: any;
}

self.onmessage = async (e: MessageEvent<CVWorkerMessage>) => {
  const { type, payload } = e.data;

  try {
    switch (type) {
      case 'init':
        await handleInit(payload?.wasmPath);
        break;
      case 'processFrame':
        handleProcessFrame(payload);
        break;
      case 'dispose':
        handleDispose();
        break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    respond({ type: 'error', payload: { message: msg } });
  }
};

async function handleInit(wasmPath?: string) {
  await loadOpenCV(wasmPath);
  detector = new FeatureDetector(500);
  matcher = new FeatureMatcher(0.75);
  initialized = true;
  respond({ type: 'ready' });
}

function handleProcessFrame(payload: {
  imageData: { data: Uint8ClampedArray; width: number; height: number };
  timestamp: number;
}) {
  if (!initialized || !detector || !matcher) return;

  const cv = getOpenCV();
  const { imageData, timestamp } = payload;

  // Reconstruct ImageData in worker
  const imgData = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  );

  // Convert to grayscale
  const gray = detector.imageToGray(imgData);

  // Detect features
  const detection = detector.detect(gray);

  // Match with previous frame
  let matchResult: MatchResult | null = null;
  if (prevDescriptors && prevDescriptors.rows > 0 && detection.descriptors.rows > 0) {
    matchResult = matcher.match(
      prevDescriptors,
      detection.descriptors,
      prevKeypoints,
      detection.keypoints,
    );
  }

  // Store current frame data for next match
  if (prevDescriptors) {
    prevDescriptors.delete();
  }
  prevDescriptors = detection.descriptors.clone();
  prevKeypoints = [...detection.keypoints];

  // Clean up
  gray.delete();
  detection.descriptors.delete();

  respond({
    type: 'frameResult',
    payload: {
      timestamp,
      keypoints: detection.keypoints,
      matchCount: matchResult?.matches.length ?? 0,
      matches: matchResult?.matches.slice(0, 100) ?? [], // limit for transfer size
    },
  });
}

function handleDispose() {
  detector?.dispose();
  matcher?.dispose();
  if (prevDescriptors) {
    prevDescriptors.delete();
    prevDescriptors = null;
  }
  detector = null;
  matcher = null;
  initialized = false;
}

function respond(msg: CVWorkerResponse) {
  (self as any).postMessage(msg);
}
