import { Keypoint } from '../cv/FeatureDetector';

export class DebugOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private visible = true;

  // Stats
  private fps = 0;
  private featureCount = 0;
  private matchCount = 0;
  private lastFrameTime = 0;
  private frameCount = 0;
  private fpsAccum = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '5';
    container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d')!;

    this.handleResize();
    window.addEventListener('resize', this.handleResize);
  }

  private handleResize = (): void => {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    this.canvas.width = parent.clientWidth;
    this.canvas.height = parent.clientHeight;
  };

  drawKeypoints(
    keypoints: Keypoint[],
    videoWidth: number,
    videoHeight: number,
  ): void {
    if (!this.visible) return;

    const now = performance.now();
    this.frameCount++;
    this.fpsAccum += now - this.lastFrameTime;
    if (this.fpsAccum >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / this.fpsAccum);
      this.frameCount = 0;
      this.fpsAccum = 0;
    }
    this.lastFrameTime = now;

    this.featureCount = keypoints.length;

    const w = this.canvas.width;
    const h = this.canvas.height;
    const scaleX = w / videoWidth;
    const scaleY = h / videoHeight;

    this.ctx.clearRect(0, 0, w, h);

    // Draw keypoints
    this.ctx.fillStyle = '#00ff88';
    this.ctx.strokeStyle = '#00ff88';
    this.ctx.lineWidth = 1;

    for (const kp of keypoints) {
      const x = kp.x * scaleX;
      const y = kp.y * scaleY;
      const r = Math.max(2, kp.size * 0.3 * scaleX);

      this.ctx.beginPath();
      this.ctx.arc(x, y, r, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // Draw stats
    this.drawStats();
  }

  private slamState = 'initializing';
  private mapPointCount = 0;
  private keyframeCount = 0;
  private inlierCount = 0;

  setMatchCount(count: number): void {
    this.matchCount = count;
  }

  setSLAMState(state: string, mapPoints: number, keyframes: number, inliers: number): void {
    this.slamState = state;
    this.mapPointCount = mapPoints;
    this.keyframeCount = keyframes;
    this.inlierCount = inliers;
  }

  private drawStats(): void {
    const stateColors: Record<string, string> = {
      uninitialized: '#888',
      initializing: '#ff0',
      tracking: '#0f0',
      lost: '#f44',
    };

    const lines = [
      `SLAM: ${this.slamState.toUpperCase()}`,
      `FPS: ${this.fps}`,
      `Features: ${this.featureCount}`,
      `Matches: ${this.matchCount}`,
      `Inliers: ${this.inlierCount}`,
      `Map pts: ${this.mapPointCount}`,
      `Keyframes: ${this.keyframeCount}`,
    ];

    this.ctx.font = '13px "SF Mono", Consolas, monospace';
    this.ctx.textBaseline = 'top';

    const x = 12;
    let y = 40;
    const lineHeight = 18;
    const padding = 6;

    // Background
    const maxWidth = Math.max(...lines.map((l) => this.ctx.measureText(l).width));
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    this.ctx.fillRect(
      x - padding,
      y - padding,
      maxWidth + padding * 2,
      lines.length * lineHeight + padding * 2,
    );

    // Text
    this.ctx.fillStyle = '#00ff88';
    for (const line of lines) {
      this.ctx.fillText(line, x, y);
      y += lineHeight;
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.canvas.style.display = visible ? 'block' : 'none';
  }

  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.canvas.remove();
  }
}
