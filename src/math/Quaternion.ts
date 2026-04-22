// Quaternion utilities for rotation handling

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * Convert a 3x3 rotation matrix (row-major) to quaternion.
 */
export function mat3ToQuaternion(m: Float64Array): Quat {
  const trace = m[0] + m[4] + m[8];
  let x: number, y: number, z: number, w: number;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    w = 0.25 / s;
    x = (m[7] - m[5]) * s;
    y = (m[2] - m[6]) * s;
    z = (m[3] - m[1]) * s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = 2.0 * Math.sqrt(1.0 + m[0] - m[4] - m[8]);
    w = (m[7] - m[5]) / s;
    x = 0.25 * s;
    y = (m[1] + m[3]) / s;
    z = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = 2.0 * Math.sqrt(1.0 + m[4] - m[0] - m[8]);
    w = (m[2] - m[6]) / s;
    x = (m[1] + m[3]) / s;
    y = 0.25 * s;
    z = (m[5] + m[7]) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m[8] - m[0] - m[4]);
    w = (m[3] - m[1]) / s;
    x = (m[2] + m[6]) / s;
    y = (m[5] + m[7]) / s;
    z = 0.25 * s;
  }

  return { x, y, z, w };
}

/**
 * Quaternion multiplication: q1 * q2
 */
export function quatMultiply(q1: Quat, q2: Quat): Quat {
  return {
    x: q1.w * q2.x + q1.x * q2.w + q1.y * q2.z - q1.z * q2.y,
    y: q1.w * q2.y - q1.x * q2.z + q1.y * q2.w + q1.z * q2.x,
    z: q1.w * q2.z + q1.x * q2.y - q1.y * q2.x + q1.z * q2.w,
    w: q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z,
  };
}

/**
 * Spherical linear interpolation between two quaternions.
 */
export function quatSlerp(q1: Quat, q2: Quat, t: number): Quat {
  let dot = q1.x * q2.x + q1.y * q2.y + q1.z * q2.z + q1.w * q2.w;

  let b = { ...q2 };
  if (dot < 0) {
    dot = -dot;
    b = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
  }

  if (dot > 0.9995) {
    // Linear interpolation for very close quaternions
    return quatNormalize({
      x: q1.x + t * (b.x - q1.x),
      y: q1.y + t * (b.y - q1.y),
      z: q1.z + t * (b.z - q1.z),
      w: q1.w + t * (b.w - q1.w),
    });
  }

  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const w1 = Math.sin((1 - t) * theta) / sinTheta;
  const w2 = Math.sin(t * theta) / sinTheta;

  return {
    x: w1 * q1.x + w2 * b.x,
    y: w1 * q1.y + w2 * b.y,
    z: w1 * q1.z + w2 * b.z,
    w: w1 * q1.w + w2 * b.w,
  };
}

export function quatNormalize(q: Quat): Quat {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (len < 1e-10) return { x: 0, y: 0, z: 0, w: 1 };
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

export function quatInverse(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}
