/**
 * Constant-velocity motion model for pose prediction.
 * Predicts the next camera pose based on the last two poses.
 * This reduces the search space for feature matching.
 */
export class MotionModel {
  private prevRotation: Float64Array | null = null;
  private prevTranslation: Float64Array | null = null;
  private currRotation: Float64Array | null = null;
  private currTranslation: Float64Array | null = null;
  private hasMotion = false;

  update(rotation: Float64Array, translation: Float64Array): void {
    this.prevRotation = this.currRotation;
    this.prevTranslation = this.currTranslation;
    this.currRotation = new Float64Array(rotation);
    this.currTranslation = new Float64Array(translation);
    this.hasMotion = this.prevRotation !== null;
  }

  predict(): { rotation: Float64Array; translation: Float64Array } | null {
    if (!this.hasMotion || !this.prevRotation || !this.prevTranslation ||
        !this.currRotation || !this.currTranslation) {
      return this.currRotation && this.currTranslation
        ? { rotation: new Float64Array(this.currRotation), translation: new Float64Array(this.currTranslation) }
        : null;
    }

    // Constant velocity: predicted = current + (current - previous)
    const predR = new Float64Array(9);
    const predT = new Float64Array(3);

    // Simple linear extrapolation for translation
    for (let i = 0; i < 3; i++) {
      predT[i] = 2 * this.currTranslation[i] - this.prevTranslation[i];
    }

    // For rotation, use the incremental rotation: R_pred = R_delta * R_curr
    // R_delta = R_curr * R_prev^T
    // R_pred = R_delta * R_curr = R_curr * R_prev^T * R_curr
    // Simplified: just use current rotation as prediction (rotation changes slowly)
    for (let i = 0; i < 9; i++) {
      predR[i] = this.currRotation[i];
    }

    return { rotation: predR, translation: predT };
  }

  reset(): void {
    this.prevRotation = null;
    this.prevTranslation = null;
    this.currRotation = null;
    this.currTranslation = null;
    this.hasMotion = false;
  }
}
