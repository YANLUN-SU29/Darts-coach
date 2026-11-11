// DartLab 主程式：鏡頭、偵測、資料、分析畫面

const $ = id => document.getElementById(id);
const STORE = 'dartlab.v1';
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// 每個指標「標準差」的穩定 / 不穩門檻
const SD_BANDS = {
  aimJitter: [1, 3], cockAngle: [5, 12], releaseElbow: [6, 14], followAngle: [5, 12], peakAngVel: [80, 220],
  wristPeak: [0.5, 1.5], releaseAngle: [3, 8], releaseHeight: [0.08, 0.2], elbowRise: [4, 10], elbowDisp: [5, 12],
  shoulderDisp: [3, 8], headDisp: [3, 8], backswingMs: [40, 110], accelMs: [15, 40], rhythmMs: [50, 130],
};
const METRIC = Object.fromEntries(FORM_METRICS.map(m => [m.key, m]));

const DEFAULTS = {
  side: 'auto', model: 'lite', velThresh: 320, slowmo: 1, tip: 'top', diff: 28, darts: 3,
  poseRes: '1280x720', poseFps: 60, boardRes: '1280x720', boardFps: 30,
  target: 'T20', scope: 'session', trendMetric: 'releaseAngle', corrMetric: 'releaseAngle', corrAxis: 'up',
};
const state = { throws: [], sessionId: newId(), settings: { ...DEFAULTS }, calib: {}, selectedId: null };
const clips = new Map();

// ---------- 儲存 ----------
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!d) return;
    state.throws = Array.isArray(d.throws) ? d.throws : [];
    state.settings = { ...DEFAULTS, ...(d.settings || {}) };
    state.calib = d.calib || {};
    if (d.sessionId) state.sessionId = d.sessionId;
  } catch (e) { console.warn('讀取紀錄失敗', e); }
}
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ throws: state.throws, settings: state.settings, calib: state.calib, sessionId: state.sessionId })); }
    catch (e) { console.warn('儲存失敗', e); }
  }, 250);
}

