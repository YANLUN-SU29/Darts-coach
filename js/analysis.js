// 統計分析與建議產生

function groupStats(throws, target) {
  const hits = throws.filter(t => t.hit);
  const [tx, ty] = targetPoint(target);
  const pts = hits.map(t => [t.hit.x, t.hit.y]);
  const n = pts.length;
  const out = { n, target, tx, ty };
  if (!n) return out;
  out.mpi = [mean(pts.map(p => p[0])), mean(pts.map(p => p[1]))];
  out.offsetX = out.mpi[0] - tx; out.offsetUp = -(out.mpi[1] - ty);
  out.offsetDist = Math.hypot(out.offsetX, out.offsetUp);
  out.sdX = sd(pts.map(p => p[0])); out.sdY = sd(pts.map(p => p[1]));
  out.radialErr = mean(pts.map(p => Math.hypot(p[0] - tx, p[1] - ty)));
  out.cep50 = median(pts.map(p => Math.hypot(p[0] - out.mpi[0], p[1] - out.mpi[1])));
  out.ellipse = covEllipse(pts);
  const scores = hits.map(t => t.hit.score);
  out.avgScore = mean(scores);
  out.ppd3 = out.avgScore * 3;
  out.targetRate = hits.filter(t => isTargetHit(target, t.hit.label)).length / n;
  out.trebleRate = hits.filter(t => t.hit.label[0] === 'T').length / n;
  out.doubleRate = hits.filter(t => t.hit.label[0] === 'D' || t.hit.label === 'BULL').length / n;
  out.missRate = hits.filter(t => t.hit.label === 'MISS').length / n;
  const freq = {};
  for (const t of hits) freq[t.hit.label] = (freq[t.hit.label] || 0) + 1;
  out.topLabels = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return out;
}

function formStats(throws) {
  const forms = throws.filter(t => t.form).map(t => t.form);
  const rows = FORM_METRICS.map(m => {
    const vals = forms.map(f => f[m.key]);
    const mu = mean(vals), s = sd(vals);
    return { ...m, n: vals.filter(Number.isFinite).length, mean: mu, sd: s, cv: Math.abs(mu) > 1e-6 ? Math.abs(s / mu) * 100 : NaN, latest: vals[vals.length - 1], values: vals };
  });
  return { n: forms.length, rows };
}

// 形態指標 vs 落點誤差 相關性
function correlations(throws, target) {
  const paired = throws.filter(t => t.form && t.hit && t.hit.label !== 'MISS');
  const [tx, ty] = targetPoint(target);
  const ex = paired.map(t => t.hit.x - tx), ey = paired.map(t => -(t.hit.y - ty));
  const er = paired.map(t => Math.hypot(t.hit.x - tx, t.hit.y - ty));
  const res = [];
  for (const m of FORM_METRICS) {
    const xs = paired.map(t => t.form[m.key]);
    res.push({ metric: m, up: pearson(xs, ey), right: pearson(xs, ex), radial: pearson(xs, er) });
  }
  return { n: paired.length, rows: res, paired, ex, ey, er };
}

