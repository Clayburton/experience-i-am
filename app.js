/* ============================================================
   experience i am — banner engine
   three.js layer = 2 draw calls (grain quad + pollen points),
   no assets, no post stack, DPR-capped. DOM type paints first;
   the canvas fades in when the first frame is ready.
   ============================================================ */
import * as THREE from "three";

const stage = document.getElementById("stage");
const canvas = document.getElementById("gl");
const disc = document.getElementById("disc");

/* ---------------- renderer (deliberately tiny) ---------------- */
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,            // dots + grain need no MSAA
  alpha: false,
  powerPreference: "low-power",
});
renderer.setClearColor(0xffffff, 1);
const DPR = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(DPR);

const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/* ---------------- paper grain + vignette (one quad) ---------------- */
const grain = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    uniforms: {
      uT: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform float uT; uniform vec2 uRes;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec2 uv = gl_FragCoord.xy / uRes;
        float g = h(gl_FragCoord.xy + fract(uT) * 7.0) * 0.035;       // paper grain
        float d = distance(uv, vec2(0.5, 0.42));
        float v = smoothstep(0.42, 1.15, d) * 0.05;                    // soft vignette
        gl_FragColor = vec4(vec3(0.0), g + v);
      }`,
  })
);
grain.renderOrder = 1;
scene.add(grain);

/* ---------------- pollen (GPU points, wraps forever) ---------------- */
const N = 150;
const pos = new Float32Array(N * 3);
const seed = new Float32Array(N);
for (let i = 0; i < N; i++) {
  pos[i * 3 + 0] = (Math.random() * 2 - 1) * 1.1;
  pos[i * 3 + 1] = (Math.random() * 2 - 1) * 1.1;
  pos[i * 3 + 2] = 0;
  seed[i] = Math.random();
}
const pgeo = new THREE.BufferGeometry();
pgeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
pgeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));

const pollenUniforms = {
  uT: { value: 0 },
  uDpr: { value: DPR },
  uPtr: { value: new THREE.Vector2(0, 0.4) },  // NDC attractor (the spotlight)
  uAspect: { value: 1 },
};
const pollen = new THREE.Points(
  pgeo,
  new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    uniforms: pollenUniforms,
    vertexShader: `
      attribute float aSeed;
      uniform float uT, uDpr, uAspect;
      uniform vec2 uPtr;
      varying float vTw;
      void main(){
        vec2 p = position.xy;
        float spd = 0.014 + aSeed * 0.02;
        p.y = mod(p.y + uT * spd + 1.1, 2.2) - 1.1;                       // rise + wrap
        p.x += sin(uT * (0.22 + aSeed * 0.3) + aSeed * 40.0) * 0.045;     // lazy sway
        vec2 d = uPtr - p;                                                 // lean toward the light
        p += d * 0.06 * smoothstep(0.9, 0.0, length(vec2(d.x * uAspect, d.y)));
        vTw = 0.55 + 0.45 * sin(uT * (0.6 + aSeed * 1.7) + aSeed * 90.0);
        gl_Position = vec4(p, 0.0, 1.0);
        gl_PointSize = (1.4 + aSeed * 2.6) * uDpr;
      }`,
    fragmentShader: `
      varying float vTw;
      void main(){
        float r = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.12, r) * 0.30 * vTw;
        gl_FragColor = vec4(vec3(0.55, 0.42, 0.18), a);                    // warm pollen on paper
      }`,
  })
);
scene.add(pollen);

/* ---------------- spotlight: follow the mouse, else drift ---------------- */
const finePointer = matchMedia("(pointer: fine)").matches;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let W = 1, H = 1;
let sx = 0.5, sy = 0.32;          // spotlight position, fractions of stage
let tx = 0.5, ty = 0.32;          // target
let lastMove = -1e9;

function applySpot() {
  const x = sx * W, y = sy * H;
  stage.style.setProperty("--sx", x.toFixed(1) + "px");
  stage.style.setProperty("--sy", y.toFixed(1) + "px");
  pollenUniforms.uPtr.value.set(sx * 2 - 1, -(sy * 2 - 1));
}

if (finePointer) {
  window.addEventListener("pointermove", (e) => {
    tx = e.clientX / Math.max(1, W);
    ty = e.clientY / Math.max(1, H);
    lastMove = tSec;
  });
}

/* ---------------- resize (iframe-safe: measure the stage) ---------------- */
function resize() {
  W = stage.clientWidth || 1;
  H = stage.clientHeight || 1;
  renderer.setSize(W, H, false);
  const db = new THREE.Vector2();
  renderer.getDrawingBufferSize(db);
  grain.material.uniforms.uRes.value.copy(db);
  pollenUniforms.uAspect.value = W / H;
  applySpot();
}
new ResizeObserver(() => { resize(); renderFrame(); }).observe(stage);
resize();

/* ---------------- loop ---------------- */
const clock = new THREE.Clock();
let tSec = 0;

function step(dt) {
  tSec += dt;
  // idle → slow lissajous drift; recent mouse → chase the cursor
  const idle = tSec - lastMove > 2.5;
  if (idle) {
    tx = 0.5 + 0.34 * Math.sin(tSec * 0.11);
    ty = 0.36 + 0.22 * Math.sin(tSec * 0.157 + 1.7);
  }
  const k = 1 - Math.exp(-(idle ? 1.6 : 9) * dt);   // soft chase, snappier on mouse
  sx += (tx - sx) * k;
  sy += (ty - sy) * k;
  applySpot();
  grain.material.uniforms.uT.value = tSec;
  pollenUniforms.uT.value = reduced ? 0 : tSec;
}

function renderFrame() {
  renderer.render(scene, cam);
}

renderer.setAnimationLoop(() => {
  step(Math.min(clock.getDelta(), 0.1));
  renderFrame();
});

/* first frame synchronously (the hidden preview tab pauses rAF), then reveal */
step(1 / 60);
renderFrame();
canvas.classList.add("on");
disc.classList.add("on");

/* ---------------- resilience (per CLAUDE.md lessons) ---------------- */
canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); }, false);
canvas.addEventListener("webglcontextrestored", () => { resize(); renderFrame(); }, false);
// iOS back/forward restores the page with a silently dead GL context
addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  const gl = renderer.getContext && renderer.getContext();
  if (gl && gl.isContextLost && gl.isContextLost()) location.reload();
  else { resize(); renderFrame(); }
});

/* ---------------- debug ---------------- */
window.__xp = {
  renderOnce: () => { step(1 / 60); renderFrame(); },
  setSpot: (fx, fy) => { sx = tx = fx; sy = ty = fy; applySpot(); renderFrame(); },
  get spot() { return { sx, sy, W, H }; },
};
