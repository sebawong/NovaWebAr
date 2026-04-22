// Web Worker for heavy CV processing — runs off main thread
import { loadOpenCV } from './WasmLoader';
import { SLAMEngine, SLAMFrameResult } from '../slam/SLAMEngine';
import { CameraIntrinsics } from '../math/Projection';

let slam: SLAMEngine | null = null;
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
        await handleInit(payload?.wasmPath, payload?.intrinsics);
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

async function handleInit(wasmPath?: string, intrinsics?: CameraIntrinsics) {
  await loadOpenCV(wasmPath);

  if (!intrinsics) {
    throw new Error('Camera intrinsics required for SLAM init');
  }

  slam = new SLAMEngine(intrinsics);
  initialized = true;
  respond({ type: 'ready' });
}

function handleProcessFrame(payload: {
  imageData: { data: Uint8ClampedArray; width: number; height: number };
  timestamp: number;
}) {
  if (!initialized || !slam) return;

  const { imageData, timestamp } = payload;

  // Reconstruct ImageData in worker
  const imgData = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  );

  // Run full SLAM pipeline
  const result: SLAMFrameResult = slam.processFrame(imgData);

  // Serialize rotation/translation as arrays for transfer
  respond({
    type: 'frameResult',
    payload: {
      timestamp,
      state: result.state,
      rotation: result.rotation ? Array.from(result.rotation) : null,
      translation: result.translation ? Array.from(result.translation) : null,
      keypoints: result.keypoints,
      mapPointCount: result.mapPointCount,
      keyframeCount: result.keyframeCount,
      inlierCount: result.inlierCount,
      matchCount: result.matchCount,
    },
  });
}

function handleDispose() {
  slam?.dispose();
  slam = null;
  initialized = false;
}

function respond(msg: CVWorkerResponse) {
  (self as any).postMessage(msg);
}
