import * as THREE from 'three';
import { WebSLAM, Session } from '../src/index';

const container = document.getElementById('ar-container')!;
const status = document.getElementById('status')!;
const startBtn = document.getElementById('start-btn')! as HTMLButtonElement;

let session: Session | null = null;

startBtn.addEventListener('click', async () => {
  startBtn.style.display = 'none';
  status.textContent = 'Requesting camera...';

  try {
    session = await WebSLAM.createSession({
      container,
      camera: { facingMode: 'environment', width: 1280, height: 720 },
      features: ['slam', 'planes', 'markers'],
      debug: true,
    });

    status.textContent = 'Move phone slowly to initialize SLAM...';

    // Place a cube in world space (will stay fixed once SLAM tracks)
    const geometry = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const material = new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      metalness: 0.3,
      roughness: 0.4,
    });
    const cube = new THREE.Mesh(geometry, material);
    cube.position.set(0, 0, -0.5); // 50cm in front of initial camera position
    session.anchor.add(cube);

    // Add a grid on the ground for spatial reference
    const grid = new THREE.GridHelper(2, 20, 0x00ff88, 0x004422);
    grid.position.y = -0.3;
    session.anchor.add(grid);

    // Add axes helper
    const axes = new THREE.AxesHelper(0.15);
    axes.position.set(0, 0, -0.5);
    session.anchor.add(axes);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(1, 2, 3);
    session.scene.add(ambient);
    session.scene.add(directional);

    // Rotate cube for visual feedback
    const animate = () => {
      requestAnimationFrame(animate);
      cube.rotation.x += 0.01;
      cube.rotation.y += 0.015;
    };
    animate();

    // Track SLAM state changes
    session.on('trackingRestored', () => {
      status.textContent = 'SLAM Tracking';
      status.style.color = '#0f0';
    });

    session.on('trackingLost', () => {
      status.textContent = 'Tracking lost — move slowly';
      status.style.color = '#f44';
    });

    session.on('poseUpdate', () => {
      if (status.textContent?.includes('initialize')) {
        status.textContent = 'SLAM Tracking';
        status.style.color = '#0f0';
      }
    });

    session.on('error', (err) => {
      status.textContent = `Error: ${err.message}`;
      status.style.color = '#f44';
    });

  } catch (err) {
    status.textContent = `Failed: ${err instanceof Error ? err.message : err}`;
    status.style.color = '#f44';
    startBtn.style.display = 'block';
    startBtn.textContent = 'Retry';
  }
});
