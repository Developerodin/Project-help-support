'use client';

import { useEffect, useRef } from 'react';

const LOOP_DELAY = 1400;
const NODE_LABELS = { plan: 'PLAN', build: 'BUILD', test: 'TEST', review: 'REVIEW', done: 'DONE' };
const LABEL_HEIGHT_PX = 16;
const LABEL_DROP_PX = 29;

// Chrome serialises computed colors as oklch(), which THREE.Color cannot parse —
// it warns and silently leaves the color white. Round-trip through a 2D context,
// which normalises any CSS color to sRGB hex.
// fillStyle echoes oklch() back verbatim, so painting a pixel and reading it is
// the only conversion that actually lands in sRGB.
let srgbCtx;
function toSrgb(value) {
  if (!value) return null;
  if (/^(#|rgb)/i.test(value)) return value;
  if (srgbCtx === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    srgbCtx = canvas.getContext('2d', { willReadFrequently: true }) || null;
  }
  if (!srgbCtx) return null;
  srgbCtx.fillStyle = '#000000';
  srgbCtx.fillStyle = value;
  if (srgbCtx.fillStyle === '#000000') return null; // browser could not parse it
  srgbCtx.fillRect(0, 0, 1, 1);
  const [r, g, b] = srgbCtx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

function readCssColor(varName, THREE, fallbackHex) {
  const probe = document.createElement('span');
  probe.style.color = `var(${varName})`;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  return new THREE.Color(toSrgb(computed) || fallbackHex);
}

// Thresholds mirror the auth-split breakpoints in design-system.css, so this
// must read the viewport — the viz panel is only ever ~half of it.
function densityForWidth(viewportWidth) {
  if (viewportWidth >= 1024) return 'full';
  if (viewportWidth >= 768) return 'tablet';
  return 'mobile';
}

function buildGraph(density) {
  if (density === 'tablet') {
    return {
      nodes: [
        { id: 'plan', pos: [-1.45, 0.22, 0] },
        { id: 'build', pos: [-0.35, 0.02, 0] },
        { id: 'review', pos: [0.75, 0.18, 0] },
        { id: 'done', pos: [1.65, 0.02, 0], terminal: true },
      ],
      edges: [
        { a: 'plan', b: 'build', kind: 'main' },
        { a: 'build', b: 'review', kind: 'main' },
        { a: 'review', b: 'done', kind: 'main' },
      ],
      deps: [{ a: 'plan', b: 'build' }],
      tasks: [
        {
          id: 't1',
          kind: 'dot',
          at: 0,
          route: [
            { from: 'plan', to: 'build', duration: 2200, glow: 'build' },
            { from: 'build', to: 'review', duration: 2400, glow: 'review', coral: true },
            { from: 'review', to: 'done', duration: 2600, glow: 'done', complete: true },
          ],
        },
        {
          id: 't2',
          kind: 'card',
          at: 1800,
          route: [
            { from: 'plan', to: 'build', duration: 2600, glow: 'build' },
            { from: 'build', to: 'review', duration: 2800, glow: 'review' },
          ],
        },
        {
          id: 't3',
          kind: 'dot',
          at: 4200,
          route: [
            { from: 'build', to: 'review', duration: 2100, glow: 'review' },
            { from: 'review', to: 'done', duration: 2700, glow: 'done', complete: true },
          ],
        },
      ],
      loopDuration: 13200,
      waveAt: [0, 9600],
    };
  }

  return {
    nodes: [
      // y spread is deliberately wide — the viz panel is portrait on most laptops
      { id: 'plan', pos: [-1.75, 0.62, 0] },
      { id: 'build', pos: [-0.42, 0.14, 0] },
      { id: 'test', pos: [-0.18, -0.95, 0], branch: true },
      { id: 'review', pos: [0.92, 0.44, 0] },
      { id: 'done', pos: [1.82, 0.1, 0], terminal: true },
    ],
    edges: [
      { a: 'plan', b: 'build', kind: 'main' },
      { a: 'build', b: 'review', kind: 'main' },
      { a: 'review', b: 'done', kind: 'main' },
      { a: 'build', b: 'test', kind: 'branch' },
      { a: 'test', b: 'review', kind: 'branch' },
    ],
    deps: [
      { a: 'plan', b: 'build' },
      { a: 'build', b: 'test' },
      { a: 'test', b: 'review' },
    ],
    tasks: [
      {
        id: 'a',
        kind: 'dot',
        at: 0,
        route: [
          { from: 'plan', to: 'build', duration: 2400, glow: 'build' },
          { from: 'build', to: 'review', duration: 2200, glow: 'review', coral: true },
          { from: 'review', to: 'done', duration: 2600, glow: 'done', complete: true },
        ],
      },
      {
        id: 'b',
        kind: 'card',
        at: 2100,
        route: [
          { from: 'plan', to: 'build', duration: 2600, glow: 'build' },
          { from: 'build', to: 'test', duration: 2100, glow: 'test', coral: true },
          { from: 'test', to: 'review', duration: 2300, glow: 'review' },
          { from: 'review', to: 'done', duration: 2500, glow: 'done', complete: true },
        ],
      },
      {
        id: 'c',
        kind: 'dot',
        at: 1300,
        route: [
          { from: 'build', to: 'test', duration: 2000, glow: 'test' },
          { from: 'test', to: 'review', duration: 2200, glow: 'review' },
        ],
      },
      {
        id: 'd',
        kind: 'card',
        at: 4800,
        route: [
          { from: 'build', to: 'review', duration: 2500, glow: 'review', coral: true },
          { from: 'review', to: 'done', duration: 2700, glow: 'done', complete: true },
        ],
      },
      {
        id: 'e',
        kind: 'dot',
        at: 6800,
        route: [{ from: 'plan', to: 'build', duration: 2800, glow: 'build' }],
      },
    ],
    loopDuration: 15400,
    waveAt: [0, 10400],
  };
}

function makeCheckmark(THREE, color, px) {
  const geo = new THREE.BufferGeometry();
  const pts = new Float32Array([
    px(-5.4), 0, 0,
    px(-1.8), px(-3.8), 0,
    px(6.5), px(5.7), 0,
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 });
  const mark = new THREE.Line(geo, mat);
  mark.visible = false;
  return mark;
}

// ponytail: canvas-texture sprite beats a font loader / troika for 5 static words.
function makeLabel(THREE, text, color, labelWorldHeight) {
  const ss = 3; // supersample so tracked caps stay crisp on hidpi
  const fontPx = 22 * ss;
  const font = `600 ${fontPx}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  const tracking = `${0.16 * fontPx}px`;

  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d');
  measure.font = font;
  measure.letterSpacing = tracking;
  canvas.width = Math.ceil(measure.measureText(text).width) + fontPx;
  canvas.height = Math.ceil(fontPx * 1.6);

  const ctx = canvas.getContext('2d'); // resizing the canvas resets state
  ctx.font = font;
  ctx.letterSpacing = tracking;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const mat = new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.userData.aspect = canvas.width / canvas.height;
  sprite.scale.set(sprite.userData.aspect * labelWorldHeight, labelWorldHeight, 1);
  return { sprite, texture, mat };
}

function makeTaskMarker(THREE, kind, sigColor, mutedColor, shared) {
  if (kind === 'card') {
    const group = new THREE.Group();
    const cardMat = new THREE.MeshBasicMaterial({
      color: sigColor,
      transparent: true,
      opacity: 0.82,
    });
    const card = new THREE.Mesh(shared.cardGeo, cardMat);
    group.add(card);

    const barMat = new THREE.MeshBasicMaterial({
      color: mutedColor,
      transparent: true,
      opacity: 0.55,
    });
    const [bx1, by1, bx2, by2] = shared.barOffset;
    const bar1 = new THREE.Mesh(shared.barGeo, barMat);
    bar1.position.set(bx1, by1, 0.001);
    const bar2 = new THREE.Mesh(shared.barGeoSm, barMat);
    bar2.position.set(bx2, by2, 0.001);
    group.add(bar1, bar2);
    group.userData.mats = [cardMat, barMat];
    return group;
  }

  const dotMat = new THREE.MeshBasicMaterial({
    color: sigColor,
    transparent: true,
    opacity: 0.88,
  });
  const dot = new THREE.Mesh(shared.dotGeo, dotMat);
  dot.userData.mats = [dotMat];
  return dot;
}

function graphBounds(nodes) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.pos[0]);
    maxX = Math.max(maxX, node.pos[0]);
    minY = Math.min(minY, node.pos[1]);
    maxY = Math.max(maxY, node.pos[1]);
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    spanX: maxX - minX,
    spanY: maxY - minY,
  };
}

function fitCamera(camera, nodes, width, height) {
  const bounds = graphBounds(nodes);
  const aspect = width / height;
  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const graphFill = 0.72;
  const leftPadRatio = 0.03;

  const needSpanX = bounds.spanX / graphFill;
  const needSpanY = bounds.spanY / graphFill;
  const distForX = needSpanX / (2 * Math.tan(hFov / 2));
  const distForY = needSpanY / (2 * Math.tan(vFov / 2));
  const dist = Math.max(distForX, distForY, 3.6);

  const lookX = bounds.cx + bounds.spanX * leftPadRatio;
  const lookY = bounds.cy;

  camera.position.set(lookX, lookY, dist);
  camera.lookAt(lookX, lookY, 0);

  // world units per CSS pixel — lets every size below be authored in pixels, so
  // the graph reads the same on a 380px tablet rail and a 960px desktop panel
  return (2 * dist * Math.tan(hFov / 2)) / width;
}

function scheduleNodeArrival(timeline, nodeId, at, glowStates, pulseStates, duration = 1000) {
  timeline.add(
    glowStates[nodeId],
    { v: 1, duration: duration * 0.42, ease: 'outCubic' },
    at,
  );
  timeline.add(
    pulseStates[nodeId],
    { v: 1, duration: duration * 0.58, ease: 'outQuart' },
    at,
  );
  timeline.add(
    glowStates[nodeId],
    { v: 0, duration: 420, ease: 'inQuad' },
    at + duration * 0.55,
  );
  timeline.add(
    pulseStates[nodeId],
    { v: 0, duration: 380, ease: 'inQuad' },
    at + duration * 0.62,
  );
}

function initProjectFlow(container, THREE, createTimeline) {
  if (typeof WebGLRenderingContext === 'undefined') return () => {};

  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;
  const density = densityForWidth(window.innerWidth);
  if (density === 'mobile') return () => {};

  const graph = buildGraph(density);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.domElement.className = 'auth-bg__canvas';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 100);
  let worldPerPx = fitCamera(camera, graph.nodes, width, height);
  const px = (n) => n * worldPerPx;

  const sigColor = readCssColor('--au-sig', THREE, '#6b81cf');
  const doneColor = readCssColor('--au-done', THREE, '#43906d');
  const coralColor = readCssColor('--au-coral', THREE, '#e08078');
  const labelColor = readCssColor('--au-ink-2', THREE, '#c9cbd1');
  const mutedColor = sigColor.clone().multiplyScalar(0.78);

  const shared = {
    dotGeo: new THREE.SphereGeometry(px(4), 10, 10),
    cardGeo: new THREE.PlaneGeometry(px(14.5), px(9.5)),
    barGeo: new THREE.PlaneGeometry(px(8.4), px(1.2)),
    barGeoSm: new THREE.PlaneGeometry(px(5.8), px(1.2)),
    barOffset: [px(-1.8), px(2.1), px(-1.8), px(-0.3)],
  };

  const posById = Object.fromEntries(graph.nodes.map((n) => [n.id, n.pos]));
  const nodeRecords = {};
  const labelSprites = [];
  const disposables = [
    shared.dotGeo,
    shared.cardGeo,
    shared.barGeo,
    shared.barGeoSm,
  ];

  for (const node of graph.nodes) {
    const isBranch = Boolean(node.branch);
    const geo = new THREE.SphereGeometry(px(isBranch ? 6.4 : 8.2), 12, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: mutedColor,
      transparent: true,
      opacity: isBranch ? 0.52 : 0.64,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...node.pos);
    mesh.userData.idleOpacity = mat.opacity;
    scene.add(mesh);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(px(isBranch ? 10.7 : 13.4), 12, 12),
      new THREE.MeshBasicMaterial({
        color: sigColor,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    glow.position.copy(mesh.position);
    scene.add(glow);

    // light stroke, not green-on-green, so the tick reads against the completed node
    const check = node.terminal ? makeCheckmark(THREE, labelColor, px) : null;
    if (check) {
      // z-forward, else the sphere it sits on occludes all but the tip
      check.position.set(node.pos[0] + px(-0.6), node.pos[1] + px(-0.8), node.pos[2] + px(14));
      scene.add(check);
    }

    let label = null;
    if (NODE_LABELS[node.id]) {
      const built = makeLabel(THREE, NODE_LABELS[node.id], labelColor, px(LABEL_HEIGHT_PX));
      built.sprite.position.set(node.pos[0], node.pos[1] - px(LABEL_DROP_PX), node.pos[2]);
      scene.add(built.sprite);
      labelSprites.push(built.sprite);
      label = built.mat;
      disposables.push(built.texture, built.mat);
    }

    nodeRecords[node.id] = {
      mesh,
      glow,
      check,
      label,
      completed: false,
      completeFlash: 0,
    };
    disposables.push(geo, mat, glow.geometry, glow.material);
    if (check) disposables.push(check.geometry, check.material);
  }

  const mainLineMats = [];
  const branchLineMats = [];
  for (const edge of graph.edges) {
    const pa = posById[edge.a];
    const pb = posById[edge.b];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([pa[0], pa[1], pa[2], pb[0], pb[1], pb[2]], 3),
    );
    const isMain = edge.kind === 'main';
    const mat = new THREE.LineBasicMaterial({
      color: sigColor,
      transparent: true,
      opacity: isMain ? 0.34 : 0.22,
    });
    scene.add(new THREE.Line(geo, mat));
    disposables.push(geo, mat);
    if (isMain) mainLineMats.push(mat);
    else branchLineMats.push(mat);
  }

  const depStates = [];
  for (const dep of graph.deps) {
    const pa = posById[dep.a];
    const pb = posById[dep.b];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([pa[0], pa[1], pa[2], pb[0], pb[1], pb[2]], 3),
    );
    const mat = new THREE.LineDashedMaterial({
      color: sigColor,
      transparent: true,
      opacity: 0.1,
      dashSize: 0.06,
      gapSize: 0.045,
    });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    scene.add(line);
    disposables.push(geo, mat);
    depStates.push({ mat, pulse: { v: 0 } });
  }

  const taskRecords = [];
  for (const task of graph.tasks) {
    const marker = makeTaskMarker(THREE, task.kind, sigColor, mutedColor, shared);
    marker.visible = false;
    scene.add(marker);
    for (const mat of marker.userData.mats) disposables.push(mat);
    taskRecords.push({
      id: task.id,
      marker,
      seg: { t: 0 },
      accent: { v: 0 },
      visible: false,
    });
  }

  const fromVec = new THREE.Vector3();
  const toVec = new THREE.Vector3();
  let frameId = 0;

  const glowStates = Object.fromEntries(Object.keys(nodeRecords).map((id) => [id, { v: 0 }]));
  const pulseStates = Object.fromEntries(Object.keys(nodeRecords).map((id) => [id, { v: 0 }]));
  const waveStates = Object.fromEntries(Object.keys(nodeRecords).map((id) => [id, { v: 0 }]));
  const globalWave = { v: 0 };

  function resetScene() {
    for (const id of Object.keys(nodeRecords)) {
      nodeRecords[id].completed = false;
      nodeRecords[id].completeFlash = 0;
      glowStates[id].v = 0;
      pulseStates[id].v = 0;
      waveStates[id].v = 0;
    }
    for (const task of taskRecords) {
      task.marker.visible = false;
      task.visible = false;
      task.seg.t = 0;
      task.accent.v = 0;
    }
    for (const dep of depStates) dep.pulse.v = 0;
    globalWave.v = 0;
  }

  function applyNodeVisuals() {
    for (const id of Object.keys(nodeRecords)) {
      const { mesh, glow, check, label, completed, completeFlash } = nodeRecords[id];
      const glowAmt = glowStates[id].v;
      const pulse = pulseStates[id].v;
      const wave = waveStates[id].v;
      const idle = mesh.userData.idleOpacity;
      const base = completed ? doneColor : mutedColor;
      mesh.material.color.copy(base);
      // alpha >1 blows out to white in the blend, so hold everything under 1
      mesh.material.opacity = Math.min(
        1,
        (completed ? 0.86 : idle) + glowAmt * 0.2 + pulse * 0.1 + wave * 0.08 + completeFlash * 0.1,
      );
      mesh.scale.setScalar(1 + pulse * 0.15 + glowAmt * 0.06 + completeFlash * 0.08);
      glow.material.color.copy(completed ? doneColor : sigColor);
      glow.material.opacity = Math.min(0.7, glowAmt * 0.42 + wave * 0.12 + completeFlash * 0.18);
      if (check) {
        check.material.opacity = completed ? 0.92 : 0;
        check.visible = completed;
      }
      if (label) {
        label.color.copy(completed ? doneColor : labelColor);
        label.opacity = Math.min(1, 0.3 + glowAmt * 0.45 + wave * 0.14 + (completed ? 0.2 : 0));
      }
    }

    for (const task of taskRecords) {
      if (!task.visible) {
        task.marker.visible = false;
        continue;
      }
      task.marker.visible = true;
      const accent = task.accent.v;
      for (const mat of task.marker.userData.mats) {
        if (accent > 0.01) {
          mat.color.copy(sigColor).lerp(coralColor, accent * 0.65);
          mat.opacity = 0.82 + accent * 0.12;
        } else {
          mat.color.copy(sigColor);
          mat.opacity = task.marker.userData.mats.length > 1 ? 0.82 : 0.88;
        }
      }
    }

    for (const mat of mainLineMats) {
      mat.opacity = 0.22 + globalWave.v * 0.1;
    }
    for (const mat of branchLineMats) {
      mat.opacity = 0.14 + globalWave.v * 0.06;
    }
    for (const dep of depStates) {
      dep.mat.opacity = 0.1 + dep.pulse.v * 0.14;
    }
  }

  function animateLoop() {
    frameId = requestAnimationFrame(animateLoop);
    applyNodeVisuals();
    renderer.render(scene, camera);
  }
  animateLoop();

  const timeline = createTimeline({
    loop: true,
    loopDelay: LOOP_DELAY,
    onLoop: resetScene,
  });

  timeline.add({ duration: 1, onBegin: resetScene }, 0);

  for (let i = 0; i < graph.tasks.length; i += 1) {
    const taskDef = graph.tasks[i];
    const taskRec = taskRecords[i];
    let cursor = taskDef.at;

    for (const segment of taskDef.route) {
      const from = posById[segment.from];
      const to = posById[segment.to];
      const arriveAt = cursor + segment.duration;
      const isLast = segment === taskDef.route[taskDef.route.length - 1];

      timeline.add(
        taskRec.seg,
        {
          t: [0, 1],
          duration: segment.duration,
          ease: 'outCubic',
          onBegin: () => {
            taskRec.seg.t = 0;
            taskRec.visible = true;
            fromVec.set(from[0], from[1], from[2]);
            toVec.set(to[0], to[1], to[2]);
            taskRec.marker.position.copy(fromVec);
            taskRec.marker.visible = true;
            if (segment.coral) taskRec.accent.v = 1;
          },
          onUpdate: () => {
            taskRec.marker.position.lerpVectors(fromVec, toVec, taskRec.seg.t);
          },
          onComplete: () => {
            if (segment.complete || isLast) {
              taskRec.visible = false;
              taskRec.marker.visible = false;
            }
          },
        },
        cursor,
      );

      if (segment.coral) {
        timeline.add(
          taskRec.accent,
          { v: 0, duration: 680, ease: 'outQuad' },
          cursor + Math.min(520, segment.duration * 0.35),
        );
      }

      scheduleNodeArrival(timeline, segment.glow, arriveAt - 80, glowStates, pulseStates, 1000);

      if (segment.complete) {
        timeline.add(
          { duration: 1, onBegin: () => { nodeRecords[segment.glow].completed = true; } },
          arriveAt + 120,
        );
        timeline.add(
          pulseStates[segment.glow],
          { v: 1, duration: 900, ease: 'outQuart' },
          arriveAt + 80,
        );
        timeline.add(
          pulseStates[segment.glow],
          { v: 0, duration: 420, ease: 'inQuad' },
          arriveAt + 980,
        );
        timeline.add(
          { duration: 1, onBegin: () => { nodeRecords[segment.glow].completeFlash = 1; } },
          arriveAt + 100,
        );
        timeline.add(
          { duration: 1, onBegin: () => { nodeRecords[segment.glow].completeFlash = 0; } },
          arriveAt + 1100,
        );
        // ponytail: no reset-to-false — the node settles completed until resetScene on loop
      }

      cursor = arriveAt + 180;
    }
  }

  const mainWaveOrder = ['plan', 'build', 'review', 'done'];
  for (const waveAt of graph.waveAt) {
    timeline.add(globalWave, { v: 1, duration: 2200, ease: 'outQuart' }, waveAt);
    timeline.add(globalWave, { v: 0, duration: 1800, ease: 'inQuad' }, waveAt + 2400);

    mainWaveOrder.forEach((nodeId, idx) => {
      const nodeWaveAt = waveAt + idx * 420;
      timeline.add(waveStates[nodeId], { v: 1, duration: 680, ease: 'outCubic' }, nodeWaveAt);
      timeline.add(waveStates[nodeId], { v: 0, duration: 520, ease: 'inQuad' }, nodeWaveAt + 720);
    });
  }

  depStates.forEach((dep, idx) => {
    const depAt = 3200 + idx * 2100;
    timeline.add(dep.pulse, { v: 1, duration: 900, ease: 'outCubic' }, depAt);
    timeline.add(dep.pulse, { v: 0, duration: 700, ease: 'inQuad' }, depAt + 950);
    timeline.add(dep.pulse, { v: 1, duration: 900, ease: 'outCubic' }, depAt + graph.loopDuration * 0.55);
    timeline.add(dep.pulse, { v: 0, duration: 700, ease: 'inQuad' }, depAt + graph.loopDuration * 0.55 + 950);
  });

  function onResize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    worldPerPx = fitCamera(camera, graph.nodes, w, h);
    renderer.setSize(w, h);
    // labels are the only px-authored thing that must be rescaled live; node and
    // marker geometry is close enough across a resize to leave alone
    const labelHeight = px(LABEL_HEIGHT_PX);
    for (const sprite of labelSprites) {
      sprite.scale.set(sprite.userData.aspect * labelHeight, labelHeight, 1);
    }
  }
  window.addEventListener('resize', onResize);
  container.classList.add('auth-bg--live');

  return () => {
    cancelAnimationFrame(frameId);
    window.removeEventListener('resize', onResize);
    timeline.pause?.();
    renderer.dispose();
    for (const item of disposables) item.dispose?.();
    if (renderer.domElement.parentNode === container) {
      container.removeChild(renderer.domElement);
    }
    container.classList.remove('auth-bg--live');
  };
}

// Mirrors the WebGL graph 1:1 so the reduced-motion and pre-boot views read the same.
const STATIC_NODES = [
  { id: 'plan', x: 46, y: 78, r: 5.5 },
  { id: 'build', x: 183, y: 125, r: 5.5 },
  { id: 'test', x: 208, y: 230, r: 4.2, branch: true },
  { id: 'review', x: 321, y: 95, r: 5.5 },
  { id: 'done', x: 414, y: 128, r: 6, terminal: true },
];

function WorkflowStatic() {
  const done = 'var(--au-done, oklch(0.580 0.090 155))';
  return (
    <svg
      className="auth-bg__workflow"
      viewBox="0 0 460 272"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <g fill="none" stroke="var(--au-sig)" strokeLinecap="round">
        <path d="M 46 78 L 183 125 L 321 95 L 414 128" strokeWidth="1.3" opacity="0.34" />
        <path d="M 183 125 L 208 230 L 321 95" strokeWidth="1.1" opacity="0.22" />
      </g>
      <g
        fill="none"
        stroke="var(--au-sig)"
        strokeWidth="0.9"
        strokeDasharray="4 5"
        strokeLinecap="round"
        opacity="0.16"
      >
        <path d="M 46 78 L 183 125" />
        <path d="M 183 125 L 208 230" />
        <path d="M 208 230 L 321 95" />
      </g>

      {/* tasks mid-flight, so the still frame still says "several things in progress" */}
      <g fill="var(--au-sig)">
        <rect x="107" y="97" width="14" height="9" rx="2" opacity="0.7" />
        <circle cx="245" cy="112" r="3.4" opacity="0.75" />
        <circle cx="253" cy="176" r="3.4" opacity="0.6" />
      </g>

      <g fill="var(--au-sig)">
        {STATIC_NODES.map((n) => (
          <circle
            key={n.id}
            cx={n.x}
            cy={n.y}
            r={n.r}
            fill={n.terminal ? done : 'var(--au-sig)'}
            opacity={n.terminal ? 0.78 : n.branch ? 0.5 : 0.62}
          />
        ))}
      </g>
      <path
        d="M 410 128 L 413.5 132 L 419 123"
        fill="none"
        stroke="var(--au-ink-2)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      />

      <g
        fill="var(--au-ink-2)"
        fontSize="9"
        fontWeight="600"
        letterSpacing="1.6"
        textAnchor="middle"
      >
        {STATIC_NODES.map((n) => (
          <text
            key={n.id}
            x={n.x}
            y={n.y + 21}
            fill={n.terminal ? done : 'var(--au-ink-2)'}
            opacity={n.terminal ? 0.5 : 0.34}
          >
            {NODE_LABELS[n.id]}
          </text>
        ))}
      </g>
    </svg>
  );
}

export default function AuthBackground() {
  const hostRef = useRef(null);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches) return undefined;

    let cancelled = false;
    let teardown = () => {};
    let idleId = 0;
    let timeoutId = 0;

    const boot = () => {
      if (cancelled || !hostRef.current) return;
      Promise.all([import('three'), import('animejs')])
        .then(([THREE, animeMod]) => {
          if (cancelled || !hostRef.current) return;
          const createTimeline = animeMod.createTimeline ?? animeMod.default?.createTimeline;
          if (typeof createTimeline !== 'function') return;
          teardown = initProjectFlow(hostRef.current, THREE, createTimeline);
        })
        .catch(() => {});
    };

    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(boot, { timeout: 2200 });
    } else {
      timeoutId = window.setTimeout(boot, 120);
    }

    const onReduced = (event) => {
      if (event.matches) {
        cancelled = true;
        teardown();
      }
    };
    reduced.addEventListener('change', onReduced);

    return () => {
      cancelled = true;
      if (idleId) window.cancelIdleCallback(idleId);
      if (timeoutId) window.clearTimeout(timeoutId);
      reduced.removeEventListener('change', onReduced);
      teardown();
    };
  }, []);

  return (
    <div className="auth-bg" ref={hostRef} aria-hidden="true">
      <div className="auth-bg__static">
        <WorkflowStatic />
      </div>
      <p className="auth-bg__caption">Plan. Build. Deliver.</p>
    </div>
  );
}

