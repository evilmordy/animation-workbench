import * as THREE from 'three';

export interface Three3dOpts {
  fov?: number;
  camera?: [number, number, number];
  target?: [number, number, number];
}

export interface ThreeHandle {
  THREE: typeof THREE;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
}

export interface ThreeView {
  root: HTMLElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
}

function num(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * 建一场 WebGL。canvas 按舞台像素挂进本场 root。
 * `preserveDrawingBuffer` 必须开，否则应用内截帧读回空缓冲。
 */
export function mountThree(
  root: HTMLElement,
  width: number,
  height: number,
  opts: Three3dOpts | undefined,
  views: ThreeView[],
): ThreeHandle {
  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  root.appendChild(canvas);
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      preserveDrawingBuffer: true,
      antialias: true,
      alpha: false,
    });
  } catch (error) {
    canvas.remove();
    throw error;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(num(opts?.fov, 40), width / Math.max(1, height), 0.1, 100);
  const pos = opts?.camera ?? [0, 4, 9];
  camera.position.set(num(pos[0], 0), num(pos[1], 4), num(pos[2], 9));
  const target = opts?.target ?? [0, 0, 0];
  camera.lookAt(num(target[0], 0), num(target[1], 0), num(target[2], 0));
  views.push({ root, scene, camera, renderer, canvas });
  // 把命名空间整个交回场景。打包器因此保留 SphereGeometry 等全部导出，供场景按名字取用。
  return { THREE, scene, camera, renderer, canvas };
}

/** `kill()` 和重建时释放 GPU 资源。geometry / material 去重后再 dispose。 */
export function disposeThree(view: ThreeView): void {
  const seen = new Set<object>();
  view.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    const geometry = mesh.geometry;
    if (geometry && !seen.has(geometry)) {
      seen.add(geometry);
      geometry.dispose();
    }
    const material = mesh.material;
    const list = Array.isArray(material) ? material : material ? [material] : [];
    for (const item of list) {
      if (seen.has(item)) continue;
      seen.add(item);
      item.dispose();
    }
  });
  view.renderer.dispose();
  view.renderer.forceContextLoss();
  view.canvas.remove();
}

export function renderThree(view: ThreeView): void {
  view.renderer.render(view.scene, view.camera);
}