// ---------- 小工具 ----------
let toastTimer = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
function chip(id, text, cls) { const c = $(id); c.textContent = text; c.className = 'chip' + (cls ? ' ' + cls : ''); }
function flash(id, text) {
  const f = $(id); f.innerHTML = text ? `<span class="tag">${text}</span>` : '';
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  setTimeout(() => { f.classList.remove('go'); setTimeout(() => (f.innerHTML = ''), 500); }, 350);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- 攝影機 ----------
async function listDevices() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    for (const [selId, fallbackIdx] of [['poseDevice', 0], ['boardDevice', 1]]) {
      const sel = $(selId), cur = sel.value;
      sel.innerHTML = '<option value="">預設攝影機</option>' + devs.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || '攝影機 ' + (i + 1))}</option>`).join('');
      if (cur && devs.some(d => d.deviceId === cur)) sel.value = cur;
      else if (!cur && devs[fallbackIdx]?.deviceId && devs[fallbackIdx].label) sel.value = devs[fallbackIdx].deviceId;
    }
  } catch (e) { /* 忽略 */ }
}
// 解析度 / FPS：用 ideal，鏡頭做不到時會自動取最接近的值而不是失敗
function camConstraints(res, fps) {
  const [w, h] = String(res).split('x').map(Number);
  return { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: +fps } };
}
async function openCamera(video, deviceId, res, fps) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('此瀏覽器不支援攝影機（請用 Chrome / Edge，並透過 http://localhost 開啟）');
  // 由高到低逐步放寬條件：部分 USB 攝影機不支援指定的解析度 / FPS，或裝置 ID 已失效
  const dev = deviceId ? { deviceId: { exact: deviceId } } : {};
  const tries = [
    { ...dev, ...camConstraints(res, fps) },
    { ...dev },
    true,
  ];
  let stream = null, lastErr;
  for (const v of tries) {
    try { stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false }); break; }
    catch (e) {
      lastErr = e;
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') break; // 權限被拒，重試無用
    }
  }
  if (!stream) throw lastErr;
  video.removeAttribute('src'); video.srcObject = stream; video.loop = false;
  await video.play();
  return stream;
}
// 顯示鏡頭實際輸出的解析度 / FPS 與硬體上限
function updateCamInfo(which) {
  const isPose = which === 'pose';
  const src = isPose ? pose : boardSrc, v = src.video;
  const name = isPose ? '姿勢鏡頭' : '靶面鏡頭', chipId = isPose ? 'chipPose' : 'chipBoard';
  const info = $(isPose ? 'poseCamInfo' : 'boardCamInfo');
  const tr = src.stream?.getVideoTracks?.()[0];
  if (!tr) {
    if (v.videoWidth) { chip(chipId, `${name}：${v.videoWidth}×${v.videoHeight}（影片）`, 'on'); info.textContent = `影片 ${v.videoWidth}×${v.videoHeight}`; info.className = 'caminfo'; }
    else { info.textContent = ''; }
    return;
  }
  const s = tr.getSettings ? tr.getSettings() : {};
  const c = tr.getCapabilities ? tr.getCapabilities() : {};
  const w = s.width || v.videoWidth, h = s.height || v.videoHeight, fps = Math.round(s.frameRate || 0);
  const [wantW] = String(state.settings[which + 'Res']).split('x').map(Number);
  const wantFps = +state.settings[which + 'Fps'];
  chip(chipId, `${name}：${w}×${h}${fps ? ' · ' + fps + 'fps' : ''}`, 'on');
  let txt = `實際輸出 ${w}×${h}${fps ? ` @ ${fps}fps` : ''}`;
  if (c.width?.max) txt += `　｜　鏡頭上限 ${c.width.max}×${c.height?.max ?? '?'}${c.frameRate?.max ? `、${Math.round(c.frameRate.max)}fps` : ''}`;
  const short = (fps && fps < wantFps - 2) || (w && w < wantW);
  if (short) txt += '　｜　未達設定值：USB 2.0 鏡頭在高解析度時常只有 30fps 以下，想要更高 FPS 請降低解析度';
  info.textContent = txt;
  info.className = 'caminfo' + (short ? ' warn' : '');
}

// 執行中直接套用新的解析度 / FPS（不必重開鏡頭）
async function applyCamSettings(which) {
  const src = which === 'pose' ? pose : boardSrc;
  const tr = src.stream?.getVideoTracks?.()[0];
  if (!tr) return; // 尚未啟動：下次啟動時套用
  try { await tr.applyConstraints(camConstraints(state.settings[which + 'Res'], state.settings[which + 'Fps'])); }
  catch (e) { console.warn(e); toast('此鏡頭不支援這個設定，已保留原設定'); }
  setTimeout(() => updateCamInfo(which), 400);
}

function cameraErrorText(e) {
  switch (e?.name) {
    case 'NotAllowedError': case 'SecurityError':
      return ['瀏覽器拒絕了攝影機權限', '點網址列左側的鎖頭 / 攝影機圖示，把「攝影機」改成「允許」後重新整理頁面。也請確認 Windows 設定 → 隱私權與安全性 → 相機 中，已允許桌面應用程式使用相機。'];
    case 'NotReadableError': case 'TrackStartError': case 'AbortError':
      return ['攝影機被其他程式占用', '請關閉正在使用鏡頭的程式（相機 App、LINE、Teams、Zoom、OBS、其他瀏覽器分頁）後再按一次「啟動鏡頭」。'];
    case 'NotFoundError': case 'OverconstrainedError':
      return ['找不到攝影機', '請確認鏡頭已插好，或在下拉選單改選「預設攝影機」再試一次。'];
    default:
      return ['無法開啟攝影機', (e?.message || String(e)) + '　建議用 Chrome 或 Edge 開啟。'];
  }
}
function showCamError(stage, e) {
  const [title, detail] = cameraErrorText(e);
  const ph = stage.querySelector('.placeholder');
  ph.dataset.orig ||= ph.innerHTML;
  ph.innerHTML = `<p style="color:var(--red)">${esc(title)}</p><small>${esc(detail)}</small><small class="muted" style="margin-top:6px">錯誤代碼：${esc(e?.name || '未知')}</small>`;
  toast(title);
}
function stopStream(src) {
  src.stream?.getTracks().forEach(t => t.stop());
  src.stream = null;
  if (src.video.src) { URL.revokeObjectURL(src.video.src); }
  src.video.pause(); src.video.srcObject = null; src.video.removeAttribute('src'); src.video.load();
}
function whenReady(video) {
  return new Promise(res => { if (video.videoWidth) res(); else video.addEventListener('loadedmetadata', () => res(), { once: true }); });
}
function fitStage(stage, video) {
  if (video.videoWidth) stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  const ph = stage.querySelector('.placeholder'); // 成功開啟後恢復原本的提示文字
  if (ph.dataset.orig) { ph.innerHTML = ph.dataset.orig; delete ph.dataset.orig; }
}

// ---------- 姿勢鏡頭 ----------
const pose = {
  video: $('poseVideo'), canvas: $('poseOverlay'), stage: $('poseStage'),
  stream: null, file: false, running: false, lm: null, lmLoading: null,
  analyzer: new ThrowAnalyzer(), lastTs: 0, lastTA: -Infinity, frames: [], lastBmpT: -Infinity,
  fpsTimes: [], lastLm: null, live: null,
};

async function ensureModel() {
  if (pose.lm) return pose.lm;
  if (!pose.lmLoading) {
    chip('chipModel', '姿勢模型：載入中…', 'warn');
    pose.lmLoading = loadPoseLandmarker(state.settings.model).then(lm => {
      pose.lm = lm; chip('chipModel', `姿勢模型：${state.settings.model} (${lm.__delegate})`, 'on'); return lm;
    }).catch(e => {
      console.error(e); chip('chipModel', '姿勢模型：載入失敗', 'err');
      toast('姿勢模型載入失敗，請確認網路連線'); throw e;
    }).finally(() => { pose.lmLoading = null; });
  }
  return pose.lmLoading;
}

async function startPose(fileUrl) {
  stopPose();
  try {
    if (fileUrl) {
      pose.file = true;
      pose.video.srcObject = null; pose.video.src = fileUrl; pose.video.loop = true;
      pose.video.playbackRate = +$('poseRate').value;
      await pose.video.play();
      $('poseFilebar').hidden = false;
    } else {
      pose.file = false; $('poseFilebar').hidden = true;
      pose.stream = await openCamera(pose.video, $('poseDevice').value, state.settings.poseRes, state.settings.poseFps);
      listDevices();
    }
  } catch (e) { console.error(e); showCamError(pose.stage, e); chip('chipPose', '姿勢鏡頭：錯誤', 'err'); return; }
  await whenReady(pose.video);
  fitStage(pose.stage, pose.video);
  pose.stage.classList.add('active');
  pose.running = true; pose.analyzer.reset(); pose.lastTA = -Infinity;
  $('poseStart').textContent = '停止';
  updateCamInfo('pose');
  schedulePose();
  ensureModel().catch(() => {});
}
function stopPose() {
  pose.running = false;
  stopStream(pose);
  clearFrames();
  pose.stage.classList.remove('active');
  pose.canvas.getContext('2d').clearRect(0, 0, pose.canvas.width, pose.canvas.height);
  $('poseStart').textContent = '啟動鏡頭'; $('poseFilebar').hidden = true;
  chip('chipPose', '姿勢鏡頭：未啟動'); $('poseCamInfo').textContent = '';
}
function clearFrames() {
  for (const f of pose.frames) if (!f.kept) { f.dead = true; f.bmp?.close(); }
  pose.frames = []; pose.lastBmpT = -Infinity;
}
function schedulePose() {
  if (!pose.running) return;
  const v = pose.video;
  if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback((now, meta) => { onPoseFrame(now, meta); schedulePose(); });
  else requestAnimationFrame(now => { onPoseFrame(now, null); schedulePose(); });
}

function onPoseFrame(now, meta) {
  const v = pose.video;
  if (!pose.running || v.readyState < 2 || !v.videoWidth) return;
  const slow = +state.settings.slowmo || 1;
  const t = pose.file ? (meta?.mediaTime ?? v.currentTime) / slow : now / 1000;
  if (t < pose.lastTA - 0.02) { pose.analyzer.reset(); clearFrames(); }
  if (t === pose.lastTA) return;
  pose.lastTA = t;

  let lmPx = null;
  if (pose.lm) {
    const ts = Math.max(pose.lastTs + 1, performance.now()); pose.lastTs = ts;
    try {
      const res = pose.lm.detectForVideo(v, ts);
      const l = res.landmarks?.[0];
      if (l) lmPx = l.map(p => ({ x: p.x * v.videoWidth, y: p.y * v.videoHeight, visibility: p.visibility ?? 1 }));
    } catch (e) { console.warn(e); }
  }
  pose.lastLm = lmPx;

  // 回放用影格緩衝（最高 120 fps、寬 360）
  if (t - pose.lastBmpT >= 1 / 120) {
    pose.lastBmpT = t;
    const entry = { t, lm: lmPx, bmp: null, vw: v.videoWidth, vh: v.videoHeight };
    pose.frames.push(entry);
    const W = 360, H = Math.round(W * v.videoHeight / v.videoWidth);
    createImageBitmap(v, { resizeWidth: W, resizeHeight: H, resizeQuality: 'low' })
      .then(b => { if (entry.dead) b.close(); else entry.bmp = b; }).catch(() => {});
  }
  while (pose.frames.length && pose.frames[0].t < t - 2.6) {
    const f = pose.frames.shift(); if (!f.kept) { f.dead = true; f.bmp?.close(); }
  }

  const { live, thrown } = pose.analyzer.push(t, lmPx);
  pose.live = live;
  pose.fpsTimes.push(now); while (pose.fpsTimes.length && pose.fpsTimes[0] < now - 1000) pose.fpsTimes.shift();
  updateLive(live);
  drawPose(lmPx, live);
  if (thrown) onThrowDetected(thrown);
  if (pose.file) {
    $('poseSeek').value = v.duration ? Math.round(v.currentTime / v.duration * 1000) : 0;
    $('poseTime').textContent = v.currentTime.toFixed(1) + 's';
  }
}

function updateLive(live) {
  $('lvSide').textContent = pose.lm ? (live.side === 'R' ? '右手' : '左手') + (state.settings.side === 'auto' && !pose.analyzer.lockedSide ? '?' : '') : '—';
  $('lvAngle').textContent = live.valid ? fmt(live.angle, 0, '°') : '—';
  $('lvVel').textContent = live.valid ? fmt(live.angVel, 0, '°/s') : '—';
  $('lvPhase').textContent = pose.lm ? (live.phase || '—') : '載入中';
  $('lvFps').textContent = pose.fpsTimes.length;
  $('lvBar').style.width = live.valid ? Math.max(0, Math.min(100, live.angle / 180 * 100)) + '%' : '0';
}

function drawSkeleton(g, lm, side, scale, s) {
  if (!lm) return;
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(160,180,200,.7)'; g.lineWidth = 3 * s;
  for (const [a, b] of SKELETON) {
    if ((lm[a].visibility ?? 1) < 0.3 || (lm[b].visibility ?? 1) < 0.3) continue;
    g.beginPath(); g.moveTo(lm[a].x * scale, lm[a].y * scale); g.lineTo(lm[b].x * scale, lm[b].y * scale); g.stroke();
  }
  const S = IDX[side];
  const pts = [S.sh, S.el, S.wr, S.idx].map(i => [lm[i].x * scale, lm[i].y * scale]);
  g.strokeStyle = '#f2b233'; g.lineWidth = 5 * s;
  g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p))); g.stroke();
  g.fillStyle = '#2bc4a6';
  for (const p of pts.slice(0, 3)) { g.beginPath(); g.arc(p[0], p[1], 6 * s, 0, Math.PI * 2); g.fill(); }
  const ang = jointAngle(pts[0], pts[1], pts[2]);
  if (Number.isFinite(ang)) {
    g.font = `bold ${18 * s}px system-ui`; g.lineWidth = 4 * s; g.strokeStyle = '#000'; g.fillStyle = '#fff';
    const tx = pts[1][0] + 12 * s, ty = pts[1][1] - 12 * s;
    g.strokeText(ang.toFixed(0) + '°', tx, ty); g.fillText(ang.toFixed(0) + '°', tx, ty);
  }
}

function drawPose(lm, live) {
  const c = pose.canvas, v = pose.video;
  if (c.width !== v.videoWidth || c.height !== v.videoHeight) { c.width = v.videoWidth; c.height = v.videoHeight; }
  const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
  const s = c.width / Math.max(1, c.getBoundingClientRect().width);
  drawSkeleton(g, lm, live.side, 1, s);
  if (!lm && pose.lm) {
    g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, 0, c.width, 34 * s);
    g.fillStyle = '#ffcc66'; g.font = `${15 * s}px system-ui`; g.fillText('未偵測到人體，請調整鏡頭位置', 12 * s, 22 * s);
  }
}

function onThrowDetected(th) {
  const clipFrames = pose.frames.filter(f => f.t >= th.tRel - 1.3 && f.t <= th.tRel + 0.45);
  clipFrames.forEach(f => (f.kept = true));
  const { tRel, ...form } = th;
  for (const k in form) if (typeof form[k] === 'number') form[k] = +form[k].toFixed(3);
  const rec = attach('form', form, 2500);
  clips.set(rec.id, { frames: clipFrames, tRel, side: th.side });
  while (clips.size > 6) {
    const [k, c] = clips.entries().next().value;
    clips.delete(k);
    for (const f of c.frames) { f.kept = false; if (!pose.frames.includes(f)) { f.dead = true; f.bmp?.close(); } }
  }
  flash('poseFlash', `第 ${rec.no} 投`);
  renderAll();
}

// ---------- 配對 動作 ↔ 落點 ----------
function attach(kind, data, windowMs) {
  const now = Date.now(), other = kind === 'form' ? 'hit' : 'form';
  const cands = state.throws.filter(r => r.session === state.sessionId && !r[kind] && r[other] && now - r.ts < windowMs);
  // 落點：配給最早未配對的動作（依投擲順序）；動作：配給最近的落點
  let rec = kind === 'hit' ? cands[0] : cands[cands.length - 1];
  if (rec) rec[kind] = data;
  else {
    const no = state.throws.reduce((m, r) => Math.max(m, r.no || 0), 0) + 1;
    rec = { id: newId(), no, ts: now, session: state.sessionId, form: null, hit: null };
    rec[kind] = data;
    state.throws.push(rec);
  }
  save();
  return rec;
}

function makeHit(mm, manual, src) {
  const s = scoreAt(mm[0], mm[1]);
  return { x: +mm[0].toFixed(1), y: +mm[1].toFixed(1), label: s.label, score: s.score, manual: !!manual, src };
}

// ---------- 靶面鏡頭 ----------
const boardSrc = { video: $('boardVideo'), stage: $('boardStage'), stream: null, running: false, key: '' };
const board = new BoardCam($('boardVideo'), $('boardOverlay'), {
  onHit(img, mm, meta) {
    const hit = makeHit(mm, meta.manual, 'cam');
    const rec = attach('hit', hit, meta.manual ? 20000 : 3500);
    board.markers.push({ id: rec.id, img, label: hit.label, manual: meta.manual });
    flash('boardFlash', `${hit.label}  ${hit.score} 分`);
    const full = board.markers.length >= +state.settings.darts;
    boardStatus(full ? `本輪已投 ${board.markers.length} 鏢，拔鏢後按「拔鏢 / 重設背景」（R）` : `第 ${board.markers.length} 鏢：${hit.label}（${meta.manual ? '手動' : '自動'}）· 紅圈可拖曳修正`, full ? 'warn' : 'ok');
    renderAll();
  },
  onHitMoved(id, mm) {
    const rec = state.throws.find(r => r.id === id);
    if (!rec) return;
    rec.hit = { ...makeHit(mm, true, 'cam') };
    const m = board.markers.find(q => q.id === id); if (m) { m.label = rec.hit.label; m.manual = true; }
    save(); renderAll(); boardStatus(`已修正為 ${rec.hit.label}`, 'ok');
  },
  onStatus: (t, l) => boardStatus(t, l),
  onCalibChange() { state.calib[boardSrc.key] = board.calib; save(); updateBoardButtons(); },
});
function boardStatus(text, level) { const s = $('boardStatus'); s.textContent = text; s.className = 'status ' + (level || ''); }
function updateBoardButtons() {
  $('btnCalib').disabled = !boardSrc.running;
  $('btnPull').disabled = !boardSrc.running || !board.calibrated;
  $('btnCalib').textContent = board.calibrating ? '重新放置' : board.calibrated ? '重新校正' : '校正靶面';
  $('btnCalibDone').hidden = !board.calibrating;
}

async function startBoard(fileUrl) {
  stopBoard();
  const v = boardSrc.video;
  try {
    if (fileUrl) { v.srcObject = null; v.src = fileUrl; v.loop = false; await v.play(); boardSrc.key = 'file'; }
    else { boardSrc.stream = await openCamera(v, $('boardDevice').value, state.settings.boardRes, state.settings.boardFps); boardSrc.key = $('boardDevice').value || 'default'; listDevices(); }
  } catch (e) { console.error(e); showCamError(boardSrc.stage, e); chip('chipBoard', '靶面鏡頭：錯誤', 'err'); return; }
  await whenReady(v);
  fitStage(boardSrc.stage, v);
  boardSrc.stage.classList.add('active');
  boardSrc.running = true;
  board.setCalibration(state.calib[boardSrc.key]);
  board.clearMarkers();
  $('boardStart').textContent = '停止';
  updateCamInfo('board');
  boardStatus(board.calibrated ? '已載入先前的校正，可以開始投擲（如鏡頭移動過請重新校正）' : '請先按「校正靶面」', board.calibrated ? 'ok' : 'warn');
  updateBoardButtons();
  boardLoop();
}
function stopBoard() {
  boardSrc.running = false;
  stopStream(boardSrc);
  boardSrc.stage.classList.remove('active');
  $('boardStart').textContent = '啟動鏡頭';
  chip('chipBoard', '靶面鏡頭：未啟動'); $('boardCamInfo').textContent = '';
  board.calibrating = false;
  updateBoardButtons();
}
let boardTimer = 0;
function boardLoop() {
  // 偵測用計時器（視窗被遮住時仍持續），繪製用 rAF
  clearInterval(boardTimer);
  boardTimer = setInterval(() => { if (boardSrc.running) board.process(performance.now()); else clearInterval(boardTimer); }, 40);
  const draw = () => { if (!boardSrc.running) return; board.draw(); requestAnimationFrame(draw); };
  requestAnimationFrame(draw);
}
function pullDarts() {
  board.clearMarkers(); board.resetReference();
  boardStatus('已重設背景，等待下一輪', 'info');
}

// ---------- 渲染 ----------
function scopeThrows() {
  const all = state.throws;
  switch (state.settings.scope) {
    case 'last30': return all.slice(-30);
    case 'last90': return all.slice(-90);
    case 'all': return all;
    default: return all.filter(t => t.session === state.sessionId);
  }
}

let renderQueued = false;
function renderAll() {
  if (renderQueued) return;
  renderQueued = true;
  Promise.resolve().then(() => { renderQueued = false; renderList(); renderLatest(); renderAnalysis(); });
}

function renderList() {
  const rows = state.throws.filter(t => t.session === state.sessionId).slice().reverse().slice(0, 300);
  $('listCount').textContent = rows.length ? `本次 ${rows.length} 投` : '';
  $('throwRows').innerHTML = rows.map(r => {
    const f = r.form || {};
    return `<tr data-id="${r.id}" class="${r.id === state.selectedId ? 'sel' : ''}">
      <td>${r.no}</td><td>${r.hit ? esc(r.hit.label) : '<span class="muted">—</span>'}</td><td>${r.hit ? r.hit.score : ''}</td>
      <td>${fmt(f.releaseAngle, 1, '°')}</td><td>${fmt(f.followAngle, 0, '°')}</td><td>${fmt(f.elbowDisp, 0, '%')}</td>
      <td>${clips.has(r.id) ? `<button class="ghost act" data-act="replay" title="慢動作回放">▶</button>` : ''}<button class="ghost act" data-act="del" title="刪除">✕</button></td></tr>`;
  }).join('') || '<tr><td colspan="7" class="muted">開始投擲後會自動記錄</td></tr>';
}

function renderLatest() {
  const sess = state.throws.filter(t => t.session === state.sessionId);
  const r = sess[sess.length - 1];
  if (!r) { $('latestBody').innerHTML = '<p class="muted">還沒有投擲紀錄。</p>'; $('latestTime').textContent = ''; return; }
  $('latestTime').textContent = `#${r.no} · ${new Date(r.ts).toLocaleTimeString()}`;
  const fs = formStats(sess.slice(0, -1));
  const cell = (key) => {
    const m = METRIC[key], v = r.form?.[key];
    const row = fs.rows.find(q => q.key === key);
    let badge = '';
    if (Number.isFinite(v) && row && row.n >= 3 && Number.isFinite(row.sd) && row.sd > 0) {
      const z = (v - row.mean) / row.sd;
      const d = v - row.mean;
      badge = `<span class="badge ${Math.abs(z) < 1 ? 'good' : Math.abs(z) < 2 ? 'mid' : 'bad'}">${d >= 0 ? '+' : ''}${d.toFixed(m.d)}</span>`;
    }
    return `<div><span>${m.name}</span><b>${fmt(v, m.d)}</b><small class="muted"> ${m.unit}</small>${badge}</div>`;
  };
  const score = r.hit ? `<b>${esc(r.hit.label)}</b><span>${r.hit.score} 分</span>` : `<b>—</b><span>無落點</span>`;
  $('latestBody').innerHTML = `<div class="big-score">${score}</div>
    <div class="mini-grid">${r.form ? ['releaseAngle', 'followAngle', 'elbowDisp', 'accelMs', 'peakAngVel', 'cockAngle'].map(cell).join('') : '<p class="muted">此投沒有姿勢資料</p>'}</div>`;
}

