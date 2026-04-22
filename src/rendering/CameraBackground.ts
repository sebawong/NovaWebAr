import * as THREE from 'three';

export class CameraBackground {
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private bgScene: THREE.Scene;
  private bgCamera: THREE.OrthographicCamera;
  private videoTexture: THREE.VideoTexture | null = null;
  private bgMesh: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;

    this.bgScene = new THREE.Scene();
    this.bgCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setVideoElement(video: HTMLVideoElement): void {
    this.videoTexture = new THREE.VideoTexture(video);
    this.videoTexture.minFilter = THREE.LinearFilter;
    this.videoTexture.magFilter = THREE.LinearFilter;
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;

    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.MeshBasicMaterial({
      map: this.videoTexture,
      depthTest: false,
      depthWrite: false,
    });

    this.bgMesh = new THREE.Mesh(geometry, material);
    this.bgScene.add(this.bgMesh);
  }

  update(): void {
    if (!this.videoTexture || !this.bgMesh) return;

    // Render camera background first
    this.renderer.clear();
    this.renderer.render(this.bgScene, this.bgCamera);
    // Don't clear depth — let 3D scene render on top
    this.renderer.clearDepth();
  }

  dispose(): void {
    if (this.videoTexture) {
      this.videoTexture.dispose();
    }
    if (this.bgMesh) {
      (this.bgMesh.material as THREE.Material).dispose();
      this.bgMesh.geometry.dispose();
      this.bgScene.remove(this.bgMesh);
    }
  }
}
