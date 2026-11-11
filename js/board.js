// 靶面幾何、計分、SVG 繪製，以及靶面鏡頭（校正 + 自動偵測落點）

// 標準鋼鏢靶尺寸 (mm, 半徑)
const R = {
  DBULL: 6.35,
  BULL: 15.9,
  TRP_IN: 99,
  TRP_OUT: 107,
  DBL_IN: 162,
  DBL_OUT: 170,
};
const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

// 座標：x 向右、y 向下 (與影像相同)，單位 mm，原點為靶心
const polar = (r, deg) => [r * Math.sin(deg * Math.PI / 180), -r * Math.cos(deg * Math.PI / 180)];

function scoreAt(x, y) {
  const r = Math.hypot(x, y);
  if (r <= R.DBULL) return { score: 50, label: 'BULL', num: 25, mult: 2 };
  if (r <= R.BULL) return { score: 25, label: '25', num: 25, mult: 1 };
  if (r > R.DBL_OUT) return { score: 0, label: 'MISS', num: 0, mult: 0 };
  let a = Math.atan2(x, -y) * 180 / Math.PI;
  if (a < 0) a += 360;
  const num = SECTORS[Math.floor(((a + 9) % 360) / 18)];
  if (r >= R.DBL_IN) return { score: num * 2, label: 'D' + num, num, mult: 2 };
  if (r >= R.TRP_IN && r <= R.TRP_OUT) return { score: num * 3, label: 'T' + num, num, mult: 3 };
  return { score: num, label: 'S' + num, num, mult: 1 };
}

function targetPoint(label) {
  if (!label || label === 'BULL') return [0, 0];
  const num = parseInt(label.slice(1), 10);
  const idx = SECTORS.indexOf(num);
  if (idx < 0) return [0, 0];
  const r = label[0] === 'T' ? (R.TRP_IN + R.TRP_OUT) / 2 : label[0] === 'D' ? (R.DBL_IN + R.DBL_OUT) / 2 : 135;
  return polar(r, idx * 18);
}

function isTargetHit(target, label) {
  if (target === 'BULL') return label === 'BULL' || label === '25';
  return label === target;
}

