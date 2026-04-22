import * as THREE from 'three';

// --- Camera Configuration ---

export interface CameraConfig {
  facingMode: 'environment' | 'user';
  width: number;
  height: number;
}

export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  facingMode: 'environment',
  width: 1280,
  height: 720,
};

// --- Feature Flags ---

export type Feature = 'slam' | 'planes' | 'markers';

// --- Session Configuration ---

export interface SessionConfig {
  container: HTMLElement;
  camera?: Partial<CameraConfig>;
  features?: Feature[];
  debug?: boolean;
}

// --- Event Types ---

export interface Pose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  projectionMatrix: THREE.Matrix4;
  viewMatrix: THREE.Matrix4;
}

export interface Plane {
  id: string;
  position: THREE.Vector3;
  normal: THREE.Vector3;
  extents: { width: number; height: number };
  orientation: 'horizontal' | 'vertical';
}

export interface Marker {
  id: string;
  name: string;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  corners: THREE.Vector2[];
}

export interface HitTestResult {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  plane?: Plane;
}

export interface SessionEventMap {
  ready: void;
  error: Error;
  poseUpdate: Pose;
  planeDetected: Plane;
  planeUpdated: Plane;
  planeLost: Plane;
  markerFound: Marker;
  markerUpdated: Marker;
  markerLost: Marker;
  trackingLost: void;
  trackingRestored: void;
}

// --- Internal Pipeline Types ---

export interface FrameData {
  imageData: ImageData;
  timestamp: number;
  width: number;
  height: number;
}

export interface TrackingResult {
  pose: Pose | null;
  features: { x: number; y: number }[];
  mapPoints: THREE.Vector3[];
  planes: Plane[];
  markers: Marker[];
  trackingState: 'initializing' | 'tracking' | 'lost';
}
