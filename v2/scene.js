// Vulpin decorative 3D scene.
// Renders a small cluster of generic wireframe/solid shapes inside any
// <canvas class="hero-scene"> element, tinted with the site's orange
// palette, and drifts them gently as the page is scrolled.
//
// This module is defensive on purpose: if three.js fails to load, if
// WebGL isn't available, or if anything else goes wrong, it fails
// silently so the rest of the page keeps working.

const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
      // Never let a decorative scene break the page.
      console.warn('vulpin scene skipped:', err);
    }
  });
}

function setupScene(THREE, canvas) {
  const container = canvas.parentElement;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch (err) {
    return; // No WebGL support.
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 9);

  // Warm lighting to match the orange gradient behind the canvas.
  const hemi = new THREE.HemisphereLight(0xfff1d6, 0xff8c00, 1.1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 0.65);
  key.position.set(4, 5, 6);
  scene.add(key);

  const group = new THREE.Group();
  scene.add(group);

  // A handful of generic primitives — kept intentionally simple.
  const solidMat = new THREE.MeshStandardMaterial({
    color: 0xfff3df,
    roughness: 0.35,
    metalness: 0.05,
    transparent: true,
    opacity: 0.9,
  });
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0xfff9ef,
    wireframe: true,
    transparent: true,
    opacity: 0.55,
  });

  const shapeDefs = [
    { geo: new THREE.IcosahedronGeometry(1.5, 0), mat: wireMat, pos: [0, 0, 0], spin: [0.05, 0.08, 0] },
    { geo: new THREE.TorusGeometry(1.9, 0.14, 12, 48), mat: solidMat, pos: [-2.6, 1.1, -1.5], spin: [0.12, 0.02, 0.05] },
    { geo: new THREE.OctahedronGeometry(0.85, 0), mat: solidMat, pos: [2.7, -1.2, -1], spin: [0.03, 0.1, 0.06] },
    { geo: new THREE.BoxGeometry(0.9, 0.9, 0.9), mat: wireMat, pos: [2.1, 1.6, -2], spin: [0.06, 0.06, 0.02] },
    { geo: new THREE.TetrahedronGeometry(0.8, 0), mat: solidMat, pos: [-2.3, -1.5, -0.5], spin: [0.08, 0.03, 0.09] },
  ];

  const meshes = shapeDefs.map((def) => {
    const mesh = new THREE.Mesh(def.geo, def.mat);
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
  }
  resize();

  let ro;
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver(resize);
    ro.observe(container);
  } else {
    window.addEventListener('resize', resize);
  }

  // Only animate while the canvas is actually on screen.
  let visible = true;
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible && !rafId) rafId = requestAnimationFrame(tick);
    }, { threshold: 0.01 });
    io.observe(container);
  }

  const clock = new THREE.Clock();
  let rafId = null;
  let scrollFactor = 0;

  function readScroll() {
    const max = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
    scrollFactor = window.scrollY / max; // 0..1 across the whole page
  }
  window.addEventListener('scroll', readScroll, { passive: true });
  readScroll();

  function renderStaticFrame() {
    group.rotation.y = scrollFactor * Math.PI * 0.5;
    renderer.render(scene, camera);
  }

  function tick() {
    if (!visible) { rafId = null; return; }
    const dt = clock.getDelta();

    group.rotation.y = scrollFactor * Math.PI * 0.6 + performance.now() * 0.00004;
    group.rotation.x = Math.sin(performance.now() * 0.00015) * 0.12;
    group.position.y = -scrollFactor * 0.8;

    meshes.forEach((m) => {
      const [sx, sy, sz] = m.userData.spin;
      m.rotation.x += sx * dt;
      m.rotation.y += sy * dt;
      m.rotation.z += sz * dt;
    });

    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  }

  if (REDUCE_MOTION) {
    // Respect reduced-motion: draw one still frame that reflects scroll
    // position without a continuously running animation loop.
    renderStaticFrame();
    window.addEventListener('scroll', () => { readScroll(); renderStaticFrame(); }, { passive: true });
  } else {
    rafId = requestAnimationFrame(tick);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
