// 姿勢偵測 (MediaPipe Pose Landmarker) 與投擲動作分析

const MP_VER = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
let visionMod = null;

async function loadPoseLandmarker(variant = 'lite') {
  if (!visionMod) visionMod = await import(`${MP_BASE}/vision_bundle.mjs`);
  const { FilesetResolver, PoseLandmarker } = visionMod;
  const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
  const url = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${variant}/float16/1/pose_landmarker_${variant}.task`;
  let lastErr;
  for (const delegate of ['GPU', 'CPU']) {
    try {
      const lm = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: url, delegate },
        runningMode: 'VIDEO', numPoses: 1,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      lm.__delegate = delegate;
      return lm;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

const IDX = {
  R: { sh: 12, el: 14, wr: 16, idx: 20, hip: 24 },
  L: { sh: 11, el: 13, wr: 15, idx: 19, hip: 23 },
  nose: 0,
};
const SKELETON = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [15, 19], [16, 20], [23, 25], [24, 26], [25, 27], [26, 28]];

// 形態指標定義
const FORM_METRICS = [
  { key: 'aimJitter', name: '瞄準時手腕晃動', unit: '%', d: 1, better: 'low', tip: '出手前 0.5 秒手腕位置的均方根晃動（相對前臂長）' },
  { key: 'cockAngle', name: '後拉最小手肘角', unit: '°', d: 0, tip: '後拉到最深時的手肘夾角' },
  { key: 'releaseElbow', name: '出手瞬間手肘角', unit: '°', d: 0, tip: '角速度最大（推定出手）時的手肘夾角' },
  { key: 'followAngle', name: '跟隨延伸角', unit: '°', d: 0, better: 'high', tip: '出手後 0.4 秒內手肘最大夾角，170° 以上代表手臂完整延伸' },
  { key: 'peakAngVel', name: '手肘峰值角速度', unit: '°/s', d: 0, tip: '手肘伸展最快的速度，反映出手力道' },
  { key: 'wristPeak', name: '手腕峰值速度', unit: '臂長/s', d: 2, tip: '以上臂長為單位的手腕線速度' },
  { key: 'releaseAngle', name: '前臂出手角', unit: '°', d: 1, tip: '出手瞬間前臂相對水平線的仰角（正值朝上）' },
  { key: 'releaseHeight', name: '出手高度（相對肩）', unit: '臂長', d: 2, tip: '出手時手腕高於肩膀多少個上臂長' },
  { key: 'elbowRise', name: '出手時手肘升降', unit: '%', d: 1, tip: '從後拉最深到出手，手肘垂直位移（上臂長 %，正值 = 上升）' },
  { key: 'elbowDisp', name: '手肘最大位移', unit: '%', d: 1, better: 'low', tip: '投擲過程手肘偏離支點的最大距離（上臂長 %）' },
  { key: 'shoulderDisp', name: '肩膀位移', unit: '%', d: 1, better: 'low', tip: '投擲過程肩膀移動距離（上臂長 %）' },
  { key: 'headDisp', name: '頭部位移', unit: '%', d: 1, better: 'low', tip: '投擲過程頭部移動距離（上臂長 %）' },
  { key: 'backswingMs', name: '後拉時間', unit: 'ms', d: 0, tip: '從靜止瞄準到後拉最深' },
  { key: 'accelMs', name: '加速時間', unit: 'ms', d: 0, tip: '從後拉最深到出手' },
  { key: 'rhythmMs', name: '整體節奏', unit: 'ms', d: 0, tip: '從開始後拉到出手的總時間' },
];

const P = (lm, i) => (lm && lm[i]) ? [lm[i].x, lm[i].y] : null;

class ThrowAnalyzer {
  constructor(opts = {}) {
    this.opts = { side: 'auto', velThresh: 320, ...opts };
    this.reset();
  }
  setOpts(o) { Object.assign(this.opts, o); if ('side' in o) this.reset(); }
  reset() {
    this.buf = []; this.state = 'idle'; this.pending = null; this.cooldownUntil = -Infinity;
    this.sideScore = { L: 0, R: 0 }; this.lockedSide = null; this.sm = null;
  }
  get side() {
    if (this.opts.side !== 'auto') return this.opts.side;
    if (this.lockedSide) return this.lockedSide;
    return this.sideScore.R >= this.sideScore.L ? 'R' : 'L';
  }

  // lm: 33 個點 {x,y,visibility}，座標為像素；t: 秒
  push(t, lm) {
    let live = { t, valid: false, side: this.side };
    if (!lm) { this.buf.push({ t, valid: false }); this._trim(t); return { live }; }

    if (this.opts.side === 'auto' && !this.lockedSide) {
      const v = s => ['sh', 'el', 'wr'].reduce((a, k) => a + (lm[IDX[s][k]].visibility ?? 1), 0);
      this.sideScore.L += v('L'); this.sideScore.R += v('R');
      if (this.sideScore.L + this.sideScore.R > 60) this.lockedSide = this.sideScore.R >= this.sideScore.L ? 'R' : 'L';
    }
    const S = IDX[this.side];
    const vis = Math.min(lm[S.sh].visibility ?? 1, lm[S.el].visibility ?? 1, lm[S.wr].visibility ?? 1);
    const raw = { sh: P(lm, S.sh), el: P(lm, S.el), wr: P(lm, S.wr), idx: P(lm, S.idx), nose: P(lm, IDX.nose), hip: P(lm, S.hip) };
    // 輕度平滑
    const a = 0.65;
    if (!this.sm || t - this.sm.t > 0.25) this.sm = { t, ...raw };
    else for (const k in raw) this.sm[k] = [a * raw[k][0] + (1 - a) * this.sm[k][0], a * raw[k][1] + (1 - a) * this.sm[k][1]];
    this.sm.t = t;
    const f = { t, valid: vis > 0.3, vis, sh: this.sm.sh, el: this.sm.el, wr: this.sm.wr, idx: this.sm.idx, nose: this.sm.nose, hip: this.sm.hip };
    f.angle = jointAngle(f.sh, f.el, f.wr);
    const prev = this._lastValid();
    f.angVel = prev && t > prev.t ? (f.angle - prev.angle) / (t - prev.t) : 0;
    this.buf.push(f);
    this._trim(t);

    live = { t, valid: f.valid, side: this.side, angle: f.angle, angVel: f.angVel, vis };
    live.phase = !f.valid ? '—' : f.angVel > 150 ? '出手' : f.angVel < -60 ? '後拉' : Math.abs(f.angVel) < 40 ? '瞄準' : '移動';

    let thrown = null;
    if (this.state === 'idle' && f.valid && t > this.cooldownUntil && f.angVel > this.opts.velThresh) {
      const recent = this.buf.filter(q => q.valid && q.t >= t - 1.0);
      const minA = Math.min(...recent.map(q => q.angle));
      if (minA < 135 && f.angle - minA > 15) { this.state = 'throwing'; this.pending = { tTrig: t }; live.phase = '出手'; }
    }
    if (this.state === 'throwing' && t >= this.pending.tTrig + 0.45) {
      thrown = this._finalize(this.pending.tTrig);
      this.state = 'idle'; this.pending = null; this.cooldownUntil = t + 0.5;
    }
    return { live, thrown };
  }

  _lastValid() { for (let i = this.buf.length - 1; i >= 0; i--) if (this.buf[i].valid) return this.buf[i]; return null; }
  _trim(t) { while (this.buf.length && this.buf[0].t < t - 4) this.buf.shift(); }

  _finalize(tTrig) {
    const F = this.buf.filter(q => q.valid && q.t >= tTrig - 1.8 && q.t <= tTrig + 0.5);
    if (F.length < 8) return null;
    const n = F.length;
    // 中央差分角速度
    const av = F.map((f, i) => {
      const a = F[Math.max(0, i - 1)], b = F[Math.min(n - 1, i + 1)];
      return b.t > a.t ? (b.angle - a.angle) / (b.t - a.t) : 0;
    });
    const range = (t0, t1) => F.map((f, i) => i).filter(i => F[i].t >= t0 && F[i].t <= t1);
    const argmax = (ids, fn) => ids.reduce((b, i) => (b < 0 || fn(i) > fn(b) ? i : b), -1);
    const argmin = (ids, fn) => ids.reduce((b, i) => (b < 0 || fn(i) < fn(b) ? i : b), -1);

    const iRel = argmax(range(tTrig - 0.25, tTrig + 0.3), i => av[i]);
    if (iRel < 0) return null;
    const tRel = F[iRel].t;
    const iMin = argmin(range(tRel - 0.8, tRel), i => F[i].angle);
    if (iMin < 0 || iMin >= iRel) return null;
    // 由後拉最深處往回找：第一個「穩定且明顯高於最小角」的幀視為後拉起點
    let iStart = iMin;
    while (iStart > 0 && F[iStart - 1].t > tRel - 1.6) {
      const j = iStart - 1;
      iStart = j;
      if (Math.abs(av[j]) < 35 && F[j].angle - F[iMin].angle > 8) break;
    }

    const upper = median(F.map(f => dist(f.sh, f.el)));
    const fore = median(F.map(f => dist(f.el, f.wr)));
    if (!(upper > 5) || !(fore > 5)) return null;

    const tStart = F[iStart].t, tMin = F[iMin].t;
    const aim = range(tStart - 0.5, tStart);
    let aimJitter = NaN;
    if (aim.length >= 4) {
      const mx = aim.reduce((s, i) => s + F[i].wr[0], 0) / aim.length, my = aim.reduce((s, i) => s + F[i].wr[1], 0) / aim.length;
      aimJitter = Math.sqrt(aim.reduce((s, i) => s + (F[i].wr[0] - mx) ** 2 + (F[i].wr[1] - my) ** 2, 0) / aim.length) / fore * 100;
    }
    const follow = range(tRel, tRel + 0.4);
    const followAngle = Math.max(...follow.map(i => F[i].angle));
    const through = range(tMin, tRel + 0.3);
    const elRef = F[iMin].el;
    const elbowDisp = Math.max(...through.map(i => dist(F[i].el, elRef))) / upper * 100;
    const elbowRise = (elRef[1] - F[iRel].el[1]) / upper * 100;
    const whole = range(tStart, tRel + 0.3);
    const shoulderDisp = Math.max(...whole.map(i => dist(F[i].sh, F[iStart].sh))) / upper * 100;
    const headDisp = Math.max(...whole.map(i => dist(F[i].nose, F[iStart].nose))) / upper * 100;

    const ia = Math.max(0, iRel - 1), ib = Math.min(n - 1, iRel + 1);
    const dir = Math.sign(F[ib].wr[0] - F[ia].wr[0]) || Math.sign(F[iRel].wr[0] - F[iMin].wr[0]) || 1;
    const rel = F[iRel];
    const releaseAngle = Math.atan2(-(rel.wr[1] - rel.el[1]), (rel.wr[0] - rel.el[0]) * dir) * 180 / Math.PI;
    const releaseHeight = (rel.sh[1] - rel.wr[1]) / upper;
    let wristPeak = 0;
    for (const i of range(tMin, tRel + 0.1)) {
      if (i === 0) continue;
      const dt = F[i].t - F[i - 1].t;
      if (dt > 0) wristPeak = Math.max(wristPeak, dist(F[i].wr, F[i - 1].wr) / dt / upper);
    }
    const fps = (n - 1) / (F[n - 1].t - F[0].t);
    const curve = range(tRel - 1.0, tRel + 0.5).map(i => ({ dt: +(F[i].t - tRel).toFixed(4), angle: +F[i].angle.toFixed(1), elbowY: +((elRef[1] - F[i].el[1]) / upper * 100).toFixed(1) }));
    const angleRange = Math.max(...F.map(f => f.angle)) - F[iMin].angle;
    if (angleRange < 25) return null;

    return {
      tRel, side: this.side, dir, fps: +fps.toFixed(1),
      aimJitter, cockAngle: F[iMin].angle, releaseElbow: rel.angle, followAngle,
      peakAngVel: av[iRel], wristPeak, releaseAngle, releaseHeight,
      elbowRise, elbowDisp, shoulderDisp, headDisp,
      backswingMs: (tMin - tStart) * 1000, accelMs: (tRel - tMin) * 1000, rhythmMs: (tRel - tStart) * 1000,
      curve,
    };
  }
}
