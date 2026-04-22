import { CameraConfig } from '../core/Config';

export class CameraManager {
  private config: CameraConfig;
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;

  constructor(config: CameraConfig) {
    this.config = config;
  }

  async start(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        '[WebSLAM] Camera access requires HTTPS. ' +
        'Please access this page via https:// or localhost.',
      );
    }

    const constraints: MediaStreamConstraints = {
      video: {
        facingMode: this.config.facingMode,
        width: { ideal: this.config.width },
        height: { ideal: this.config.height },
      },
      audio: false,
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    return this.stream;
  }

  stop(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }

  getVideoSize(): { width: number; height: number } {
    if (!this.stream) {
      return { width: this.config.width, height: this.config.height };
    }
    const track = this.stream.getVideoTracks()[0];
    const settings = track.getSettings();
    return {
      width: settings.width ?? this.config.width,
      height: settings.height ?? this.config.height,
    };
  }

  getStream(): MediaStream | null {
    return this.stream;
  }
}