function renderAnalysis() {
  const T = scopeThrows(), target = state.settings.target;
  const g = groupStats(T, target), fs = formStats(T);

  // 一致性分數
  const parts = fs.rows.filter(r => r.n >= 3 && Number.isFinite(r.sd) && SD_BANDS[r.key]).map(r => {
    const [good, bad] = SD_BANDS[r.key];
    // 穩定門檻內 = 1；到不穩門檻 = 0.5；兩倍不穩門檻 = 0
    if (r.sd <= good) return 1;
    if (r.sd <= bad) return 1 - 0.5 * (r.sd - good) / (bad - good);
    return Math.max(0, 0.5 * (1 - (r.sd - bad) / bad));
  });
  const consistency = parts.length ? mean(parts) * 100 : NaN;
  const cards = [
    ['投擲數', T.length, `動作 ${fs.n} · 落點 ${g.n}`],
    ['平均每鏢', fmt(g.avgScore, 1), '分'],
    ['3 鏢平均', fmt(g.ppd3, 1), '分'],
    ['目標命中率', g.n ? fmt(g.targetRate * 100, 0) : '—', `% (${target})`],
    ['集團半徑 CEP50', fmt(g.cep50, 0), 'mm'],
    ['平均偏移', fmt(g.offsetDist, 0), g.n ? 'mm ' + directionText(g.offsetX, g.offsetUp) : ''],
    ['動作一致性', fmt(consistency, 0), '/ 100'],
  ];
  $('summaryCards').innerHTML = cards.map(([k, v, u]) => `<div class="card"><span>${k}</span><b>${v}</b><small>${esc(u)}</small></div>`).join('');

  renderBoardPlot(T, g);

  const kv = [
    ['落點數', g.n || 0], ['平均偏移', g.n ? `${fmt(g.offsetDist, 0)} mm ${directionText(g.offsetX, g.offsetUp)}` : '—'],
    ['水平標準差', fmt(g.sdX, 1, ' mm')], ['垂直標準差', fmt(g.sdY, 1, ' mm')],
    ['CEP50（一半落點半徑）', fmt(g.cep50, 1, ' mm')], ['與目標平均距離', fmt(g.radialErr, 1, ' mm')],
    ['三倍區比例', g.n ? fmt(g.trebleRate * 100, 0, '%') : '—'], ['雙倍區 / Bull 比例', g.n ? fmt(g.doubleRate * 100, 0, '%') : '—'],
    ['目標命中率', g.n ? fmt(g.targetRate * 100, 0, '%') : '—'], ['出界率', g.n ? fmt(g.missRate * 100, 0, '%') : '—'],
  ];
  $('groupStats').innerHTML = kv.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  const maxC = g.topLabels?.[0]?.[1] || 1;
  $('topLabels').innerHTML = (g.topLabels || []).map(([l, c]) => `<div class="row"><b>${esc(l)}</b><i style="width:${c / maxC * 100}%"></i><span class="muted">${c}</span></div>`).join('') || '<p class="muted small">尚無落點資料</p>';

  // 指標表
  $('metricRows').innerHTML = fs.rows.map(r => {
    const [good, bad] = SD_BANDS[r.key] || [0, 1];
    let rating = '<span class="muted">—</span>';
    if (r.n >= 3 && Number.isFinite(r.sd)) {
      const [cls, txt, col] = r.sd <= good ? ['good', '穩定', 'var(--green)'] : r.sd <= bad ? ['mid', '普通', 'var(--accent)'] : ['bad', '不穩', 'var(--red)'];
      const w = Math.max(6, (1 - Math.min(1, r.sd / (bad * 1.5))) * 50);
      rating = `<span class="cv"><i style="width:${w}px;background:${col}"></i><span class="badge ${cls}">${txt}</span></span>`;
    }
    const mm = r.n ? `${fmt(Math.min(...r.values.filter(Number.isFinite)), r.d)} – ${fmt(Math.max(...r.values.filter(Number.isFinite)), r.d)}` : '—';
    return `<tr><td>${r.name}</td><td>${fmt(r.mean, r.d)} <small class="muted">${r.unit}</small></td><td>±${fmt(r.sd, r.d)}</td><td>${rating}</td><td>${fmt(r.latest, r.d)}</td><td>${mm}</td><td>${r.tip}</td></tr>`;
  }).join('');

  renderCurves(T);
  renderTrend(T);
  renderCorr(T, target);

  $('insights').innerHTML = insights(T, target).map(t => `<div class="tip ${t.level}"><b>${esc(t.title)}</b><p>${esc(t.body)}</p></div>`).join('');
}