function insights(throws, target) {
  const tips = [];
  const fs = formStats(throws);
  const get = k => fs.rows.find(r => r.key === k);
  const add = (level, title, body) => tips.push({ level, title, body });

  if (fs.n >= 3) {
    const e = get('elbowDisp');
    if (e.mean > 25) add('warn', '手肘支點不穩', `投擲過程手肘平均偏移 ${fmt(e.mean, 0)}% 上臂長。理想上上臂像鐘擺的支點，後拉與加速時盡量只動前臂，出手後手肘才自然上抬。`);
    const r = get('elbowRise');
    if (r.mean < -6) add('warn', '出手時手肘下沉', `從後拉到出手，手肘平均下降 ${fmt(-r.mean, 0)}% 上臂長，常導致飛鏢落點偏低、拋物線不穩。`);
    const fa = get('followAngle');
    if (fa.mean < 155) add('warn', '跟隨動作不足', `出手後手臂最大延伸角平均只有 ${fmt(fa.mean, 0)}°。出手後讓手臂完整伸直、指向目標，有助於穩定方向。`);
    else if (fa.n >= 3) add('ok', '跟隨延伸完整', `跟隨延伸角平均 ${fmt(fa.mean, 0)}°，手臂有完整伸展。`);
    const s = get('shoulderDisp');
    if (s.mean > 12) add('warn', '身體 / 肩膀晃動', `投擲時肩膀平均移動 ${fmt(s.mean, 0)}% 上臂長。保持重心在前腳、身體不前傾或後仰。`);
    const h = get('headDisp');
    if (h.mean > 12) add('warn', '頭部移動', `頭部平均移動 ${fmt(h.mean, 0)}% 上臂長，視線基準改變會影響瞄準，出手時盡量保持頭部不動。`);
    const aj = get('aimJitter');
    if (aj.mean > 4) add('warn', '瞄準時手腕晃動', `瞄準階段手腕晃動 ${fmt(aj.mean, 1)}%（前臂長）。可以嘗試放鬆握力、先穩定 0.5 秒再後拉。`);
    const ra = get('releaseAngle');
    if (ra.sd > 6) add('warn', '出手角度不一致', `前臂出手角標準差 ${fmt(ra.sd, 1)}°，出手點不固定是垂直散佈的主因之一。`);
    const am = get('accelMs');
    if (am.cv > 18) add('warn', '加速節奏不穩', `加速時間變異係數 ${fmt(am.cv, 0)}%（平均 ${fmt(am.mean, 0)} ms）。可用固定口令（例如「拉—投」）建立節奏。`);
    const ca = get('cockAngle');
    if (ca.sd > 8) add('warn', '後拉幅度不一致', `後拉最小角標準差 ${fmt(ca.sd, 1)}°，後拉深度不同會改變出手力道。`);
    const pv = get('peakAngVel');
    if (pv.cv > 15) add('info', '出手力道差異大', `手肘峰值角速度變異係數 ${fmt(pv.cv, 0)}%，力道不一致會讓落點上下跳動。`);
  }

  const g = groupStats(throws, target);
  if (g.n >= 5) {
    if (g.sdY > g.sdX * 1.3) add('info', '垂直散佈大於水平', `垂直標準差 ${fmt(g.sdY, 0)} mm ＞ 水平 ${fmt(g.sdX, 0)} mm。垂直誤差通常來自出手時機、出手角與力道，建議檢查「出手角度」與「峰值角速度」的一致性。`);
    else if (g.sdX > g.sdY * 1.3) add('info', '水平散佈大於垂直', `水平標準差 ${fmt(g.sdX, 0)} mm ＞ 垂直 ${fmt(g.sdY, 0)} mm。水平誤差多與站姿、肩—肘—目標是否成一直線、手肘外翻或手腕扭轉有關。`);
    if (g.offsetDist > 15) add('info', `平均落點${directionText(g.offsetX, g.offsetUp)}`, `落點群中心距離目標 ${fmt(g.offsetDist, 0)} mm（右 ${fmt(g.offsetX, 0)}、上 ${fmt(g.offsetUp, 0)}）。散佈集中但偏移時，可微調瞄準點或站位，而非改變動作。`);
    if (g.cep50 < 20) add('ok', '集團性良好', `一半的飛鏢落在群中心 ${fmt(g.cep50, 0)} mm 以內。`);
  }

  const c = correlations(throws, target);
  if (c.n >= 6) {
    const strong = [];
    for (const r of c.rows) {
      for (const [axis, v, pos, neg] of [['up', r.up, '上', '下'], ['right', r.right, '右', '左']]) {
        if (Number.isFinite(v.r) && Math.abs(v.r) >= 0.5) strong.push({ m: r.metric, r: v.r, dirTxt: v.r > 0 ? pos : neg, axis });
      }
    }
    strong.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    for (const s of strong.slice(0, 3)) add('link', `「${s.m.name}」影響落點`, `相關係數 r = ${s.r.toFixed(2)}：${s.m.name}越大，落點越偏${s.dirTxt}。把這個指標穩定下來，${s.axis === 'up' ? '垂直' : '水平'}散佈可望縮小。`);
  }

  if (!tips.length) add('info', '資料收集中', '至少需要 3 次姿勢資料或 5 支落點，才會產生個人化建議。');
  return tips;
}
