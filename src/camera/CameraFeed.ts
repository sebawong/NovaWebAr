export class CameraFeed {
  readonly videoElement: HTMLVideoElement;
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;

  constructor() {
    this.videoElement = document.createElement('video');
    this.videoElement.setAttribute('playsinline', '');
    this.videoElement.setAttribute('autoplay', '');
    this.videoElement.muted = true;
    this.videoElement.style.display = 'none';
  }

  setStream(stream: MediaStream): void {
    this.videoElement.srcObject = stream;
    this.videoElement.play();
  }

  captureFrame(): ImageData | null {
    const video = this.videoElement;
    if (video.readyState < video.HAVE_CURRENT_DATA) return null;

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) return null;

    if (!this.canvas || this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas = new OffscreenCanvas(w, h);
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    }

    this.ctx!.drawImage(video, 0, 0, w, h);
    return this.ctx!.getImageData(0, 0, w, h);
  }

  dispose(): void {
    this.videoElement.pause();
    this.videoElement.srcObject = null;
    this.canvas = null;
    this.ctx = null;
  }
}