function renderBoardPlot(T, g) {
  const svg = $('boardPlot');
  const layer = drawBoardBase(svg);
  const [tx, ty] = targetPoint(state.settings.target);
  const hits = T.filter(t => t.hit);
  let k = 1; // 標記大小隨縮放比例調整
  if ($('zoomPlot').checked && hits.length) {
    const xs = [tx, ...hits.map(t => t.hit.x)], ys = [ty, ...hits.map(t => t.hit.y)];
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const half = Math.max(45, (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))) / 2 + 20);
    svg.setAttribute('viewBox', `${cx - half} ${cy - half} ${half * 2} ${half * 2}`);
    k = half * 2 / 410;
  }
  el('circle', { cx: tx, cy: ty, r: 9, fill: 'none', stroke: '#f2b233', 'stroke-width': 2 * Math.max(k, 0.4), 'stroke-dasharray': `${3 * k} ${2 * k}` }, layer);
  if (g.ellipse) {
    const e = g.ellipse, deg = e.angle * 180 / Math.PI;
    for (const [k, op] of [[2, 0.35], [1, 0.8]]) {
      el('ellipse', { cx: e.cx, cy: e.cy, rx: Math.max(1, e.a * k), ry: Math.max(1, e.b * k), transform: `rotate(${deg} ${e.cx} ${e.cy})`, fill: k === 1 ? 'rgba(43,196,166,.12)' : 'none', stroke: '#2bc4a6', 'stroke-width': 1.6 * k, opacity: op }, layer);
    }
  }
  hits.forEach((t, i) => {
    const recent = (i + 1) / hits.length;
    const sel = t.id === state.selectedId;
    const c = el('circle', { cx: t.hit.x, cy: t.hit.y, r: Math.max((sel ? 6 : 4.2) * k, sel ? 2.6 : 1.8), fill: sel ? '#ffffff' : t.hit.manual ? '#ffd54a' : '#ff5d6c', stroke: '#000', 'stroke-width': Math.max(1.2 * k, 0.4), opacity: 0.35 + 0.65 * recent, 'data-id': t.id }, layer);
    const title = el('title', {}, c); title.textContent = `#${t.no} ${t.hit.label} (${t.hit.score} 分)`;
  });
  if (g.mpi) {
    const [mx, my] = g.mpi;
    const c = Math.max(10 * k, 4), cross = `M${mx - c},${my} H${mx + c} M${mx},${my - c} V${my + c}`;
    el('path', { d: cross, stroke: '#fff', 'stroke-width': Math.max(3.5 * k, 1.2) }, layer);
    el('path', { d: cross, stroke: '#2bc4a6', 'stroke-width': Math.max(2 * k, 0.7) }, layer);
  }
  $('boardLegend').innerHTML = `<span><i style="background:#ff5d6c"></i>自動偵測</span><span><i style="background:#ffd54a"></i>手動 / 修正</span><span><i style="background:transparent;border:2px dashed var(--accent)"></i>目標 ${state.settings.target}</span><span><i style="background:#2bc4a6"></i>平均落點與散佈</span>`;
}

