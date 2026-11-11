// 幾何與統計工具

// ---------- 單應性 (Homography) ----------
// 由 4 組對應點求 3x3 單應矩陣，src -> dst
function solveHomography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = gaussSolve(A, b);
  if (!h) return null;
  return [...h, 1];
}

function gaussSolve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

function invertH(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    A, -(b * i - c * h), b * f - c * e,
    B, a * i - c * g, -(a * f - c * d),
    C, -(a * h - b * g), a * e - b * d,
  ];
  return inv.map(v => v / det);
}

// ---------- 向量 / 角度 ----------
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// 以 b 為頂點的夾角 (度)，180 = 打直
function jointAngle(a, b, c) {
  const v1x = a[0] - b[0], v1y = a[1] - b[1];
  const v2x = c[0] - b[0], v2y = c[1] - b[1];
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (n < 1e-9) return NaN;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n));
  return Math.acos(cos) * 180 / Math.PI;
}

// ---------- 統計 ----------
const finite = arr => arr.filter(v => v != null && Number.isFinite(v));
function mean(arr) { const a = finite(arr); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN; }
function sd(arr) {
  const a = finite(arr); if (a.length < 2) return NaN;
  const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}
function median(arr) {
  const a = finite(arr).sort((x, y) => x - y); if (!a.length) return NaN;
  const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function minOf(arr) { const a = finite(arr); return a.length ? Math.min(...a) : NaN; }
function maxOf(arr) { const a = finite(arr); return a.length ? Math.max(...a) : NaN; }

function pearson(xs, ys) {
  const pairs = [];
  for (let i = 0; i < xs.length; i++) if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pairs.push([xs[i], ys[i]]);
  const n = pairs.length; if (n < 3) return { r: NaN, n };
  const mx = mean(pairs.map(p => p[0])), my = mean(pairs.map(p => p[1]));
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  if (sxx < 1e-12 || syy < 1e-12) return { r: NaN, n };
  return { r: sxy / Math.sqrt(sxx * syy), n };
}

// 2D 共變異數 → 橢圓 (半軸長度為 1σ，角度為弧度)
function covEllipse(pts) {
  if (pts.length < 3) return null;
  const mx = mean(pts.map(p => p[0])), my = mean(pts.map(p => p[1]));
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const n = pts.length - 1; sxx /= n; syy /= n; sxy /= n;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { cx: mx, cy: my, a: Math.sqrt(Math.max(l1, 0)), b: Math.sqrt(Math.max(l2, 0)), angle };
}

function fmt(v, d = 1, unit = '') {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(d) + unit;
}
