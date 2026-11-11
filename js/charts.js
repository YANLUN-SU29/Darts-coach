// 輕量 Canvas 圖表
function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 400, h = canvas.clientHeight || 220;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function niceTicks(lo, hi, count = 5) {
  const span = hi - lo || 1;
  const step0 = span / count, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= step0) || mag * 10;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

// opts: { series:[{points:[[x,y]], color, width, alpha, dots}], xLabel, yLabel, xRange, yRange, vlines:[{x,color,label}], empty }
function lineChart(canvas, opts) {
  const { g, w, h } = setup(canvas);
  const pad = { l: 46, r: 12, t: opts.yLabel ? 24 : 12, b: 32 };
  const all = opts.series.flatMap(s => s.points).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  g.font = '12px system-ui, sans-serif';
  if (!all.length) {
    g.fillStyle = css('--muted'); g.textAlign = 'center'; g.fillText(opts.empty || '尚無資料', w / 2, h / 2); return;
  }
  let [x0, x1] = opts.xRange || [Math.min(...all.map(p => p[0])), Math.max(...all.map(p => p[0]))];
  let [y0, y1] = opts.yRange || [Math.min(...all.map(p => p[1])), Math.max(...all.map(p => p[1]))];
  if (x1 - x0 < 1e-9) { x0 -= 1; x1 += 1; }
  if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
  if (!opts.yRange) { const m = (y1 - y0) * 0.08; y0 -= m; y1 += m; }
  const X = x => pad.l + (x - x0) / (x1 - x0) * (w - pad.l - pad.r);
  const Y = y => h - pad.b - (y - y0) / (y1 - y0) * (h - pad.t - pad.b);

  g.strokeStyle = css('--grid'); g.fillStyle = css('--muted'); g.lineWidth = 1;
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const v of niceTicks(y0, y1)) { g.beginPath(); g.moveTo(pad.l, Y(v)); g.lineTo(w - pad.r, Y(v)); g.stroke(); g.fillText(+v.toFixed(2), pad.l - 6, Y(v)); }
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (const v of niceTicks(x0, x1, 6)) g.fillText(+v.toFixed(2), X(v), h - pad.b + 6);
  if (opts.xLabel) { g.textAlign = 'right'; g.fillText(opts.xLabel, w - pad.r, h - 14); }
  if (opts.yLabel) { g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(opts.yLabel, 6, 2); }

  for (const vl of opts.vlines || []) {
    g.strokeStyle = vl.color || css('--muted'); g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(X(vl.x), pad.t); g.lineTo(X(vl.x), h - pad.b); g.stroke(); g.setLineDash([]);
    if (vl.label) { g.fillStyle = vl.color || css('--muted'); g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(vl.label, X(vl.x) + 4, pad.t); }
  }
  for (const s of opts.series) {
    const pts = s.points.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    g.globalAlpha = s.alpha ?? 1; g.strokeStyle = s.color; g.fillStyle = s.color; g.lineWidth = s.width || 1.5;
    if (!s.dotsOnly) { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke(); }
    if (s.dots || s.dotsOnly) for (const p of pts) { g.beginPath(); g.arc(X(p[0]), Y(p[1]), s.r || 3, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
  }
  if (opts.fit) {
    const { a, b } = opts.fit;
    g.strokeStyle = css('--accent'); g.lineWidth = 1.5; g.setLineDash([6, 4]);
    g.beginPath(); g.moveTo(X(x0), Y(a + b * x0)); g.lineTo(X(x1), Y(a + b * x1)); g.stroke(); g.setLineDash([]);
  }
  return { X, Y };
}

function linFit(xs, ys) {
  const p = xs.map((x, i) => [x, ys[i]]).filter(q => Number.isFinite(q[0]) && Number.isFinite(q[1]));
  if (p.length < 3) return null;
  const mx = p.reduce((s, q) => s + q[0], 0) / p.length, my = p.reduce((s, q) => s + q[1], 0) / p.length;
  let sxy = 0, sxx = 0; for (const [x, y] of p) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
  if (sxx < 1e-12) return null;
  const b = sxy / sxx; return { a: my - b * mx, b };
}