function renderCurves(T) {
  const forms = T.filter(t => t.form?.curve?.length);
  const series = [];
  forms.forEach((t, i) => {
    const last = i === forms.length - 1;
    series.push({ points: t.form.curve.map(p => [p.dt * 1000, p.angle]), color: last ? '#5aa8ff' : '#8a97a6', width: last ? 2.5 : 1, alpha: last ? 1 : 0.35 });
  });
  if (forms.length >= 2) {
    const avg = [];
    for (let x = -1000; x <= 500; x += 20) {
      const vals = forms.map(t => interp(t.form.curve, x / 1000)).filter(Number.isFinite);
      if (vals.length >= 2) avg.push([x, mean(vals)]);
    }
    series.push({ points: avg, color: '#f2b233', width: 3 });
  }
  lineChart($('chartCurves'), { series, xLabel: '相對出手時間 (ms)', yLabel: '手肘角 (°)', xRange: [-1000, 500], vlines: [{ x: 0, label: '出手', color: '#f2b233' }], empty: '需要姿勢鏡頭偵測到投擲' });
}
function interp(curve, dt) {
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1], b = curve[i];
    if (a.dt <= dt && b.dt >= dt) return b.dt === a.dt ? a.angle : a.angle + (b.angle - a.angle) * (dt - a.dt) / (b.dt - a.dt);
  }
  return NaN;
}

