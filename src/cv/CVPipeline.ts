import type { CVWorkerResponse } from './cv.worker';
import { Keypoint } from './FeatureDetector';
import { Match } from './FeatureMatcher';

export interface CVFrameResult {
  timestamp: number;
  keypoints: Keypoint[];
  matchCount: number;
  matches: Match[];
}

type FrameCallback = (result: CVFrameResult) => void;

export class CVPipeline {
  private worker: Worker | null = null;
  private ready = false;
  private onFrame: FrameCallback | null = null;
  private processing = false;
  private pendingFrame: { imageData: ImageData; timestamp: number } | null = null;

  async init(wasmPath?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.worker = new Worker(
        new URL('./cv.worker.ts', import.meta.url),
        { type: 'module' },
      );

      const onReady = (e: MessageEvent<CVWorkerResponse>) => {
        if (e.data.type === 'ready') {
          this.ready = true;
          this.worker!.removeEventListener('message', onReady);
          this.worker!.addEventListener('message', this.handleMessage);
          resolve();
        } else if (e.data.type === 'error') {
          reject(new Error(e.data.payload?.message ?? 'CV worker init failed'));
        }
      };

      this.worker.addEventListener('message', onReady);
      this.worker.postMessage({ type: 'init', payload: { wasmPath } });
    });
  }

  private handleMessage = (e: MessageEvent<CVWorkerResponse>) => {
    const { type, payload } = e.data;

    if (type === 'frameResult' && this.onFrame) {
      this.processing = false;
      this.onFrame(payload as CVFrameResult);

      // Process pending frame if any (drop-frame strategy)
      if (this.pendingFrame) {
        const frame = this.pendingFrame;
        this.pendingFrame = null;
        this.processFrame(frame.imageData, frame.timestamp);
      }
    }

    if (type === 'error') {
      console.error('[WebSLAM] CV Worker error:', payload?.message);
      this.processing = false;
    }
  };

  processFrame(imageData: ImageData, timestamp: number): void {
    if (!this.ready || !this.worker) return;

    // Drop frame strategy: if worker is busy, store latest frame
    if (this.processing) {
      this.pendingFrame = { imageData, timestamp };
      return;
    }

    this.processing = true;

    // Transfer pixel data to worker
    const data = imageData.data;
    this.worker.postMessage(
      {
        type: 'processFrame',
        payload: {
          imageData: {
            data: data.buffer,
            width: imageData.width,
            height: imageData.height,
          },
          timestamp,
        },
      },
      [data.buffer],
    );
  }

  setOnFrame(callback: FrameCallback): void {
    this.onFrame = callback;
  }

  get isReady(): boolean {
    return this.ready;
  }

  dispose(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' });
      this.worker.terminate();
      this.worker = null;
    }
    this.ready = false;
    this.onFrame = null;
    this.pendingFrame = null;
  }
}
