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
import { mat3ToQuaternion } from '../math/Quaternion';

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
  private trackingState: 'initializing' | 'tracking' | 'lost' = 'initializing';
  private frameSkip = 0;
  private cvProcessingInterval = 2;

  // Anchor: the position where the first 3D object is placed
  private worldAnchor: THREE.Group;

  constructor(config: SessionConfig) {
    super();
    this.container = config.container;
    this.cameraConfig = { ...DEFAULT_CAMERA_CONFIG, ...config.camera };
    this.features = new Set(config.features ?? ['slam', 'planes', 'markers']);
    this.debug = config.debug ?? false;

    this.scene = new THREE.Scene();
    this.threeCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000);
    this.scene.add(this.threeCamera);

    // World anchor group — objects added here stay fixed in world space
    this.worldAnchor = new THREE.Group();
    this.scene.add(this.worldAnchor);

    this.cameraManager = new CameraManager(this.cameraConfig);
    this.cameraFeed = new CameraFeed();
    this.arRenderer = new ARRenderer(this.container, this.scene, this.threeCamera);
    this.cameraBackground = new CameraBackground(this.scene, this.arRenderer.renderer);
  }

  async start(): Promise<void> {
    try {
      const stream = await this.cameraManager.start();
      this.cameraFeed.setStream(stream);

      const videoSize = this.cameraManager.getVideoSize();
      this.arRenderer.setSize(videoSize.width, videoSize.height);
      this.cameraBackground.setVideoElement(this.cameraFeed.videoElement);

      // Estimate camera intrinsics and set FoV
      this.intrinsics = estimateIntrinsics(videoSize.width, videoSize.height);
      this.threeCamera.fov = intrinsicsToFovY(this.intrinsics);
      this.threeCamera.updateProjectionMatrix();

      // Initialize CV pipeline with intrinsics for SLAM
      this.cvPipeline = new CVPipeline();
      this.cvPipeline.setOnFrame(this.onCVResult);

      try {
        await this.cvPipeline.init('/opencv.js', this.intrinsics);
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
    // Update tracking state
    const prevState = this.trackingState;
    if (result.state === 'tracking') {
      this.trackingState = 'tracking';
      if (prevState !== 'tracking') {
        this.emit('trackingRestored', undefined as never);
      }
    } else if (result.state === 'lost') {
      this.trackingState = 'lost';
      if (prevState === 'tracking') {
        this.emit('trackingLost', undefined as never);
      }
    } else {
      this.trackingState = 'initializing';
    }

    // Apply SLAM pose to Three.js camera
    if (result.rotation && result.translation) {
      this.applySLAMPose(result.rotation, result.translation);
    }

    // Update debug overlay
    if (this.debugOverlay && this.intrinsics) {
      this.debugOverlay.setMatchCount(result.matchCount);
      this.debugOverlay.setSLAMState(
        result.state,
        result.mapPointCount,
        result.keyframeCount,
        result.inlierCount,
      );
      this.debugOverlay.drawKeypoints(
        result.keypoints,
        this.intrinsics.width,
        this.intrinsics.height,
      );
    }
  };

  private applySLAMPose(rotation: number[], translation: number[]): void {
    // SLAM gives us [R|t] which transforms world→camera.
    // Three.js camera needs the inverse: camera→world (camera's position in world).
    const R = new Float64Array(rotation);
    const t = new Float64Array(translation);

    // Camera position in world = -R^T * t
    const camX = -(R[0] * t[0] + R[3] * t[1] + R[6] * t[2]);
    const camY = -(R[1] * t[0] + R[4] * t[1] + R[7] * t[2]);
    const camZ = -(R[2] * t[0] + R[5] * t[1] + R[8] * t[2]);

    this.threeCamera.position.set(camX, -camY, -camZ); // flip Y,Z for Three.js coords

    // Camera rotation: quaternion from R^T
    const Rt = new Float64Array([
      R[0], R[3], R[6],
      R[1], R[4], R[7],
      R[2], R[5], R[8],
    ]);
    const q = mat3ToQuaternion(Rt);
    // Flip to Three.js coordinate system (Y-up, Z-towards viewer)
    this.threeCamera.quaternion.set(q.x, -q.y, -q.z, q.w);

    // Build pose object for events
    this.currentPose = {
      position: this.threeCamera.position.clone(),
      quaternion: this.threeCamera.quaternion.clone(),
      projectionMatrix: this.threeCamera.projectionMatrix.clone(),
      viewMatrix: this.threeCamera.matrixWorldInverse.clone(),
    };

    this.emit('poseUpdate', this.currentPose);
  }

  async hitTest(_screenX: number, _screenY: number): Promise<HitTestResult | null> {
    // Phase 4: implement ray-plane intersection
    return null;
  }

  async addMarker(_name: string, _imageUrl: string): Promise<void> {
    // Phase 5: add marker to database
  }

  /** Group where world-anchored objects should be added */
  get anchor(): THREE.Group {
    return this.worldAnchor;
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

  get slamState(): string {
    return this.trackingState;
  }
}