function renderTrend(T) {
  const key = state.settings.trendMetric, m = METRIC[key];
  const pts = T.filter(t => t.form && Number.isFinite(t.form[key])).map(t => [t.no, t.form[key]]);
  const series = [{ points: pts, color: '#5aa8ff', width: 1.5, dots: true }];
  if (pts.length >= 3) {
    const vals = pts.map(p => p[1]), mu = mean(vals);
    const s = Math.sqrt(vals.reduce((a, v) => a + (v - mu) ** 2, 0) / (vals.length - 1));
    const x0 = pts[0][0], x1 = pts[pts.length - 1][0];
    series.push({ points: [[x0, mu], [x1, mu]], color: '#f2b233', width: 1.5 });
    series.push({ points: [[x0, mu + s], [x1, mu + s]], color: '#f2b233', width: 1, alpha: 0.4 });
    series.push({ points: [[x0, mu - s], [x1, mu - s]], color: '#f2b233', width: 1, alpha: 0.4 });
  }
  lineChart($('chartTrend'), { series, xLabel: '投擲編號', yLabel: `${m.name} (${m.unit})`, empty: '尚無資料' });
}

function renderCorr(T, target) {
  const c = correlations(T, target);
  const key = state.settings.corrMetric, axis = state.settings.corrAxis, m = METRIC[key];
  const xs = c.paired.map(t => t.form[key]);
  const ys = axis === 'up' ? c.ey : axis === 'right' ? c.ex : c.er;
  const pts = xs.map((x, i) => [x, ys[i]]);
  const fit = linFit(xs, ys);
  const yLabel = axis === 'up' ? '垂直誤差 mm（上 +）' : axis === 'right' ? '水平誤差 mm（右 +）' : '與目標距離 mm';
  lineChart($('chartCorr'), { series: [{ points: pts, color: '#b37cff', dotsOnly: true, r: 4 }], xLabel: `${m.name} (${m.unit})`, yLabel, fit, empty: '需要同時有動作與落點的投擲（至少 3 投）' });
  const { r, n } = pearson(xs, ys);
  const strength = !Number.isFinite(r) ? '' : Math.abs(r) >= 0.7 ? '強相關' : Math.abs(r) >= 0.4 ? '中度相關' : Math.abs(r) >= 0.2 ? '弱相關' : '幾乎無關';
  $('corrNote').textContent = Number.isFinite(r) ? `r = ${r.toFixed(2)}（${strength}，n = ${n}）。${n < 10 ? '樣本少於 10 投，結論僅供參考。' : ''}` : `配對資料 ${n} 筆，至少需要 3 筆。`;
  const cell = v => {
    if (!Number.isFinite(v.r)) return '<td class="muted">—</td>';
    const a = Math.abs(v.r), col = a >= 0.5 ? (v.r > 0 ? '#ff8a5b' : '#5aa8ff') : a >= 0.3 ? '#c3ccd6' : 'var(--muted)';
    return `<td style="color:${col};font-weight:${a >= 0.5 ? 700 : 400}">${v.r >= 0 ? '+' : ''}${v.r.toFixed(2)}</td>`;
  };
  $('corrRows').innerHTML = c.n >= 3 ? c.rows.map(r => `<tr><td>${r.metric.name}</td>${cell(r.up)}${cell(r.right)}${cell(r.radial)}</tr>`).join('') : `<tr><td colspan="4" class="muted">配對資料 ${c.n} 筆，至少需要 3 筆</td></tr>`;
}

