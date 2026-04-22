import * as THREE from 'three';
import { EventEmitter } from './EventEmitter';
import {
  SessionConfig,
  SessionEventMap,
  CameraConfig,
  DEFAULT_CAMERA_CONFIG,
  Feature,
  HitTestResult,
  Pose,
} from './Config';
import { CameraManager } from '../camera/CameraManager';
import { CameraFeed } from '../camera/CameraFeed';
import { ARRenderer } from '../rendering/ARRenderer';
import { CameraBackground } from '../rendering/CameraBackground';
import { DebugOverlay } from '../rendering/DebugOverlay';
import { CVPipeline, CVFrameResult } from '../cv/CVPipeline';
import { estimateIntrinsics, intrinsicsToFovY, CameraIntrinsics } from '../math/Projection';

export class Session extends EventEmitter<SessionEventMap> {
  readonly scene: THREE.Scene;
  readonly threeCamera: THREE.PerspectiveCamera;

  private container: HTMLElement;
  private cameraConfig: CameraConfig;
  private features: Set<Feature>;
  private debug: boolean;

  private cameraManager: CameraManager;
  private cameraFeed: CameraFeed;
  private arRenderer: ARRenderer;
  private cameraBackground: CameraBackground;
  private debugOverlay: DebugOverlay | null = null;
  private cvPipeline: CVPipeline | null = null;
  private intrinsics: CameraIntrinsics | null = null;

  private running = false;
  private animFrameId = 0;
  private currentPose: Pose | null = null;
  private frameSkip = 0;
  private cvProcessingInterval = 2; // Process every Nth frame for performance

  constructor(config: SessionConfig) {
    super();
    this.container = config.container;
    this.cameraConfig = { ...DEFAULT_CAMERA_CONFIG, ...config.camera };
    this.features = new Set(config.features ?? ['slam', 'planes', 'markers']);
    this.debug = config.debug ?? false;

    this.scene = new THREE.Scene();
    this.threeCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000);
    this.scene.add(this.threeCamera);

    this.cameraManager = new CameraManager(this.cameraConfig);
    this.cameraFeed = new CameraFeed();
    this.arRenderer = new ARRenderer(this.container, this.scene, this.threeCamera);
    this.cameraBackground = new CameraBackground(this.scene, this.arRenderer.renderer);
  }

  async start(): Promise<void> {
    try {
      // Start camera
      const stream = await this.cameraManager.start();
      this.cameraFeed.setStream(stream);

      const videoSize = this.cameraManager.getVideoSize();
      this.arRenderer.setSize(videoSize.width, videoSize.height);
      this.cameraBackground.setVideoElement(this.cameraFeed.videoElement);

      // Estimate camera intrinsics and set FoV
      this.intrinsics = estimateIntrinsics(videoSize.width, videoSize.height);
      this.threeCamera.fov = intrinsicsToFovY(this.intrinsics);
      this.threeCamera.updateProjectionMatrix();

      // Initialize CV pipeline
      this.cvPipeline = new CVPipeline();
      this.cvPipeline.setOnFrame(this.onCVResult);

      try {
        await this.cvPipeline.init('/opencv.js');
      } catch (err) {
        console.warn('[WebSLAM] CV pipeline failed to init, running without CV:', err);
        this.cvPipeline = null;
      }

      // Debug overlay
      if (this.debug) {
        this.debugOverlay = new DebugOverlay(this.container);
      }

      this.running = true;
      this.loop();

      this.emit('ready', undefined as never);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  private loop = (): void => {
    if (!this.running) return;
    this.animFrameId = requestAnimationFrame(this.loop);

    // Send frames to CV pipeline (throttled)
    this.frameSkip++;
    if (this.cvPipeline?.isReady && this.frameSkip >= this.cvProcessingInterval) {
      this.frameSkip = 0;
      const frame = this.cameraFeed.captureFrame();
      if (frame) {
        this.cvPipeline.processFrame(frame, performance.now());
      }
    }

    this.cameraBackground.update();
    this.arRenderer.render();
  };

  private onCVResult = (result: CVFrameResult): void => {
    if (this.debugOverlay && this.intrinsics) {
      this.debugOverlay.setMatchCount(result.matchCount);
      this.debugOverlay.drawKeypoints(
        result.keypoints,
        this.intrinsics.width,
        this.intrinsics.height,
      );
    }
  };

  async hitTest(_screenX: number, _screenY: number): Promise<HitTestResult | null> {
    // Phase 4: implement ray-plane intersection
    return null;
  }

  async addMarker(_name: string, _imageUrl: string): Promise<void> {
    // Phase 5: add marker to database
  }

  pause(): void {
    this.running = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = 0;
    }
  }

  resume(): void {
    if (!this.running) {
      this.running = true;
      this.loop();
    }
  }

  destroy(): void {
    this.pause();
    this.cameraManager.stop();
    this.cameraFeed.dispose();
    this.cameraBackground.dispose();
    this.arRenderer.dispose();
    this.debugOverlay?.dispose();
    this.cvPipeline?.dispose();
    this.removeAllListeners();
  }

  get camera(): THREE.PerspectiveCamera {
    return this.threeCamera;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isDebug(): boolean {
    return this.debug;
  }

  get enabledFeatures(): Feature[] {
    return [...this.features];
  }

  get pose(): Pose | null {
    return this.currentPose;
  }

  get cameraIntrinsics(): CameraIntrinsics | null {
    return this.intrinsics;
  }
}
