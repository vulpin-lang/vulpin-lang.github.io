// Vulpin decorative 3D scene.
// Renders a small cluster of generic wireframe/solid shapes inside any
// <canvas class="hero-scene"> element, tinted with the site's orange
// palette, and eases them as the page is scrolled.
//
// Perf rules this file follows, because a decorative background must
// never be the reason the page feels slow:
//   1. Only one shared scroll listener for the whole page (not one per
//      canvas) and it never forces layout — scrollHeight is measured
//      once on load/resize, not on every scroll tick.
//   2. The render loop stops completely ~0.7s after scrolling stops,
//      instead of running forever. It only wakes back up on scroll,
//      resize, or the canvas re-entering view.
//   3. Pixel ratio, shape count, and antialiasing all scale down on
//      narrow/low-power screens.
//   4. Any failure (no WebGL, CDN blocked, etc.) is caught and the
//      page keeps working with no console errors.

const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const IS_NARROW = window.matchMedia('(max-width: 576px)').matches;
const SETTLE_MS = 700;

// ---- one shared, throttled scroll reader for every canvas on the page ----
let scrollFactor = 0;
let scrollRange = 1;
let lastScrollAt = performance.now();
let scrollTicking = false;
const wakeCallbacks = [];

function measureScrollRange() {
  scrollRange = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
}
function readScrollFactor() {
  scrollFactor = window.scrollY / scrollRange;
  scrollTicking = false;
}
window.addEventListener('resize', measureScrollRange, { passive: true });
window.addEventListener('scroll', () => {
  lastScrollAt = performance.now();
  if (!scrollTicking) {
    scrollTicking = true;
    requestAnimationFrame(readScrollFactor);
  }
  wakeCallbacks.forEach((wake) => wake());
}, { passive: true });
measureScrollRange();
readScrollFactor();

async function boot() {
  const canvases = Array.from(document.querySelectorAll('canvas.hero-scene'));
  if (canvases.length === 0) return;

  let THREE;
  try {
    THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
  } catch (err) {
    return; // No three.js available (offline, blocked CDN, etc). Fail quietly.
  }

  canvases.forEach((canvas) => {
    try {
      setupScene(THREE, canvas);
    } catch (err) {
      console.warn('vulpin scene skipped:', err);
    }
  });
}

function setupScene(THREE, canvas) {
  const container = canvas.parentElement;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !IS_NARROW });
  } catch (err) {
    return; // No WebGL support.
  }
  const maxDpr = IS_NARROW ? 1 : 1.5;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 9);

  const hemi = new THREE.HemisphereLight(0xfff1d6, 0xff8c00, 1.1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 0.65);
  key.position.set(4, 5, 6);
  scene.add(key);

  const group = new THREE.Group();
  scene.add(group);

  const solidMat = new THREE.MeshStandardMaterial({
    color: 0xfff3df, roughness: 0.35, metalness: 0.05, transparent: true, opacity: 0.9,
  });
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0xfff9ef, wireframe: true, transparent: true, opacity: 0.55,
  });

  // Fewer, simpler shapes on small screens — this is the biggest lever
  // on fill-rate cost, more so than pixel ratio.
  const allShapeDefs = [
    { geo: () => new THREE.IcosahedronGeometry(1.5, 0), mat: wireMat, pos: [0, 0, 0], spin: [0.05, 0.08, 0] },
    { geo: () => new THREE.TorusGeometry(1.9, 0.14, 8, 32), mat: solidMat, pos: [-2.6, 1.1, -1.5], spin: [0.12, 0.02, 0.05] },
    { geo: () => new THREE.OctahedronGeometry(0.85, 0), mat: solidMat, pos: [2.7, -1.2, -1], spin: [0.03, 0.1, 0.06] },
    { geo: () => new THREE.BoxGeometry(0.9, 0.9, 0.9), mat: wireMat, pos: [2.1, 1.6, -2], spin: [0.06, 0.06, 0.02] },
    { geo: () => new THREE.TetrahedronGeometry(0.8, 0), mat: solidMat, pos: [-2.3, -1.5, -0.5], spin: [0.08, 0.03, 0.09] },
  ];
  const shapeDefs = IS_NARROW ? allShapeDefs.slice(0, 3) : allShapeDefs;

  const meshes = shapeDefs.map((def) => {
    const mesh = new THREE.Mesh(def.geo(), def.mat);
    mesh.position.set(def.pos[0], def.pos[1], def.pos[2]);
    mesh.userData.spin = def.spin;
    group.add(mesh);
    return mesh;
  });

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderFrame();
  }
  resize();

  if ('ResizeObserver' in window) {
    new ResizeObserver(resize).observe(container);
  } else {
    window.addEventListener('resize', resize, { passive: true });
  }

  let visible = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible) wake();
    }, { threshold: 0.01 }).observe(container);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wake();
  });

  const clock = new THREE.Clock();
  let rafId = null;

  function renderFrame() {
    group.rotation.y = scrollFactor * Math.PI * 0.6;
    group.position.y = -scrollFactor * 0.8;
    renderer.render(scene, camera);
  }

  function tick() {
    if (!visible) { rafId = null; return; }
    const dt = clock.getDelta();

    meshes.forEach((m) => {
      const [sx, sy, sz] = m.userData.spin;
      m.rotation.x += sx * dt;
      m.rotation.y += sy * dt;
      m.rotation.z += sz * dt;
    });
    renderFrame();

    if (performance.now() - lastScrollAt < SETTLE_MS) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = null; // Idle: stop the loop entirely until the next wake().
    }
  }

  function wake() {
    if (REDUCE_MOTION) { renderFrame(); return; }
    if (!visible) return;
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  renderFrame();
  wakeCallbacks.push(wake);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