// ---------- 回放 ----------
const replay = { clip: null, rec: null, i: 0, playing: false, pt: 0, last: 0 };
function openReplay(id) {
  const clip = clips.get(id), rec = state.throws.find(r => r.id === id);
  if (!clip || !rec) { toast('此投的影像已不在記憶體中（只保留最近 6 投）'); return; }
  const frames = clip.frames.filter(f => f.bmp);
  if (!frames.length) { toast('沒有可回放的影格'); return; }
  replay.clip = { ...clip, frames }; replay.rec = rec; replay.i = frames.findIndex(f => f.t >= clip.tRel); if (replay.i < 0) replay.i = 0;
  $('replayTitle').textContent = `第 ${rec.no} 投 動作回放${rec.hit ? ' · ' + rec.hit.label : ''}`;
  $('replaySeek').max = frames.length - 1;
  $('replayDlg').showModal();
  drawReplay();
}
function drawReplay() {
  const { clip, rec } = replay; if (!clip) return;
  const f = clip.frames[replay.i]; if (!f?.bmp) return;
  const c = $('replayCanvas');
  if (c.width !== f.bmp.width) { c.width = f.bmp.width; c.height = f.bmp.height; }
  const g = c.getContext('2d');
  g.drawImage(f.bmp, 0, 0);
  drawSkeleton(g, f.lm, clip.side, f.bmp.width / f.vw, f.bmp.width / 900);
  const dt = (f.t - clip.tRel) * 1000;
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, c.width, 16);
  g.fillStyle = dt >= 0 ? '#f2b233' : '#fff'; g.font = '10px system-ui';
  g.fillText(`${dt >= 0 ? '+' : ''}${dt.toFixed(0)} ms ${Math.abs(dt) < 20 ? '◀ 出手' : ''}`, 6, 12);
  $('replaySeek').value = replay.i;
  $('replayInfo').textContent = `${replay.i + 1} / ${clip.frames.length}`;
  const curve = rec.form?.curve || [];
  lineChart($('replayChart'), { series: [{ points: curve.map(p => [p.dt * 1000, p.angle]), color: '#5aa8ff', width: 2 }], xLabel: 'ms', yLabel: '手肘角 °', xRange: [-1000, 500], vlines: [{ x: 0, color: '#f2b233', label: '出手' }, { x: dt, color: '#ffffff' }] });
}
function replayTick(now) {
  if (!replay.playing || !replay.clip) return;
  const fr = replay.clip.frames;
  replay.pt += (now - replay.last) / 1000 * +$('replayRate').value; replay.last = now;
  if (replay.pt > fr[fr.length - 1].t) replay.pt = fr[0].t;
  let i = fr.findIndex(f => f.t > replay.pt) - 1; if (i < 0) i = fr.length - 1;
  if (i !== replay.i) { replay.i = i; drawReplay(); }
  requestAnimationFrame(replayTick);
}