function targetOptions() {
  const out = [{ v: 'BULL', t: '靶心 Bull' }];
  for (const n of [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) out.push({ v: 'T' + n, t: 'T' + n + ' (三倍區)' });
  for (const n of [20, 16, 18, 12, 8, 10, 4, 2, 19, 17, 15, 14, 13, 11, 9, 7, 6, 5, 3, 1]) out.push({ v: 'D' + n, t: 'D' + n + ' (雙倍區)' });
  return out;
}

// 方位描述 (dx 右正、dyUp 上正)
function directionText(dx, dyUp) {
  const parts = [];
  if (Math.abs(dyUp) > 4) parts.push(dyUp > 0 ? '上' : '下');
  if (Math.abs(dx) > 4) parts.push(dx > 0 ? '右' : '左');
  return parts.length ? '偏' + parts.join('') : '置中';
}

// ---------- SVG 靶面 ----------
const NS = 'http://www.w3.org/2000/svg';
function arcPath(r1, r2, a1, a2) {
  const [x1, y1] = polar(r2, a1), [x2, y2] = polar(r2, a2);
  const [x3, y3] = polar(r1, a2), [x4, y4] = polar(r1, a1);
  return `M${x1},${y1} A${r2},${r2} 0 0 1 ${x2},${y2} L${x3},${y3} A${r1},${r1} 0 0 0 ${x4},${y4} Z`;
}
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

function drawBoardBase(svg) {
  svg.setAttribute('viewBox', '-205 -205 410 410');
  svg.innerHTML = '';
  const g = el('g', { class: 'board-base' }, svg);
  el('circle', { cx: 0, cy: 0, r: 200, fill: '#0f0f10' }, g);
  const C = { dark: '#1d1d1f', light: '#e9dcb8', red: '#c8352f', green: '#1d8a4e' };
  SECTORS.forEach((num, i) => {
    const a1 = i * 18 - 9, a2 = i * 18 + 9;
    const even = i % 2 === 0;
    const single = even ? C.dark : C.light, ring = even ? C.red : C.green;
    el('path', { d: arcPath(R.BULL, R.TRP_IN, a1, a2), fill: single }, g);
    el('path', { d: arcPath(R.TRP_IN, R.TRP_OUT, a1, a2), fill: ring }, g);
    el('path', { d: arcPath(R.TRP_OUT, R.DBL_IN, a1, a2), fill: single }, g);
    el('path', { d: arcPath(R.DBL_IN, R.DBL_OUT, a1, a2), fill: ring }, g);
    const [tx, ty] = polar(186, i * 18);
    const t = el('text', { x: tx, y: ty, class: 'board-num', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
    t.textContent = num;
  });
  el('circle', { cx: 0, cy: 0, r: R.BULL, fill: C.green }, g);
  el('circle', { cx: 0, cy: 0, r: R.DBULL, fill: C.red }, g);
  // 細線
  for (const r of [R.BULL, R.TRP_IN, R.TRP_OUT, R.DBL_IN, R.DBL_OUT]) el('circle', { cx: 0, cy: 0, r, fill: 'none', stroke: '#9aa3ad', 'stroke-width': 0.6, opacity: 0.6 }, g);
  return el('g', { class: 'board-layer' }, svg);
}

// ---------- 靶面鏡頭 ----------
const CALIB_DST = [[0, -R.DBL_OUT], [R.DBL_OUT, 0], [0, R.DBL_OUT], [-R.DBL_OUT, 0]];
const CALIB_LABELS = ['20 區雙倍外緣 (正上)', '6 區雙倍外緣 (正右)', '3 區雙倍外緣 (正下)', '11 區雙倍外緣 (正左)'];

class BoardCam {
  constructor(video, canvas, cb) {
    this.video = video; this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.cb = cb; // { onHit(img,mm,meta), onHitMoved(id,mm), onStatus(text,level), onCalibChange() }
    this.calib = []; // 影像座標 (以 0..1 正規化儲存)
    this.H = null; this.Hinv = null;
    this.calibrating = false;
    this.markers = []; // 本輪落點 {id, img:[x,y], label}
    this.auto = true; this.tipMode = 'top'; this.diffThresh = 28; this.minPx = 5;
    this.small = document.createElement('canvas');
    this.sctx = this.small.getContext('2d', { willReadFrequently: true });
    this.ref = null; this.prev = null; this.mask = null;
    this.lastMotion = 0; this.evaluated = true; this.lastProc = 0;
    this.drag = null;
    this._bindPointer();
  }

  get vw() { return this.video.videoWidth || 1280; }
  get vh() { return this.video.videoHeight || 720; }

  setCalibration(norm) {
    this.calib = norm ? norm.map(p => [...p]) : [];
    this._computeH();
  }
  _computeH() {
    this.H = this.Hinv = null; this.mask = null;
    if (this.calib.length === 4) {
      const src = this.calib.map(([x, y]) => [x * this.vw, y * this.vh]);
      this.H = solveHomography(src, CALIB_DST);
      this.Hinv = this.H && invertH(this.H);
      this.resetReference();
    }
  }
  get calibrated() { return !!this.H; }
  toBoard(x, y) { return applyH(this.H, x, y); }
  toImage(x, y) { return applyH(this.Hinv, x, y); }

  startCalibration() {
    this.calibrating = true; this.calib = []; this.H = null; this.Hinv = null;
    this.cb.onStatus(`校正：請點擊 ${CALIB_LABELS[0]}`, 'info');
  }
  finishCalibration() {
    this.calibrating = false;
    if (this.calib.length === 4) { this._computeH(); this.cb.onCalibChange(); this.cb.onStatus('校正完成，可以開始投擲', 'ok'); }
    else this.cb.onStatus('校正未完成（需要 4 個點）', 'warn');
  }

  clearMarkers() { this.markers = []; }
  resetReference() { this.ref = null; this.prev = null; this.evaluated = true; this.lastMotion = performance.now(); }

  // ---- 指標互動 ----
  _evtToImg(e) {
    const r = this.canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * this.vw, (e.clientY - r.top) / r.height * this.vh];
  }
  _pxScale() { const r = this.canvas.getBoundingClientRect(); return this.vw / Math.max(1, r.width); }
  _bindPointer() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => {
      if (!this.video.videoWidth) return;
      const p = this._evtToImg(e), tol = 14 * this._pxScale();
      if (this.calibrating) {
        const i = this.calib.findIndex(q => Math.hypot(q[0] * this.vw - p[0], q[1] * this.vh - p[1]) < tol);
        if (i >= 0) { this.drag = { type: 'calib', i }; c.setPointerCapture(e.pointerId); return; }
        if (this.calib.length < 4) {
          this.calib.push([p[0] / this.vw, p[1] / this.vh]);
          if (this.calib.length < 4) this.cb.onStatus(`校正：請點擊 ${CALIB_LABELS[this.calib.length]}`, 'info');
          else { this._computeH(); this.cb.onStatus('4 點已放置，可拖曳微調，對齊後按「完成校正」', 'info'); }
        }
        return;
      }
      if (!this.calibrated) { this.cb.onStatus('請先校正靶面', 'warn'); return; }
      const m = this.markers.find(q => Math.hypot(q.img[0] - p[0], q.img[1] - p[1]) < tol);
      if (m) { this.drag = { type: 'hit', m }; c.setPointerCapture(e.pointerId); return; }
      const mm = this.toBoard(...p);
      this.cb.onHit(p, mm, { manual: true });
    });
    c.addEventListener('pointermove', e => {
      if (!this.drag) return;
      const p = this._evtToImg(e);
      if (this.drag.type === 'calib') { this.calib[this.drag.i] = [p[0] / this.vw, p[1] / this.vh]; if (this.calib.length === 4) this._computeH(); }
      else this.drag.m.img = p;
    });
    const up = () => {
      if (!this.drag) return;
      if (this.drag.type === 'hit') this.cb.onHitMoved(this.drag.m.id, this.toBoard(...this.drag.m.img));
      this.drag = null;
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  }

  // ---- 自動偵測：背景差分 ----
  process(now) {
    const v = this.video;
    if (!this.calibrated || this.calibrating || !this.auto || v.readyState < 2) return;
    if (now - this.lastProc < 70) return;
    this.lastProc = now;
    const SW = 240, SH = Math.round(SW * this.vh / this.vw);
    if (this.small.width !== SW || this.small.height !== SH) { this.small.width = SW; this.small.height = SH; this.mask = null; this.ref = null; }
    if (!this.mask) this._buildMask(SW, SH);
    this.sctx.drawImage(v, 0, 0, SW, SH);
    const d = this.sctx.getImageData(0, 0, SW, SH).data;
    // 保留 RGB，以「最大色版差」比較（只看亮度時，黃色鏢身在米色區會偵測不到）
    const N = SW * SH, cur = new Uint8Array(N * 3);
    for (let i = 0, j = 0; i < N; i++, j += 4) { cur[i * 3] = d[j]; cur[i * 3 + 1] = d[j + 1]; cur[i * 3 + 2] = d[j + 2]; }
    if (!this.ref) {
      this.ref = cur; this.prev = cur; this.lastMotion = now;
      if (!this.markers.length) this.base = cur; // 空靶基準，用來辨識「拔鏢」
      return;
    }

    // 幀間動態
    let moving = 0;
    const T = this.diffThresh, mask = this.mask;
    for (let i = 0; i < N; i++) if (mask[i] && cdiff(cur, this.prev, i) > T) moving++;
    this.prev = cur;
    if (moving > 2) { this.lastMotion = now; this.evaluated = false; return; }
    if (this.evaluated || now - this.lastMotion < 380) return;
    this.evaluated = true;

    // 與參考背景比較
    const diff = new Uint8Array(N);
    let count = 0;
    for (let i = 0; i < N; i++) if (mask[i] && cdiff(cur, this.ref, i) > T) { diff[i] = 1; count++; }
    if (count < this.minPx) { this.ref = cur; return; }
    const prevRef = this.ref;
    this.ref = cur;

    // 是否回到空靶狀態（拔鏢）
    if (this.base && this.markers.length) {
      let dirty = 0;
      for (let i = 0; i < N; i++) if (mask[i] && cdiff(cur, this.base, i) > T) dirty++;
      if (dirty < this.minPx * 2) { this.markers = []; this.cb.onStatus('偵測到拔鏢，等待下一輪', 'info'); this.cb.onPulled?.(); return; }
    }
    if (count > this.maskCount * 0.12) {
      if (!this.markers.length) this.base = cur;
      this.cb.onStatus('畫面大幅變化（遮擋或鏡頭移動），已重設背景', 'info'); return;
    }

    const blob = largestBlob(diff, SW, SH);
    if (!blob || blob.length < this.minPx) return;
    // 變化區域回到空靶樣子 → 是飛鏢被拔走，不是新飛鏢
    if (this.base) {
      let toBase = 0, refToBase = 0;
      for (const p of blob) { toBase += cdiff(cur, this.base, p); refToBase += cdiff(prevRef, this.base, p); }
      if (toBase < refToBase * 0.45) { this.cb.onStatus('偵測到有飛鏢被拔除', 'info'); return; }
    }
    const [sx, sy] = tipOf(blob, SW, this.tipMode);
    const img = [(sx + 0.5) * this.vw / SW, (sy + 0.5) * this.vh / SH];
    const mm = this.toBoard(...img);
    this.cb.onHit(img, mm, { manual: false, blobPx: blob.length });
  }

  _buildMask(SW, SH) {
    const m = new Uint8Array(SW * SH); let n = 0;
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      const [bx, by] = this.toBoard((x + 0.5) * this.vw / SW, (y + 0.5) * this.vh / SH);
      if (Math.hypot(bx, by) < R.DBL_OUT + 22) { m[y * SW + x] = 1; n++; }
    }
    this.mask = m; this.maskCount = Math.max(1, n);
  }

  // ---- 繪製覆蓋層 ----
  draw() {
    const c = this.canvas, v = this.video;
    if (!v.videoWidth) return;
    if (c.width !== v.videoWidth || c.height !== v.videoHeight) { c.width = v.videoWidth; c.height = v.videoHeight; }
    const g = this.ctx; g.clearRect(0, 0, c.width, c.height);
    const s = this._pxScale();
    if (this.Hinv) {
      g.lineWidth = 1.5 * s;
      g.strokeStyle = this.calibrating ? 'rgba(255,200,0,.95)' : 'rgba(80,220,200,.55)';
      for (const r of [R.DBULL, R.BULL, R.TRP_IN, R.TRP_OUT, R.DBL_IN, R.DBL_OUT]) {
        g.beginPath();
        for (let k = 0; k <= 72; k++) { const [x, y] = this.toImage(...polar(r, k * 5)); k ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.stroke();
      }
      for (let i = 0; i < 20; i++) {
        const [x1, y1] = this.toImage(...polar(R.BULL, i * 18 - 9)), [x2, y2] = this.toImage(...polar(R.DBL_OUT, i * 18 - 9));
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      }
      if (this.calibrating) {
        g.fillStyle = 'rgba(255,200,0,.95)'; g.font = `${13 * s}px sans-serif`; g.textAlign = 'center';
        SECTORS.forEach((n, i) => { const [x, y] = this.toImage(...polar(186, i * 18)); g.fillText(n, x, y + 4 * s); });
      }
    }
    if (this.calibrating) {
      this.calib.forEach(([nx, ny], i) => {
        const x = nx * this.vw, y = ny * this.vh;
        g.fillStyle = '#ffcc00'; g.strokeStyle = '#000'; g.lineWidth = 2 * s;
        g.beginPath(); g.arc(x, y, 7 * s, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = '#000'; g.font = `bold ${10 * s}px sans-serif`; g.textAlign = 'center'; g.fillText(i + 1, x, y + 3.5 * s);
      });
    }
    for (const m of this.markers) {
      const [x, y] = m.img;
      g.strokeStyle = '#000'; g.lineWidth = 4 * s;
      g.beginPath(); g.arc(x, y, 8 * s, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = m.manual ? '#ffd54a' : '#ff4d6d'; g.lineWidth = 2.5 * s;
      g.beginPath(); g.arc(x, y, 8 * s, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(x - 12 * s, y); g.lineTo(x + 12 * s, y); g.moveTo(x, y - 12 * s); g.lineTo(x, y + 12 * s); g.stroke();
      g.font = `bold ${14 * s}px sans-serif`; g.textAlign = 'left';
      g.lineWidth = 3 * s; g.strokeStyle = '#000'; g.strokeText(m.label, x + 12 * s, y - 10 * s);
      g.fillStyle = '#fff'; g.fillText(m.label, x + 12 * s, y - 10 * s);
    }
  }
}

function cdiff(a, b, i) {
  const k = i * 3;
  return Math.max(Math.abs(a[k] - b[k]), Math.abs(a[k + 1] - b[k + 1]), Math.abs(a[k + 2] - b[k + 2]));
}

function largestBlob(diff, W, H) {
  const seen = new Uint8Array(diff.length);
  let best = null;
  const stack = [];
  for (let i = 0; i < diff.length; i++) {
    if (!diff[i] || seen[i]) continue;
    const comp = []; stack.push(i); seen[i] = 1;
    while (stack.length) {
      const p = stack.pop(); comp.push(p);
      const x = p % W, y = (p / W) | 0;
      // 8 鄰域 + 2 像素間隙容忍
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (diff[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    if (!best || comp.length > best.length) best = comp;
  }
  return best;
}

function tipOf(blob, W, mode) {
  const pts = blob.map(p => [p % W, (p / W) | 0]);
  if (mode === 'center') {
    let sx = 0, sy = 0; for (const [x, y] of pts) { sx += x; sy += y; }
    return [sx / pts.length, sy / pts.length];
  }
  const key = { top: p => p[1], bottom: p => -p[1], left: p => p[0], right: p => -p[0] }[mode] || (p => p[1]);
  const best = Math.min(...pts.map(key));
  const edge = pts.filter(p => key(p) <= best + 1);
  let sx = 0, sy = 0; for (const [x, y] of edge) { sx += x; sy += y; }
  return [sx / edge.length, sy / edge.length];
}
