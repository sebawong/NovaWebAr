// Camera intrinsics and projection utilities

export interface CameraIntrinsics {
  fx: number;  // focal length x (pixels)
  fy: number;  // focal length y (pixels)
  cx: number;  // principal point x
  cy: number;  // principal point y
  width: number;
  height: number;
}

/**
 * Estimate camera intrinsics from image dimensions.
 * Uses a reasonable default focal length (~60° FoV).
 */
export function estimateIntrinsics(width: number, height: number): CameraIntrinsics {
  // Approximate focal length for ~60° horizontal FoV
  const fx = width * 0.85;
  const fy = fx;
  return {
    fx,
    fy,
    cx: width / 2,
    cy: height / 2,
    width,
    height,
  };
}

/**
 * Convert intrinsics to a 3x3 camera matrix (row-major).
 */
export function intrinsicsToMatrix(k: CameraIntrinsics): Float64Array {
  return new Float64Array([
    k.fx, 0,    k.cx,
    0,    k.fy, k.cy,
    0,    0,    1,
  ]);
}

/**
 * Project a 3D point to 2D pixel coordinates.
 */
export function projectPoint(
  point3d: { x: number; y: number; z: number },
  k: CameraIntrinsics,
): { x: number; y: number } | null {
  if (point3d.z <= 0) return null;
  return {
    x: (point3d.x * k.fx) / point3d.z + k.cx,
    y: (point3d.y * k.fy) / point3d.z + k.cy,
  };
}

/**
 * Unproject a 2D pixel to a 3D ray direction (normalized).
 */
export function unprojectPoint(
  pixel: { x: number; y: number },
  k: CameraIntrinsics,
): { x: number; y: number; z: number } {
  const x = (pixel.x - k.cx) / k.fx;
  const y = (pixel.y - k.cy) / k.fy;
  const len = Math.sqrt(x * x + y * y + 1);
  return { x: x / len, y: y / len, z: 1 / len };
}

/**
 * Convert intrinsics to a Three.js-compatible vertical FoV in degrees.
 */
export function intrinsicsToFovY(k: CameraIntrinsics): number {
  return (2 * Math.atan(k.height / (2 * k.fy)) * 180) / Math.PI;
}