// ---------- 匯出 / 匯入 ----------
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportCsv() {
  const keys = FORM_METRICS.map(m => m.key);
  const head = ['no', 'time', 'session', 'label', 'score', 'x_mm', 'y_mm', 'manual', ...keys];
  const lines = [head.join(',')];
  for (const r of scopeThrows()) {
    lines.push([r.no, new Date(r.ts).toISOString(), r.session, r.hit?.label ?? '', r.hit?.score ?? '', r.hit?.x ?? '', r.hit?.y ?? '', r.hit ? (r.hit.manual ? 1 : 0) : '',
      ...keys.map(k => (Number.isFinite(r.form?.[k]) ? r.form[k] : ''))].join(','));
  }
  download(`dartlab_${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + lines.join('\n'), 'text/csv');
}

// ---------- 事件 ----------
function bind() {
  $('poseStart').onclick = () => (pose.running ? stopPose() : startPose());
  $('boardStart').onclick = () => (boardSrc.running ? stopBoard() : startBoard());
  $('poseFile').onchange = e => { const f = e.target.files[0]; if (f) startPose(URL.createObjectURL(f)); e.target.value = ''; };
  $('boardFile').onchange = e => { const f = e.target.files[0]; if (f) startBoard(URL.createObjectURL(f)); e.target.value = ''; };
  $('posePlay').onclick = () => { const v = pose.video; if (v.paused) { v.play(); $('posePlay').textContent = '暫停'; } else { v.pause(); $('posePlay').textContent = '播放'; } };
  $('poseRate').onchange = e => (pose.video.playbackRate = +e.target.value);
  $('poseSeek').oninput = e => { const v = pose.video; if (v.duration) v.currentTime = e.target.value / 1000 * v.duration; };

  $('btnCalib').onclick = () => { board.startCalibration(); updateBoardButtons(); };
  $('btnCalibDone').onclick = () => { board.finishCalibration(); updateBoardButtons(); };
  $('btnPull').onclick = pullDarts;
  $('autoDetect').onchange = e => { board.auto = e.target.checked; if (board.auto) board.resetReference(); };
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select, textarea') || e.ctrlKey || e.metaKey) return;
    if (e.key === 'r' || e.key === 'R') { if (boardSrc.running) pullDarts(); }
  });

  $('throwRows').onclick = e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const id = tr.dataset.id, act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'del') { deleteThrow(id); return; }
    if (act === 'replay') { openReplay(id); return; }
    state.selectedId = state.selectedId === id ? null : id; renderAll();
  };
  $('btnUndo').onclick = () => { const sess = state.throws.filter(t => t.session === state.sessionId); if (sess.length) deleteThrow(sess[sess.length - 1].id); };

  $('btnNewSession').onclick = () => {
    state.sessionId = newId(); state.selectedId = null; board.clearMarkers(); board.resetReference();
    save(); renderAll(); toast('已開始新的練習回合（歷史紀錄仍保留）');
  };

  // 分析區控制
  $('target').innerHTML = targetOptions().map(o => `<option value="${o.v}">${o.t}</option>`).join('');
  const metricOpts = FORM_METRICS.map(m => `<option value="${m.key}">${m.name}</option>`).join('');
  $('trendMetric').innerHTML = metricOpts; $('corrMetric').innerHTML = metricOpts;
  for (const [id, key] of [['target', 'target'], ['scope', 'scope'], ['trendMetric', 'trendMetric'], ['corrMetric', 'corrMetric'], ['corrAxis', 'corrAxis']]) {
    $(id).value = state.settings[key];
    $(id).onchange = e => { state.settings[key] = e.target.value; save(); renderAll(); };
  }
  $('manualMark').onchange = e => $('boardPlot').classList.toggle('manual', e.target.checked);
  $('zoomPlot').onchange = () => renderAll();
  $('boardPlot').addEventListener('click', e => {
    const hitDot = e.target.closest('[data-id]');
    if (!$('manualMark').checked) { if (hitDot) { state.selectedId = hitDot.dataset.id; renderAll(); } return; }
    const svg = $('boardPlot'), pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    const hit = makeHit([p.x, p.y], true, 'plot');
    const rec = attach('hit', hit, 20000);
    toast(`#${rec.no} 記錄 ${hit.label}（${hit.score} 分）`);
    renderAll();
  });

  $('btnExportCsv').onclick = exportCsv;
  $('btnExportJson').onclick = () => download(`dartlab_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'DartLab', version: 1, exportedAt: new Date().toISOString(), throws: scopeThrows() }, null, 1), 'application/json');
  $('importFile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      const have = new Set(state.throws.map(t => t.id));
      const add = (d.throws || []).filter(t => t && t.id && !have.has(t.id));
      state.throws.push(...add); state.throws.sort((a, b) => a.ts - b.ts);
      save(); renderAll(); toast(`已匯入 ${add.length} 筆`);
    } catch (err) { toast('匯入失敗：檔案格式不正確'); }
  };

  // 對話框
  document.querySelectorAll('[data-close]').forEach(b => (b.onclick = () => b.closest('dialog').close()));
  $('btnHelp').onclick = () => $('helpDlg').showModal();
  $('btnSettings').onclick = () => $('settingsDlg').showModal();
  $('replayDlg').addEventListener('close', () => { replay.playing = false; $('replayPlay').textContent = '播放'; });
  $('replaySeek').oninput = e => { replay.i = +e.target.value; replay.playing = false; $('replayPlay').textContent = '播放'; drawReplay(); };
  $('replayPlay').onclick = () => {
    replay.playing = !replay.playing; $('replayPlay').textContent = replay.playing ? '暫停' : '播放';
    if (replay.playing) { replay.pt = replay.clip.frames[replay.i].t; replay.last = performance.now(); requestAnimationFrame(replayTick); }
  };

  // 設定
  const S = state.settings;
  const setup = (id, key, apply, out) => {
    const inp = $(id); inp.value = S[key];
    const sync = () => { if (out) $(out).textContent = inp.value; };
    sync();
    inp.oninput = () => { S[key] = inp.type === 'range' ? +inp.value : inp.value; sync(); apply?.(); save(); };
  };
  setup('setSide', 'side', () => pose.analyzer.setOpts({ side: S.side }));
  setup('setModel', 'model', () => { pose.lm?.close?.(); pose.lm = null; if (pose.running) ensureModel().catch(() => {}); else chip('chipModel', '姿勢模型：未載入'); });
  setup('setVel', 'velThresh', () => pose.analyzer.setOpts({ velThresh: S.velThresh }), 'setVelOut');
  setup('setSlowmo', 'slowmo', () => { pose.analyzer.reset(); clearFrames(); pose.lastTA = -Infinity; });
  setup('setTip', 'tip', () => (board.tipMode = S.tip));
  setup('setDiff', 'diff', () => (board.diffThresh = S.diff), 'setDiffOut');
  setup('setDarts', 'darts');
  $('btnClearAll').onclick = () => {
    if (!confirm('確定要永久刪除全部投擲紀錄？此動作無法復原。')) return;
    state.throws = []; clips.clear(); board.clearMarkers(); save(); renderAll(); toast('已清除全部紀錄');
  };

  window.addEventListener('resize', () => renderAll());

  // 鏡頭解析度 / FPS
  for (const which of ['pose', 'board']) {
    for (const k of ['Res', 'Fps']) {
      const sel = $(which + k), key = which + k;
      sel.value = String(state.settings[key]);
      if (!sel.value) sel.selectedIndex = 0;
      sel.onchange = () => { state.settings[key] = k === 'Fps' ? +sel.value : sel.value; save(); applyCamSettings(which); };
    }
  }
  // 畫面尺寸改變時（換解析度）更新版面；靶面需用新尺寸重算校正
  pose.video.addEventListener('resize', () => { if (pose.running) { fitStage(pose.stage, pose.video); updateCamInfo('pose'); } });
  boardSrc.video.addEventListener('resize', () => {
    if (!boardSrc.running) return;
    fitStage(boardSrc.stage, boardSrc.video); board._computeH(); updateCamInfo('board');
    if (board.calibrated) boardStatus('解析度已變更；若格線沒有對齊靶面請重新校正', 'warn');
  });
  navigator.mediaDevices?.addEventListener?.('devicechange', listDevices);
}

function deleteThrow(id) {
  state.throws = state.throws.filter(t => t.id !== id);
  board.markers = board.markers.filter(m => m.id !== id);
  const c = clips.get(id);
  if (c) { for (const f of c.frames) { f.kept = false; if (!pose.frames.includes(f)) f.bmp?.close(); } clips.delete(id); }
  if (state.selectedId === id) state.selectedId = null;
  save(); renderAll();
}

// ---------- 啟動 ----------
load();
pose.analyzer.setOpts({ side: state.settings.side, velThresh: state.settings.velThresh });
board.tipMode = state.settings.tip; board.diffThresh = state.settings.diff;
bind();
listDevices();
renderAll();
if (!window.isSecureContext) toast('目前的網址不被允許使用攝影機，請改用 start.bat 開啟（http://localhost）');

// 測試 / 除錯用
window.__dartlab = { state, pose, board, attach, onThrowDetected, renderAll, ThrowAnalyzer };
