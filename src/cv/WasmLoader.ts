declare global {
  interface Window {
    cv: any;
  }
  var cv: any;
  function importScripts(...urls: string[]): void;
}

let cvInstance: any = null;
let loadPromise: Promise<any> | null = null;

export function getOpenCV(): any {
  if (!cvInstance) {
    throw new Error('[WebSLAM] OpenCV not loaded yet. Call loadOpenCV() first.');
  }
  return cvInstance;
}

export function isOpenCVLoaded(): boolean {
  return cvInstance !== null;
}

export function loadOpenCV(wasmPath?: string): Promise<any> {
  if (cvInstance) return Promise.resolve(cvInstance);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = typeof importScripts === 'function';

    if (script) {
      // Running inside a Web Worker
      loadInWorker(wasmPath)
        .then((cv) => {
          cvInstance = cv;
          resolve(cv);
        })
        .catch(reject);
    } else {
      // Running in main thread (fallback)
      loadInMainThread(wasmPath)
        .then((cv) => {
          cvInstance = cv;
          resolve(cv);
        })
        .catch(reject);
    }
  });

  return loadPromise;
}

async function loadInWorker(wasmPath?: string): Promise<any> {
  const path = wasmPath || '/opencv.js';

  // importScripts is synchronous in workers
  (self as any).Module = {
    onRuntimeInitialized: () => {},
  };

  importScripts(path);

  // opencv.js may set cv as a promise or directly
  const cv = await waitForCV();
  return cv;
}

async function loadInMainThread(wasmPath?: string): Promise<any> {
  const path = wasmPath || '/opencv.js';

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = path;

    script.onload = async () => {
      try {
        const cv = await waitForCV();
        resolve(cv);
      } catch (err) {
        reject(err);
      }
    };

    script.onerror = () => {
      reject(new Error(`[WebSLAM] Failed to load OpenCV.js from ${path}`));
    };

    document.head.appendChild(script);
  });
}

function waitForCV(timeout = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const check = () => {
      const g = typeof self !== 'undefined' ? self : globalThis;
      const candidate = (g as any).cv;

      if (candidate) {
        // OpenCV.js 4.x exposes cv as a function that returns a promise
        if (typeof candidate === 'function') {
          candidate().then((cv: any) => {
            (g as any).cv = cv;
            cvInstance = cv;
            resolve(cv);
          }).catch(reject);
          return;
        }

        // Or it may already be the ready module
        if (candidate.Mat) {
          cvInstance = candidate;
          resolve(candidate);
          return;
        }

        // It may have an onRuntimeInitialized pattern
        if (typeof candidate.then === 'function') {
          candidate.then((cv: any) => {
            cvInstance = cv;
            resolve(cv);
          }).catch(reject);
          return;
        }
      }

      if (Date.now() - start > timeout) {
        reject(new Error('[WebSLAM] Timeout waiting for OpenCV.js to initialize'));
        return;
      }

      setTimeout(check, 50);
    };

    check();
  });
}
