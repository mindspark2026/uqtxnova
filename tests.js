/* =========================================================
   UQTxNova — tests.js
   TEST section: track tests & scores, upload question-paper
   images (with OCR), record / upload voice notes and manage a
   manual mistake analysis per test.

   Data model (Storage key 'tests', synced like every other key):
     { id, name, date:'YYYY-MM-DD', subject, chapter, maxMarks, marks,
       description, taskId, createdAt, updatedAt,
       images:[{ id, name, size, type, addedAt, ocrText, ocrStatus }],
       voices:[{ id, name, size, type, duration, addedAt }],
       mistakes:[{ id, question, attempted, correct, type, explanation,
                   learned, resolved, createdAt, resolvedAt }] }

   Binary media (images, thumbnails, audio) lives in IndexedDB via the
   existing AttachmentDB — same approach the Notes attachments use — so
   localStorage / Firestore only ever hold small JSON.
   ========================================================= */

const Tests = (function(){
  'use strict';

  /* ---------------- constants ---------------- */
  const SUBJECTS = ['Physics', 'Chemistry', 'Maths', 'General'];
  const SUBJECT_COLORS = { Physics:'#FBBF24', Chemistry:'#60A5FA', Maths:'#A78BFA', General:'#34D399' };
  const MISTAKE_TYPES = [
    'Conceptual Error', 'Calculation Error', 'Silly Mistake', 'Formula Error',
    'Time Management', 'Question Misunderstanding', 'Other'
  ];
  const TYPE_COLORS = {
    'Conceptual Error':'#F87171', 'Calculation Error':'#FBBF24', 'Silly Mistake':'#F472B6',
    'Formula Error':'#A78BFA', 'Time Management':'#38BDF8', 'Question Misunderstanding':'#FB923C', 'Other':'#94A3B8'
  };
  const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp'];
  const MAX_FILE = 25 * 1024 * 1024;        // per image / audio file
  const OCR_TEXT_CAP = 6000;                // keeps the synced 'tests' document comfortably small
  const SYNC_WARN_BYTES = 850 * 1024;       // Firestore documents max out at 1 MiB
  const IMG_FULL_MAX = 2400;                // keep enough resolution for OCR
  const IMG_THUMB_MAX = 360;
  const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

  /* ---------------- tiny helpers ---------------- */
  const esc = s => Utils.escapeHtml(s);
  const $ = id => document.getElementById(id);

  const ICONS = {
    plus:'<path d="M12 5v14M5 12h14"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
    filter:'<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/>',
    trash:'<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    book:'<path d="M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z"/>',
    image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
    mic:'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v4M8 22h8"/>',
    upload:'<path d="M12 16V4m0 0L8 8m4-4l4 4M4 17v3h16v-3"/>',
    check:'<path d="M20 6L9 17l-5-5"/>',
    chevron:'<path d="M6 9l6 6 6-6"/>',
    left:'<path d="M15 18l-6-6 6-6"/>',
    right:'<path d="M9 18l6-6-6-6"/>',
    x:'<path d="M18 6L6 18M6 6l12 12"/>',
    play:'<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
    pause:'<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" stroke="none"/>',
    stop:'<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
    link:'<path d="M10 13a5 5 0 007.07 0l3-3a5 5 0 00-7.07-7.07l-1 1"/><path d="M14 11a5 5 0 00-7.07 0l-3 3a5 5 0 007.07 7.07l1-1"/>',
    alert:'<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>',
    copy:'<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
    refresh:'<path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    text:'<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
    download:'<path d="M12 3v13m0 0l-4-4m4 4l4-4M5 21h14"/>',
    swap:'<path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/>',
    camera:'<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>',
    scan:'<path d="M4 7V5a1 1 0 011-1h2M17 4h2a1 1 0 011 1v2M20 17v2a1 1 0 01-1 1h-2M7 20H5a1 1 0 01-1-1v-2M8 9h8M8 12h8M8 15h5"/>',
    list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    up:'<path d="M18 15l-6-6-6 6"/>',
    merge:'<path d="M12 3v11m0 0l-4-4m4 4l4-4M5 20h14"/>',
    clipboard:'<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h6"/>'
  };
  function ico(name, size, extra){
    size = size || 15;
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra ? ' ' + extra : ''}>${ICONS[name] || ''}</svg>`;
  }

  function fmtNum(n){
    n = Number(n); if(!Number.isFinite(n)) return '0';
    return Number.isInteger(n) ? String(n) : String(+n.toFixed(2));
  }
  function pctOf(t){
    const max = Number(t.maxMarks), m = Number(t.marks);
    if(!(max > 0) || !Number.isFinite(m)) return 0;
    return (m / max) * 100;
  }
  function fmtPct(p){ return (+p.toFixed(1)) + '%'; }
  function pctClass(p){ return p >= 75 ? 'good' : (p >= 50 ? 'mid' : 'low'); }

  function localDateStr(d){
    d = d || new Date();
    return d.getFullYear() + '-' + Utils.pad2(d.getMonth() + 1) + '-' + Utils.pad2(d.getDate());
  }
  function parseDateStr(s){
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function fmtDay(s){
    const d = parseDateStr(s); if(!d) return s || '';
    return d.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
  }
  function fmtDayLong(s){
    const d = parseDateStr(s); if(!d) return s || '';
    return d.toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric', year:'numeric' });
  }
  function fmtClock(sec){
    sec = Math.max(0, Math.round(Number(sec) || 0));
    return Math.floor(sec / 60) + ':' + Utils.pad2(sec % 60);
  }
  function plural(n, one, many){ return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function subjectColor(s){ return SUBJECT_COLORS[s] || '#2DD4BF'; }
  function fileExt(name){ const m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  function fmtBytes(b){
    if(!b) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'], i = Math.min(3, Math.floor(Math.log(b) / Math.log(1024)));
    const v = b / Math.pow(1024, i);
    return (i === 0 ? v : v.toFixed(1)) + ' ' + u[i];
  }

  /* ---------------- data access ---------------- */
  function normTest(t){
    if(!Array.isArray(t.chapters)) t.chapters = t.chapter ? [t.chapter] : [];     // older records stored one chapter string
    if(!Array.isArray(t.questions)) t.questions = [];
    return t;
  }
  function chaptersOf(t){ return Array.isArray(t.chapters) ? t.chapters : (t.chapter ? [t.chapter] : []); }
  function all(){ const v = Storage.get('tests', []); return (Array.isArray(v) ? v : []).map(normTest); }
  let sizeWarned = false;
  function saveAll(list){
    Storage.set('tests', list);
    if(!sizeWarned){
      try{
        if(JSON.stringify(list).length > SYNC_WARN_BYTES){
          sizeWarned = true;
          Utils.toast('Your test data is getting large for cloud sync — consider deleting old extracted text.', 'info');
        }
      }catch(e){}
    }
  }
  function find(id){ return all().find(t => t.id === id) || null; }
  function update(id, fn){
    const list = all(), t = list.find(x => x.id === id);
    if(!t) return null;
    fn(t);
    t.updatedAt = Date.now();
    saveAll(list);
    return t;
  }
  function linkedTask(t){
    if(!t || !t.taskId || typeof App === 'undefined' || !App.getTasks) return null;
    try{ return (App.getTasks({ id:t.taskId }) || [])[0] || null; }catch(e){ return null; }
  }

  /* ---------------- media store (IndexedDB) ---------------- */
  const K_IMG = id => 'tst-img:' + id;
  const K_THUMB = id => 'tst-thumb:' + id;
  const K_AUD = id => 'tst-aud:' + id;
  const urlCache = new Map();

  async function mediaUrl(key){
    if(urlCache.has(key)) return urlCache.get(key);
    let blob = null;
    try{ blob = await AttachmentDB.get(key); }catch(e){}
    if(!blob) return null;
    const url = URL.createObjectURL(blob);
    urlCache.set(key, url);
    return url;
  }
  function dropUrl(key){
    const u = urlCache.get(key);
    if(u){ try{ URL.revokeObjectURL(u); }catch(e){} urlCache.delete(key); }
  }
  async function dropMedia(key){
    dropUrl(key);
    try{ await AttachmentDB.remove(key); }catch(e){}
  }

  function loadImageEl(src){
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode'));
      img.src = src;
    });
  }
  function canvasBlob(canvas, mime, q){ return new Promise(res => canvas.toBlob(b => res(b), mime, q)); }

  /* Downscale (only if needed) and build a thumbnail. Keeps more
     resolution than the Notes attachments do, because OCR needs it. */
  async function processImage(file){
    // Keep the uploaded original as the full-size asset. Browsers apply EXIF
    // orientation when decoding for the thumbnail; never recompress the source.
    const src = URL.createObjectURL(file);
    try{
      const img = await loadImageEl(src);
      const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      const scale = Math.min(1, IMG_THUMB_MAX / Math.max(w,h));
      const c = document.createElement('canvas'); c.width=Math.max(1,Math.round(w*scale)); c.height=Math.max(1,Math.round(h*scale));
      const ctx=c.getContext('2d'); ctx.drawImage(img,0,0,c.width,c.height);
      const thumb=await canvasBlob(c,'image/jpeg',0.82);
      return { blob:file, thumb:thumb||file };
    } finally { URL.revokeObjectURL(src); }
  }

  function validateImage(file){
    const ext = fileExt(file.name);
    const okType = /^image\/(jpeg|png|webp)$/.test(file.type) || IMG_EXT.includes(ext);
    if(!okType) return `"${file.name}" isn't supported — use JPG, PNG or WebP images.`;
    if(file.size === 0) return `"${file.name}" appears to be empty.`;
    if(file.size > MAX_FILE) return `"${file.name}" is too large (max ${fmtBytes(MAX_FILE)}).`;
    return null;
  }
  function validateAudio(file){
    const ext = fileExt(file.name);
    const okType = /^audio\//.test(file.type) || ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'webm', 'opus', 'flac', 'mp4'].includes(ext);
    if(!okType) return `"${file.name}" isn't an audio file.`;
    if(file.size === 0) return `"${file.name}" appears to be empty.`;
    if(file.size > MAX_FILE) return `"${file.name}" is too large (max ${fmtBytes(MAX_FILE)}).`;
    return null;
  }
  function audioDuration(blob){
    return new Promise(resolve => {
      const url = URL.createObjectURL(blob);
      const a = new Audio();
      const done = v => { URL.revokeObjectURL(url); resolve(v); };
      a.preload = 'metadata';
      a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : 0);
      a.onerror = () => done(0);
      setTimeout(() => done(0), 4000);
      a.src = url;
    });
  }

  /* stores a draft image ({id, file}) → returns the metadata object saved on the test */
  async function storeImage(d){
    const { blob, thumb } = await processImage(d.file);
    await AttachmentDB.put(K_IMG(d.id), blob);
    await AttachmentDB.put(K_THUMB(d.id), thumb);
    return { id:d.id, name:d.file.name || ('image-' + d.id), size:blob.size, type:blob.type || d.file.type || 'image/jpeg', addedAt:Date.now() };
  }
  async function storeVoice(v){
    await AttachmentDB.put(K_AUD(v.id), v.blob);
    return { id:v.id, name:v.name, size:v.blob.size, type:v.blob.type || 'audio/webm', duration:Math.round(v.duration || 0), addedAt:Date.now() };
  }
  async function deleteTestMedia(t){
    for(const i of (t.images || [])){ await dropMedia(K_IMG(i.id)); await dropMedia(K_THUMB(i.id)); }
    for(const v of (t.voices || [])){ await dropMedia(K_AUD(v.id)); }
    for(const q of (t.questions || [])){ if(q.image){ await dropMedia(K_IMG(q.image.id)); await dropMedia(K_THUMB(q.image.id)); } }
  }

  /* =========================================================
     Voice recorder (MediaRecorder) — one recording at a time
     ========================================================= */
  const Rec = (function(){
    let mr = null, stream = null, chunks = [], timer = null, startedAt = 0, onTick = null, cancelled = false, resolveStop = null;

    function supported(){
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    }
    function pickMime(){
      const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
      for(const c of cands){ try{ if(MediaRecorder.isTypeSupported(c)) return c; }catch(e){} }
      return '';
    }
    function cleanup(){
      clearInterval(timer); timer = null;
      if(stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
      mr = null; chunks = []; onTick = null;
    }
    function isActive(){ return !!mr; }

    async function start(tick){
      if(mr) throw new Error('Already recording');
      if(!supported()) throw new Error('unsupported');
      stream = await navigator.mediaDevices.getUserMedia({ audio:true });
      const mime = pickMime();
      mr = mime ? new MediaRecorder(stream, { mimeType:mime }) : new MediaRecorder(stream);
      chunks = []; cancelled = false; onTick = tick || null;
      mr.ondataavailable = e => { if(e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = () => {
        const dur = (Date.now() - startedAt) / 1000;
        const type = (mr && mr.mimeType) || mime || 'audio/webm';
        const blob = new Blob(chunks, { type });
        const res = cancelled ? null : { blob, duration:dur, mime:type };
        const r = resolveStop; resolveStop = null;
        cleanup();
        if(r) r(res);
      };
      startedAt = Date.now();
      mr.start(250);
      timer = setInterval(() => { if(onTick) onTick((Date.now() - startedAt) / 1000); }, 250);
      if(onTick) onTick(0);
    }
    function stop(){
      return new Promise(resolve => {
        if(!mr){ resolve(null); return; }
        resolveStop = resolve;
        try{ mr.stop(); }catch(e){ cleanup(); resolve(null); }
      });
    }
    function cancel(){
      if(!mr) return;
      cancelled = true;
      try{ mr.stop(); }catch(e){ cleanup(); }
    }
    return { supported, start, stop, cancel, isActive };
  })();

  function micErrorMessage(e){
    if(e && e.message === 'unsupported') return 'Voice recording isn\'t supported in this browser — you can upload an audio file instead.';
    const n = e && e.name;
    if(n === 'NotAllowedError' || n === 'SecurityError') return 'Microphone access was blocked. Allow it in your browser settings and try again.';
    if(n === 'NotFoundError' || n === 'OverconstrainedError') return 'No microphone was found on this device.';
    return 'Could not start recording' + (e && e.message ? ' (' + e.message + ')' : '') + '.';
  }

  /* =========================================================
     Audio player widget (play / pause / seek)
     ========================================================= */
  let activeAudio = null;
  function stopAllAudio(){
    if(activeAudio){ try{ activeAudio.pause(); }catch(e){} activeAudio = null; }
    document.querySelectorAll('.tx-player.playing').forEach(p => {
      p.classList.remove('playing');
      const b = p.querySelector('.tx-play'); if(b){ b.innerHTML = ico('play', 16); b.setAttribute('aria-label', 'Play'); }
    });
  }

  function playerHtml(id, name, duration, actionsHtml){
    return `<div class="tx-player" data-aid="${esc(id)}" data-dur="${Number(duration) || 0}">
      <button type="button" class="tx-play" aria-label="Play">${ico('play', 16)}</button>
      <div class="tx-player-body">
        <div class="tx-player-name" title="${esc(name)}">${esc(name)}</div>
        <div class="tx-player-track">
          <input type="range" class="tx-seek" min="0" max="1000" value="0" aria-label="Seek">
          <span class="tx-time"><span class="tx-cur">0:00</span> / <span class="tx-total">${fmtClock(duration)}</span></span>
        </div>
      </div>
      ${actionsHtml ? `<div class="tx-player-actions">${actionsHtml}</div>` : ''}
    </div>`;
  }

  /* getUrl(id) → Promise<string|null> */
  function bindPlayers(root, getUrl){
    root.querySelectorAll('.tx-player').forEach(el => {
      if(el.dataset.bound) return;
      el.dataset.bound = '1';
      const id = el.dataset.aid, known = Number(el.dataset.dur) || 0;
      const btn = el.querySelector('.tx-play'), seek = el.querySelector('.tx-seek');
      const cur = el.querySelector('.tx-cur'), total = el.querySelector('.tx-total');
      let audio = null;
      const totalSec = () => (audio && Number.isFinite(audio.duration) && audio.duration > 0) ? audio.duration : known;
      const setIcon = playing => {
        el.classList.toggle('playing', playing);
        btn.innerHTML = ico(playing ? 'pause' : 'play', 16);
        btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      };
      async function ensure(){
        if(audio) return audio;
        btn.classList.add('loading');
        const url = await getUrl(id);
        btn.classList.remove('loading');
        if(!url){ Utils.toast('This recording isn\'t available on this device.', 'error'); return null; }
        audio = new Audio(url);
        audio.preload = 'auto';
        audio.addEventListener('timeupdate', () => {
          const t = totalSec();
          cur.textContent = fmtClock(audio.currentTime);
          if(t > 0) seek.value = Math.min(1000, Math.round((audio.currentTime / t) * 1000));
          total.textContent = fmtClock(t);
        });
        audio.addEventListener('ended', () => { setIcon(false); seek.value = 0; cur.textContent = '0:00'; if(activeAudio === audio) activeAudio = null; });
        audio.addEventListener('pause', () => setIcon(false));
        audio.addEventListener('play', () => setIcon(true));
        return audio;
      }
      btn.addEventListener('click', async () => {
        const a = await ensure(); if(!a) return;
        if(a.paused){
          if(activeAudio && activeAudio !== a){ try{ activeAudio.pause(); }catch(e){} }
          activeAudio = a;
          try{ await a.play(); }catch(e){ Utils.toast('Could not play this recording.', 'error'); }
        } else { a.pause(); }
      });
      seek.addEventListener('input', async () => {
        const a = await ensure(); if(!a) return;
        const t = totalSec();
        if(t > 0){ try{ a.currentTime = (seek.value / 1000) * t; }catch(e){} }
      });
    });
  }

  /* =========================================================
     Overlays: generic modal host + confirm dialog
     ========================================================= */
  function ensureOverlay(id, boxClass){
    let o = $(id);
    if(o) return o;
    o = document.createElement('div');
    o.className = 'modal-overlay tx-overlay';
    o.id = id;
    o.innerHTML = `<div class="modal ${boxClass || ''}" role="dialog" aria-modal="true"></div>`;
    document.body.appendChild(o);
    return o;
  }
  const isOpen = id => { const o = $(id); return !!(o && o.classList.contains('open')); };

  let confirmResolve = null;
  function confirmDialog(opts){
    const o = ensureOverlay('txConfirm', 'tx-confirm');
    const box = o.firstElementChild;
    box.setAttribute('aria-labelledby', 'txConfirmTitle');
    box.innerHTML = `
      <div class="tx-confirm-ico ${opts.danger ? 'danger' : ''}">${ico(opts.danger ? 'trash' : 'alert', 20)}</div>
      <h3 id="txConfirmTitle">${esc(opts.title || 'Are you sure?')}</h3>
      <p>${esc(opts.message || '')}</p>
      <div class="modal-actions">
        <button type="button" class="pill-btn" data-act="no">${esc(opts.cancelText || 'Cancel')}</button>
        <button type="button" class="pill-btn ${opts.danger ? 'tx-danger' : 'primary'}" data-act="yes">${esc(opts.confirmText || 'Confirm')}</button>
      </div>`;
    return new Promise(resolve => {
      const finish = v => {
        o.classList.remove('open'); confirmResolve = null;
        o.onclick = null; resolve(v);
      };
      confirmResolve = finish;
      box.querySelector('[data-act="no"]').onclick = () => finish(false);
      const yes = box.querySelector('[data-act="yes"]');
      yes.onclick = () => finish(true);
      o.onclick = e => { if(e.target === o) finish(false); };
      o.classList.add('open');
      yes.focus();
    });
  }

  /* =========================================================
     OCR (Tesseract.js, loaded lazily the first time it's needed)
     ========================================================= */
  const ocr = { state:{}, queue:[], running:false, loading:null, batch:0 };
  function loadTesseract(){
    if(window.Tesseract) return Promise.resolve();
    if(ocr.loading) return ocr.loading;
    ocr.loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TESS_URL; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { ocr.loading = null; s.remove(); reject(new Error('Could not load the text-recognition engine. Check your connection and try again.')); };
      document.head.appendChild(s);
    });
    return ocr.loading;
  }
  function ocrStatusOf(imgId){ return ocr.state[imgId] ? ocr.state[imgId].status : null; }

  function queueOcr(testId, imgId){
    const st = ocrStatusOf(imgId);
    if(st === 'queued' || st === 'processing') return;
    ocr.state[imgId] = { status:'queued', progress:0, testId };
    ocr.queue.push({ testId, imgId });
    ocr.batch++;
    refreshOcrUI(imgId);
    runOcrQueue();
  }

  async function runOcrQueue(){
    if(ocr.running) return;
    ocr.running = true;
    let worker = null, current = null, done = 0, failed = 0;
    try{
      ocr.engineLoading = true; refreshAllOcrUI();
      await loadTesseract();
      worker = await window.Tesseract.createWorker('eng', 1, {
        logger: m => {
          if(current && m && m.status === 'recognizing text'){
            const st = ocr.state[current.imgId];
            if(st){ st.progress = Math.round((m.progress || 0) * 100); refreshOcrUI(current.imgId); }
          }
        }
      });
      ocr.engineLoading = false;
      while(ocr.queue.length){
        const job = ocr.queue.shift(); current = job;
        const st = ocr.state[job.imgId] = { status:'processing', progress:0, testId:job.testId };
        refreshOcrUI(job.imgId);
        try{
          const t = find(job.testId);
          if(!t || !(t.images || []).some(i => i.id === job.imgId)){ delete ocr.state[job.imgId]; continue; }
          const blob = await AttachmentDB.get(K_IMG(job.imgId));
          if(!blob) throw new Error('The image file isn\'t on this device.');
          const res = await worker.recognize(blob);
          let text = ((res && res.data && res.data.text) || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
          const truncated = text.length > OCR_TEXT_CAP;
          if(truncated) text = text.slice(0, OCR_TEXT_CAP);
          const stillThere = update(job.testId, tt => {
            const im = (tt.images || []).find(i => i.id === job.imgId);
            if(im){ im.ocrText = text; im.ocrStatus = text ? 'done' : 'empty'; im.ocrTruncated = truncated || undefined; im.ocrAt = Date.now(); }
          });
          if(stillThere) done++;
          delete ocr.state[job.imgId];
        }catch(e){
          failed++;
          ocr.state[job.imgId] = { status:'failed', progress:0, testId:job.testId, error:(e && e.message) || 'Text extraction failed.' };
        }
        refreshOcrUI(job.imgId);
        if(view === 'detail') renderHero();
      }
    }catch(e){
      ocr.engineLoading = false;
      const msg = (e && e.message) || 'Text extraction failed.';
      ocr.queue.forEach(j => { ocr.state[j.imgId] = { status:'failed', progress:0, testId:j.testId, error:msg }; });
      failed += ocr.queue.length; ocr.queue = [];
      if(current && ocr.state[current.imgId] && ocr.state[current.imgId].status === 'processing'){
        ocr.state[current.imgId] = { status:'failed', progress:0, testId:current.testId, error:msg };
      }
      refreshAllOcrUI();
    } finally {
      ocr.engineLoading = false;
      if(worker){ try{ await worker.terminate(); }catch(e){} }
      ocr.running = false;
      if(done) Utils.toast(done === 1 ? 'Text extracted from 1 image' : `Text extracted from ${done} images`, 'success');
      if(failed) Utils.toast(failed === 1 ? 'Could not extract text from 1 image' : `Could not extract text from ${failed} images`, 'error');
      if(ocr.queue.length) runOcrQueue();   // jobs added while the engine was shutting down
    }
  }

  /* =========================================================
     State
     ========================================================= */
  let view = 'list';              // 'list' | 'detail'
  let currentId = null;
  let search = '';
  let sortKey = 'date-desc';
  let filtersOpen = false;
  let shellBuilt = false;
  let mistakeView = { status:'all', type:'' };
  const expandedMistakes = new Set();
  const emptyFilters = () => ({ from:'', to:'', subject:'', chapter:'', name:'', minPct:'', maxPct:'', mtype:'', resolved:'' });
  let filters = emptyFilters();

  const SORTS = [
    ['date-desc', 'Date · newest first'], ['date-asc', 'Date · oldest first'],
    ['score-desc', 'Score · high to low'], ['score-asc', 'Score · low to high'],
    ['name-asc', 'Name · A to Z'], ['name-desc', 'Name · Z to A']
  ];

  function pageEl(){ return $('page-tests'); }
  function pageVisible(){ const p = pageEl(); return !!(p && p.style.display !== 'none'); }

  /* =========================================================
     Page shell (built once) + list view
     ========================================================= */
  function buildShell(){
    const p = pageEl(); if(!p) return;
    p.innerHTML = `
      <div id="txListView">
        <div class="head-row">
          <div>
            <h1>Test <span class="accent">Analysis</span></h1>
            <div class="date-line"><span class="t">Track scores, review papers, learn from every mistake</span></div>
          </div>
          <div class="head-actions">
            <button type="button" class="share-btn" onclick="Tests.openCreate()">${ico('plus', 15)}Add New Test</button>
          </div>
        </div>

        <div class="stat-strip tx-stats" id="txStats"></div>

        <div class="panel tx-toolbar-panel">
          <div class="tx-toolbar">
            <div class="tx-search">
              ${ico('search', 14)}
              <input id="txSearch" type="text" placeholder="Search tests, chapters, notes, extracted text…" aria-label="Search tests" autocomplete="off">
            </div>
            <div class="tx-sort">
              <label for="txSort" class="tx-sr">Sort</label>
              <select id="txSort" aria-label="Sort tests">${SORTS.map(s => `<option value="${s[0]}">${s[1]}</option>`).join('')}</select>
            </div>
            <button type="button" class="pill-btn tx-filter-btn" id="txFilterBtn" aria-expanded="false" aria-controls="txFilters">
              ${ico('filter', 14)}<span>Add Filters</span><span class="tx-count" id="txFilterCount" hidden>0</span>
            </button>
          </div>
          <div class="tx-filters" id="txFilters" hidden>
            <div class="tx-filter-grid">
              <div class="field"><label for="tfFrom">From date</label><input type="date" id="tfFrom"></div>
              <div class="field"><label for="tfTo">To date</label><input type="date" id="tfTo"></div>
              <div class="field"><label for="tfSubject">Subject</label>
                <select id="tfSubject"><option value="">All subjects</option>${SUBJECTS.map(s => `<option>${s}</option>`).join('')}</select></div>
              <div class="field"><label for="tfChapter">Chapter</label><input type="text" id="tfChapter" placeholder="Contains…" list="txChapterList"></div>
              <div class="field"><label for="tfName">Test name</label><input type="text" id="tfName" placeholder="Contains…"></div>
              <div class="field"><label>Score range (%)</label>
                <div class="tx-range"><input type="number" id="tfMin" placeholder="Min" aria-label="Minimum percent"><span>–</span><input type="number" id="tfMax" placeholder="Max" aria-label="Maximum percent"></div></div>
              <div class="field"><label for="tfType">Mistake type</label>
                <select id="tfType"><option value="">Any type</option>${MISTAKE_TYPES.map(s => `<option>${s}</option>`).join('')}</select></div>
              <div class="field"><label for="tfRes">Mistake status</label>
                <select id="tfRes"><option value="">Any status</option><option value="unresolved">Has unresolved</option><option value="resolved">Has resolved</option></select></div>
            </div>
            <div class="tx-filter-foot">
              <span class="tx-filter-note" id="txFilterNote"></span>
              <button type="button" class="pill-btn" id="txClearFilters">${ico('x', 12)}Clear Filters</button>
            </div>
          </div>
        </div>

        <div class="tx-result-line" id="txResultLine"></div>
        <div class="tx-list" id="txList"></div>
        <datalist id="txChapterList"></datalist>
      </div>
      <div id="txDetailView" hidden></div>`;

    $('txSearch').addEventListener('input', Utils.debounce(e => { search = e.target.value; renderList(); }, 140));
    $('txSort').addEventListener('change', e => { sortKey = e.target.value; renderList(); });
    $('txFilterBtn').addEventListener('click', () => toggleFilters());
    $('txClearFilters').addEventListener('click', () => clearFilters());
    ['tfFrom', 'tfTo', 'tfSubject', 'tfChapter', 'tfName', 'tfMin', 'tfMax', 'tfType', 'tfRes'].forEach(id => {
      const el = $(id);
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input', readFilters);
    });
    shellBuilt = true;
  }

  function toggleFilters(force){
    filtersOpen = typeof force === 'boolean' ? force : !filtersOpen;
    const f = $('txFilters'), b = $('txFilterBtn');
    if(!f) return;
    f.hidden = !filtersOpen;
    b.setAttribute('aria-expanded', String(filtersOpen));
    b.classList.toggle('active', filtersOpen);
    if(filtersOpen) f.classList.add('anim-in');
  }
  function readFilters(){
    filters = {
      from:$('tfFrom').value, to:$('tfTo').value, subject:$('tfSubject').value,
      chapter:$('tfChapter').value.trim(), name:$('tfName').value.trim(),
      minPct:$('tfMin').value, maxPct:$('tfMax').value, mtype:$('tfType').value, resolved:$('tfRes').value
    };
    renderList();
  }
  function activeFilterCount(){ return Object.keys(filters).filter(k => filters[k] !== '').length; }
  function clearFilters(){
    filters = emptyFilters();
    ['tfFrom', 'tfTo', 'tfChapter', 'tfName', 'tfMin', 'tfMax'].forEach(id => { if($(id)) $(id).value = ''; });
    ['tfSubject', 'tfType', 'tfRes'].forEach(id => { if($(id)) $(id).value = ''; });
    renderList();
  }

  function matches(t){
    const f = filters, q = search.trim().toLowerCase();
    if(q){
      const lt = linkedTask(t);
      const hay = [t.name, t.subject, chaptersOf(t).join(' '), t.description, lt && lt.title,
        ...(t.questions || []).map(x => [x.text, x.title, x.note].join(' ')),
        ...(t.images || []).map(i => i.ocrText || ''), ...(t.images || []).map(i => i.name || ''),
        ...(t.mistakes || []).map(m => [m.question, m.attempted, m.correct, m.explanation, m.learned, m.type].join(' '))
      ].join(' ').toLowerCase();
      if(!hay.includes(q)) return false;
    }
    if(f.from && (t.date || '') < f.from) return false;
    if(f.to && (t.date || '') > f.to) return false;
    if(f.subject && t.subject !== f.subject) return false;
    if(f.chapter && !chaptersOf(t).some(c => c.toLowerCase().includes(f.chapter.toLowerCase()))) return false;
    if(f.name && !(t.name || '').toLowerCase().includes(f.name.toLowerCase())) return false;
    const p = +pctOf(t).toFixed(1);
    if(f.minPct !== '' && p < Number(f.minPct)) return false;
    if(f.maxPct !== '' && p > Number(f.maxPct)) return false;
    if(f.mtype || f.resolved){
      const ok = (t.mistakes || []).some(m =>
        (!f.mtype || m.type === f.mtype) &&
        (!f.resolved || (f.resolved === 'resolved') === !!m.resolved));
      if(!ok) return false;
    }
    return true;
  }
  function sorted(list){
    const [key, dir] = sortKey.split('-'), mul = dir === 'asc' ? 1 : -1;
    return list.slice().sort((a, b) => {
      let r = 0;
      if(key === 'date') r = (a.date || '').localeCompare(b.date || '');
      else if(key === 'score') r = pctOf(a) - pctOf(b);
      else r = (a.name || '').localeCompare(b.name || '', undefined, { sensitivity:'base' });
      if(r === 0) r = (a.createdAt || 0) - (b.createdAt || 0);
      return r * mul;
    });
  }

  function chapChips(t, max){
    const ch = chaptersOf(t); if(!ch.length) return '';
    const shown = max ? ch.slice(0, max) : ch;
    return `<span class="tx-chaps">${shown.map(c => `<span class="tx-chap-mini">${esc(c)}</span>`).join('')}${max && ch.length > max ? `<span class="tx-chap-mini more" title="${esc(ch.slice(max).join(', '))}">+${ch.length - max}</span>` : ''}</span>`;
  }
  function unresolvedCount(t){ return (t.mistakes || []).filter(m => !m.resolved).length; }

  function renderStats(list){
    const el = $('txStats'); if(!el) return;
    const n = list.length;
    const avg = n ? list.reduce((s, t) => s + pctOf(t), 0) / n : 0;
    const best = n ? list.reduce((b, t) => pctOf(t) > pctOf(b) ? t : b, list[0]) : null;
    const open = list.reduce((s, t) => s + unresolvedCount(t), 0);
    const total = list.reduce((s, t) => s + (t.mistakes || []).length, 0);
    el.innerHTML = `
      <div class="stat-card"><p class="stat-label">Tests</p><p class="stat-num">${n}</p></div>
      <div class="stat-card blue"><p class="stat-label">Average Score</p><p class="stat-num">${n ? fmtPct(avg) : '—'}</p></div>
      <div class="stat-card green"><p class="stat-label">Best Score</p><p class="stat-num">${best ? fmtPct(pctOf(best)) : '—'}</p></div>
      <div class="stat-card red"><p class="stat-label">Open Mistakes</p><p class="stat-num">${open}<span class="tx-stat-sub"> / ${total}</span></p></div>`;
  }

  function cardHtml(t, idx){
    const p = pctOf(t), cls = pctClass(p), col = subjectColor(t.subject);
    const mis = (t.mistakes || []).length, unres = unresolvedCount(t);
    const lt = linkedTask(t);
    return `
    <article class="tx-card" style="--sc:${col};animation-delay:${Math.min(idx, 10) * 35}ms" tabindex="0" role="button"
      aria-label="Open test ${esc(t.name)}" onclick="Tests.open('${t.id}')"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();Tests.open('${t.id}')}">
      <div class="tx-card-main">
        <h3 class="tx-card-name">${esc(t.name)}</h3>
        <div class="tx-card-meta">
          <span class="tx-chip subj"><i></i>${esc(t.subject || 'General')}</span>
          <span class="tx-meta-item">${ico('calendar', 13)}${esc(fmtDay(t.date))}</span>
          ${chapChips(t, 2)}
        </div>
        <div class="tx-card-foot">
          ${(t.questions || []).length ? `<span class="tx-pill mute">${ico('list', 12)}${plural(t.questions.length, 'question')}</span>` : ''}
          <span class="tx-pill ${mis ? 'err' : 'ok'}">${ico(mis ? 'alert' : 'check', 12)}${plural(mis, 'mistake')}</span>
          ${unres ? `<span class="tx-pill warn">${unres} unresolved</span>` : (mis ? `<span class="tx-pill ok">All resolved</span>` : '')}
          ${(t.images || []).length ? `<span class="tx-pill mute">${ico('image', 12)}${(t.images || []).length}</span>` : ''}
          ${(t.voices || []).length ? `<span class="tx-pill mute">${ico('mic', 12)}${(t.voices || []).length}</span>` : ''}
          ${lt ? `<span class="tx-pill link" title="Linked mission">${ico('link', 12)}${esc(lt.title)}</span>` : ''}
        </div>
      </div>
      <div class="tx-card-score">
        <div class="tx-score-big ${cls}"><b>${fmtNum(t.marks)}</b><span>/${fmtNum(t.maxMarks)}</span></div>
        <div class="tx-score-pct ${cls}">${fmtPct(p)}</div>
      </div>
      <div class="tx-card-actions" onclick="event.stopPropagation()" onkeydown="event.stopPropagation()">
        <button type="button" class="tx-icon-btn" aria-label="Edit ${esc(t.name)}" data-tip="Edit" onclick="Tests.openEdit('${t.id}')">${ico('edit', 14)}</button>
        <button type="button" class="tx-icon-btn danger" aria-label="Delete ${esc(t.name)}" data-tip="Delete" onclick="Tests.remove('${t.id}')">${ico('trash', 14)}</button>
      </div>
    </article>`;
  }

  function renderList(){
    if(!shellBuilt) return;
    const everything = all();
    renderStats(everything);

    // chapter suggestions for the filter box
    const dl = $('txChapterList');
    if(dl) dl.innerHTML = [...new Set(everything.flatMap(t => chaptersOf(t)).concat(typeof ChapterAutocomplete !== 'undefined' ? ChapterAutocomplete.allChapters().map(c => c.name) : []).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('');

    const n = activeFilterCount();
    const badge = $('txFilterCount');
    badge.hidden = n === 0; badge.textContent = n;
    $('txFilterBtn').classList.toggle('has-filters', n > 0);

    const shown = sorted(everything.filter(matches));
    const line = $('txResultLine');
    const list = $('txList');
    const filtering = n > 0 || search.trim() !== '';
    $('txFilterNote').textContent = filtering ? `${plural(shown.length, 'test')} match` : '';
    line.textContent = everything.length && filtering ? `Showing ${shown.length} of ${everything.length} tests` : '';

    if(!everything.length){
      list.innerHTML = `
        <div class="tx-empty">
          <div class="tx-empty-ico">${ico('clipboard', 28)}</div>
          <h3>No tests yet</h3>
          <p>Add your first test to track scores, store question-paper photos, record voice notes and analyse your mistakes.</p>
          <button type="button" class="share-btn" onclick="Tests.openCreate()">${ico('plus', 15)}Add New Test</button>
        </div>`;
      return;
    }
    if(!shown.length){
      list.innerHTML = `
        <div class="tx-empty">
          <div class="tx-empty-ico">${ico('search', 28)}</div>
          <h3>No tests match</h3>
          <p>Try a different search or loosen your filters.</p>
          <button type="button" class="pill-btn" onclick="Tests.resetAll()">${ico('x', 12)}Clear search &amp; filters</button>
        </div>`;
      return;
    }
    list.innerHTML = shown.map(cardHtml).join('');
  }

  function resetAll(){
    search = ''; const s = $('txSearch'); if(s) s.value = '';
    clearFilters();
  }

  /* =========================================================
     Detail view
     ========================================================= */
  function open(id){
    if(!find(id)){ Utils.toast('That test no longer exists.', 'error'); return; }
    ensureShell();
    stopAllAudio();
    view = 'detail'; currentId = id;
    mistakeView = { status:'all', type:'' };
    expandedMistakes.clear();
    detailTab = 'overview';
    buildDetail();
    $('txListView').hidden = true;
    const d = $('txDetailView'); d.hidden = false;
    d.classList.remove('anim-in'); void d.offsetWidth; d.classList.add('anim-in');
    scrollPageTo(0, true);
  }
  function back(){
    stopAllAudio();
    if(Rec.isActive()) Rec.cancel();
    recState = { active:false, where:null, sec:0 };
    view = 'list'; currentId = null;
    $('txDetailView').hidden = true;
    const l = $('txListView'); l.hidden = false;
    l.classList.remove('anim-in'); void l.offsetWidth; l.classList.add('anim-in');
    renderList();
  }

  let detailTab = 'overview';
  function detailTabsList(t){
    const unres = unresolvedCount(t);
    const tabs = [['overview', 'Overview', 'book', 0], ['questions', 'Questions', 'list', (t.questions || []).length],
      ['edit', 'Edit', 'edit', unres], ['voice', 'Voice', 'mic', (t.voices || []).length]];
    if((t.images || []).length) tabs.push(['papers', 'Papers', 'image', t.images.length]);
    return tabs;
  }
  function updateDetailTabs(){
    const nav = $('txDTabs'); const t = find(currentId); if(!nav || !t) return;
    nav.innerHTML = detailTabsList(t).map(([k, l, ic, n]) =>
      `<button type="button" role="tab" data-tab="${k}" class="${detailTab === k ? 'active' : ''}" aria-selected="${detailTab === k}" onclick="Tests.setDetailTab('${k}')">
        ${ico(ic, 18)}<span class="tx-tab-label">${l}</span>${n ? `<em class="tx-tab-count ${k === 'edit' ? 'warn' : ''}">${n}</em>` : ''}</button>`).join('');
  }
  function setDetailTab(name){
    detailTab = name;
    const target = name === 'edit' ? 'mistakes' : name;
    document.querySelectorAll('#txDGrid .tx-sec').forEach(s => s.classList.toggle('tx-dactive', s.dataset.sec === target));
    updateDetailTabs();
    if(window.innerWidth <= 900){ const n = $('txDTabs'), app = $('app'); if(n){ const base = app && app.scrollHeight > app.clientHeight + 1 ? app.getBoundingClientRect().top : 0; const y = n.getBoundingClientRect().top - base + ((app && app.scrollHeight > app.clientHeight + 1) ? app.scrollTop : window.scrollY) - (document.querySelector('.topbar') ? document.querySelector('.topbar').offsetHeight : 0) - 8; scrollPageTo(Math.max(0, y), true); } }
  }
  /* the app scrolls inside #app (body is overflow:hidden), so scroll whichever container actually scrolls */
  function scrollPageTo(y, smooth){
    const app = $('app');
    const el = (app && app.scrollHeight > app.clientHeight + 1) ? app : null;
    const opt = { top:y, behavior:smooth ? 'smooth' : 'auto' };
    if(el) el.scrollTo(opt); else window.scrollTo(opt);
  }
  /* keep the sticky tab bar directly under the app's top bar, whether or not that bar is currently on screen */
  function setTopOffset(){
    const tb = document.querySelector('.topbar'), p = pageEl();
    if(p) p.style.setProperty('--tx-top', Math.max(0, tb ? Math.round(tb.getBoundingClientRect().bottom) : 0) + 'px');
  }
  /* The app's scroll container never actually scrolls (so CSS sticky can't engage); pin the tab bar with a tiny scroll handler instead. */
  function syncStickyTabs(){
    const w = $('txDTabsWrap'), n = $('txDTabs'); if(!w || !n) return;
    if(window.innerWidth > 900 || view !== 'detail'){ n.classList.remove('stuck'); n.style.cssText = ''; w.style.height = ''; return; }
    const tb = document.querySelector('.topbar');
    const top = Math.max(0, tb ? Math.round(tb.getBoundingClientRect().bottom) : 0) + 6;
    const r = w.getBoundingClientRect();
    if(r.top < top){
      w.style.height = n.offsetHeight + 'px';
      n.classList.add('stuck'); n.style.top = top + 'px'; n.style.left = r.left + 'px'; n.style.width = r.width + 'px';
    } else { n.classList.remove('stuck'); n.style.cssText = ''; w.style.height = ''; }
  }
  let topRaf = 0;
  const onScrollTop = () => { if(topRaf || view !== 'detail') return; topRaf = requestAnimationFrame(() => { topRaf = 0; setTopOffset(); syncStickyTabs(); }); };
  document.addEventListener('scroll', onScrollTop, true);
  window.addEventListener('resize', Utils.debounce(() => { if(shellBuilt){ setTopOffset(); syncStickyTabs(); } }, 100));

  function buildDetail(){
    const t = find(currentId); if(!t) return back();
    setTopOffset();
    const hasPapers = (t.images || []).length > 0;
    if(detailTab === 'papers' && !hasPapers) detailTab = 'overview';
    const d = $('txDetailView');
    d.innerHTML = `
      <div class="tx-back-row"><button type="button" class="pill-btn" onclick="Tests.back()">${ico('left', 13)}All tests</button></div>
      <div class="panel tx-hero" id="txHero"></div>
      <div class="tx-dtabs-wrap" id="txDTabsWrap"><nav class="tx-tabs tx-dtabs" id="txDTabs" role="tablist" aria-label="Test sections"></nav></div>
      <div class="tx-detail-grid" id="txDGrid">
        <div class="panel tx-sec tx-area-desc" data-sec="overview">
          <div class="panel-head"><p class="panel-title">${ico('text', 14)}Description</p><span class="tx-saved" id="txDescStatus" aria-live="polite"></span></div>
          <textarea id="txDesc" rows="4" maxlength="2000" placeholder="Add notes about this test — how it went, topics covered, what to revisit…"></textarea>
        </div>
        <div class="panel tx-sec tx-area-qs" data-sec="questions" id="txQPanel"></div>
        <div class="panel tx-sec tx-area-err" data-sec="mistakes" id="txErrPanel"></div>
        <div class="panel tx-sec tx-area-voice" data-sec="voice" id="txVoicePanel"></div>
        ${hasPapers ? '<div class="panel tx-sec tx-area-img" data-sec="papers" id="txImgPanel"></div>' : ''}
      </div>`;
    const ta = $('txDesc'); ta.value = t.description || '';
    const status = $('txDescStatus');
    const saveDesc = Utils.debounce(() => {
      const val = ta.value;
      if(update(currentId, x => { x.description = val; })){ status.innerHTML = ico('check', 12) + 'Saved'; status.classList.add('show'); setTimeout(() => status.classList.remove('show'), 1600); }
    }, 600);
    ta.addEventListener('input', () => { status.textContent = 'Saving…'; status.classList.add('show'); saveDesc(); });
    renderHero(true);
    renderQuestions();
    if(hasPapers) renderImages();
    renderVoices();
    renderMistakes();
    document.querySelectorAll('#txDGrid .tx-sec').forEach(s => s.classList.toggle('tx-dactive', s.dataset.sec === detailTab));
    updateDetailTabs();
  }

  function renderQuestions(){
    const panel = $('txQPanel'); if(!panel) return;
    const t = find(currentId); if(!t) return;
    const n = (t.questions || []).length;
    panel.innerHTML = `
      <div class="panel-head"><div><p class="panel-title">${ico('list', 14)}Questions</p>
        <p class="panel-sub">${plural(n, 'question')}</p></div></div>
      ${optsHtml('detail', n > 0)}
      ${n ? questionListHtml('detail') : `<div class="tx-empty small"><div class="tx-empty-ico">${ico('list', 24)}</div><p>No questions yet. Attach question photos or extract a whole paper into editable questions.</p></div>`}`;
    hydrateThumbs(panel);
  }

  /* single-image viewer (question photos) */
  async function viewSingle(src, name){
    const o = ensureOverlay('txViewer', 'tx-viewer');
    o.firstElementChild.innerHTML = `
      <div class="tx-viewer-head">
        <span class="tx-viewer-name">${esc(name || 'Photo')}</span>
        <div class="tx-viewer-tools">
          <a class="tx-icon-btn" id="txViewerDl" download="${esc(name || 'photo')}" aria-label="Download">${ico('download', 15)}</a>
          <button type="button" class="tx-icon-btn" aria-label="Close" onclick="Tests.closeViewer()">${ico('x', 15)}</button>
        </div>
      </div>
      <div class="tx-viewer-stage"><span class="tx-skel"></span><img id="txViewerImg" alt="${esc(name || 'Photo')}" hidden>
        <div class="tx-img-miss big" id="txViewerMiss" hidden>${ico('image', 30)}<small>This image isn't stored on this device.</small></div></div>`;
    o.onclick = e => { if(e.target === o) closeViewer(); };
    o.classList.add('open');
    viewerIdx = -1;
    const url = src.url || await mediaUrl(src.key);
    const el = $('txViewerImg'); if(!el) return;
    const skel = o.querySelector('.tx-viewer-stage .tx-skel'); if(skel) skel.remove();
    if(url){ el.src = url; el.hidden = false; $('txViewerDl').href = url; } else $('txViewerMiss').hidden = false;
  }

  function renderHero(animate){
    const el = $('txHero'); if(!el) return;
    const t = find(currentId); if(!t) return;
    const p = pctOf(t), cls = pctClass(p), col = subjectColor(t.subject);
    const C = 2 * Math.PI * 42;
    const fill = Utils.clamp(p, 0, 100) / 100;
    const mis = (t.mistakes || []).length, unres = unresolvedCount(t);
    const lt = linkedTask(t);
    el.style.setProperty('--sc', col);
    el.innerHTML = `
      <div class="tx-hero-main">
        <div class="tx-hero-top">
          <span class="tx-chip subj"><i></i>${esc(t.subject || 'General')}</span>
        </div>
        <h2 class="tx-hero-name">${esc(t.name)}</h2>
        <div class="tx-meta-item">${ico('calendar', 13)}${esc(fmtDayLong(t.date))}</div>
        ${chaptersOf(t).length ? `<div class="tx-hero-chaps">${chapChips(t, 0)}</div>` : ''}
        <div class="tx-card-foot">
          <span class="tx-pill ${mis ? 'err' : 'ok'}">${ico(mis ? 'alert' : 'check', 12)}${plural(mis, 'mistake')}</span>
          ${unres ? `<span class="tx-pill warn">${unres} unresolved</span>` : (mis ? '<span class="tx-pill ok">All resolved</span>' : '')}
          ${lt ? `<button type="button" class="tx-pill link" onclick="App.setPage('dashboard')" title="Open Mission Control">${ico('link', 12)}Mission: ${esc(lt.title)}</button>` : ''}
        </div>
        <div class="tx-hero-actions">
          <button type="button" class="pill-btn" onclick="Tests.openEdit('${t.id}')">${ico('edit', 13)}Edit details</button>
          <button type="button" class="pill-btn tx-danger-outline" onclick="Tests.remove('${t.id}')">${ico('trash', 13)}Delete</button>
        </div>
      </div>
      <div class="tx-hero-score">
        <div class="tx-ring ${cls}" role="img" aria-label="Score ${fmtNum(t.marks)} out of ${fmtNum(t.maxMarks)}, ${fmtPct(p)}">
          <svg viewBox="0 0 100 100" width="132" height="132">
            <circle cx="50" cy="50" r="42" class="tx-ring-bg"/>
            <circle cx="50" cy="50" r="42" class="tx-ring-fg" id="txRingFg" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${animate ? C.toFixed(2) : (C * (1 - fill)).toFixed(2)}" transform="rotate(-90 50 50)"/>
          </svg>
          <div class="tx-ring-label"><b>${fmtPct(p)}</b><span>${fmtNum(t.marks)} / ${fmtNum(t.maxMarks)}</span></div>
        </div>
      </div>`;
    if(animate){
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const fg = $('txRingFg'); if(fg) fg.setAttribute('stroke-dashoffset', (C * (1 - fill)).toFixed(2));
      }));
    }
    updateDetailTabs();
  }

  /* ---------------- images + OCR ---------------- */
  let uploadingImages = 0;

  function ocrBlockHtml(img){
    const st = ocr.state[img.id];
    if(st && st.status === 'processing'){
      return `<div class="tx-ocr-status"><span class="tx-spin"></span><span class="tx-ocr-msg">Extracting text… <b class="tx-ocr-pct">${st.progress}%</b></span></div>
        <div class="tx-bar"><i style="width:${st.progress}%"></i></div>`;
    }
    if(st && st.status === 'queued'){
      return `<div class="tx-ocr-status"><span class="tx-spin"></span><span class="tx-ocr-msg">${ocr.engineLoading ? 'Loading text engine (first use may take a moment)…' : 'Waiting in queue…'}</span></div>`;
    }
    if(st && st.status === 'failed'){
      return `<div class="tx-ocr-status err">${ico('alert', 14)}<span class="tx-ocr-msg">${esc(st.error || 'Text extraction failed.')}</span></div>
        <button type="button" class="pill-btn" onclick="Tests.runOcr('${img.id}')">${ico('refresh', 12)}Retry</button>`;
    }
    if(img.ocrStatus === 'done' || img.ocrStatus === 'empty'){
      const txt = img.ocrText || '';
      return `<div class="tx-ocr-head">
          <label for="ocr-${img.id}">Extracted text <span class="tx-hint">(editable)</span></label>
          <div class="tx-ocr-tools">
            <button type="button" class="tx-mini" onclick="Tests.copyOcr('${img.id}')" aria-label="Copy text">${ico('copy', 13)}Copy</button>
            <button type="button" class="tx-mini" onclick="Tests.runOcr('${img.id}')" aria-label="Re-run text extraction">${ico('refresh', 13)}Re-run</button>
          </div>
        </div>
        ${img.ocrStatus === 'empty' && !txt ? '<div class="tx-hint tx-warn-line">No readable text was found. Try a sharper, well-lit photo — or type the text below.</div>' : ''}
        <textarea id="ocr-${img.id}" class="tx-ocr-text" rows="5" maxlength="${OCR_TEXT_CAP}" data-img="${img.id}" placeholder="Type or paste text…">${esc(txt)}</textarea>
        <div class="tx-ocr-foot"><span class="tx-saved" id="ocrSaved-${img.id}"></span>${img.ocrTruncated ? `<span class="tx-hint">Truncated to ${OCR_TEXT_CAP.toLocaleString()} characters</span>` : ''}</div>`;
    }
    return `<button type="button" class="pill-btn primary" onclick="Tests.runOcr('${img.id}')">${ico('text', 13)}Extract text (OCR)</button>`;
  }

  function imageCardHtml(img, idx){
    return `<div class="tx-img" data-img="${img.id}">
      <button type="button" class="tx-img-thumb" onclick="Tests.viewImage(${idx})" aria-label="View ${esc(img.name)}">
        <span class="tx-skel"></span><img alt="${esc(img.name)}" data-thumb="${img.id}" hidden>
        <span class="tx-img-miss" hidden>${ico('image', 22)}<small>Not on this device</small></span>
      </button>
      <div class="tx-img-info">
        <div class="tx-img-name" title="${esc(img.name)}">${esc(img.name)}</div>
        <div class="tx-hint">${fmtBytes(img.size)}</div>
      </div>
      <div class="tx-img-actions">
        <button type="button" class="tx-mini" onclick="Tests.viewImage(${idx})">${ico('image', 13)}View</button>
        <button type="button" class="tx-mini" onclick="Tests.replaceImage('${img.id}')">${ico('swap', 13)}Replace</button>
        <button type="button" class="tx-mini danger" onclick="Tests.deleteImage('${img.id}')">${ico('trash', 13)}Delete</button>
      </div>
      <div class="tx-ocr">${ocrBlockHtml(img)}</div>
    </div>`;
  }

  async function hydrateThumbs(root){
    const imgs = [...root.querySelectorAll('img[data-thumb]')];
    await Promise.all(imgs.map(async el => {
      const url = await mediaUrl(K_THUMB(el.dataset.thumb));
      const wrap = el.closest('.tx-img-thumb'); if(!wrap) return;
      const skel = wrap.querySelector('.tx-skel'); if(skel) skel.remove();
      if(url){ el.src = url; el.hidden = false; }
      else { const m = wrap.querySelector('.tx-img-miss'); if(m) m.hidden = false; }
    }));
  }

  function renderImages(){
    const panel = $('txImgPanel'); if(!panel) return;
    const t = find(currentId); if(!t) return;
    const imgs = t.images || [];
    panel.innerHTML = `
      <div class="panel-head"><div><p class="panel-title">${ico('image', 14)}Earlier Uploads</p>
        <p class="panel-sub">${plural(imgs.length, 'image')} added before question management — add new questions from the Questions tab</p></div></div>
      <div class="tx-img-grid">${imgs.map(imageCardHtml).join('')}</div>`;
    panel.querySelectorAll('.tx-ocr-text').forEach(bindOcrTextarea);
    hydrateThumbs(panel);
  }

  function bindOcrTextarea(ta){
    const imgId = ta.dataset.img;
    const saved = $('ocrSaved-' + imgId);
    const save = Utils.debounce(() => {
      const val = ta.value;
      const ok = update(currentId, t => { const im = (t.images || []).find(i => i.id === imgId); if(im){ im.ocrText = val; im.ocrStatus = val.trim() ? 'done' : 'empty'; im.ocrEdited = true; } });
      if(ok && saved){ saved.innerHTML = ico('check', 12) + 'Saved'; saved.classList.add('show'); setTimeout(() => saved.classList.remove('show'), 1500); }
    }, 600);
    ta.addEventListener('input', () => { if(saved){ saved.textContent = 'Saving…'; saved.classList.add('show'); } save(); });
  }

  function refreshOcrUI(imgId){
    if(view !== 'detail') return;
    const card = document.querySelector(`.tx-img[data-img="${imgId}"]`); if(!card) return;
    const t = find(currentId); if(!t) return;
    const img = (t.images || []).find(i => i.id === imgId); if(!img) return;
    const box = card.querySelector('.tx-ocr');
    const st = ocr.state[imgId];
    if(st && st.status === 'processing' && box.querySelector('.tx-bar')){
      box.querySelector('.tx-bar i').style.width = st.progress + '%';
      const pct = box.querySelector('.tx-ocr-pct'); if(pct) pct.textContent = st.progress + '%';
      return;
    }
    box.innerHTML = ocrBlockHtml(img);
    const ta = box.querySelector('.tx-ocr-text'); if(ta) bindOcrTextarea(ta);
  }
  function refreshAllOcrUI(){
    if(view !== 'detail') return;
    const t = find(currentId); if(!t) return;
    (t.images || []).forEach(i => { if(ocr.state[i.id]) refreshOcrUI(i.id); });
  }

  function runOcr(imgId){
    const t = find(currentId); if(!t) return;
    const img = (t.images || []).find(i => i.id === imgId); if(!img) return;
    if(img.ocrText && img.ocrEdited){
      confirmDialog({ title:'Re-run text extraction?', message:'This replaces the extracted text, including any edits you made.', confirmText:'Re-run' })
        .then(ok => { if(ok) queueOcr(currentId, imgId); });
      return;
    }
    queueOcr(currentId, imgId);
  }
  function copyOcr(imgId){
    const t = find(currentId); const img = t && (t.images || []).find(i => i.id === imgId);
    const ta = document.getElementById('ocr-' + imgId);
    const text = ta ? ta.value : (img && img.ocrText) || '';
    if(!text){ Utils.toast('Nothing to copy yet.', 'info'); return; }
    const done = () => Utils.toast('Text copied', 'success');
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => Utils.toast('Could not copy.', 'error'));
    else { try{ ta.select(); document.execCommand('copy'); done(); }catch(e){ Utils.toast('Could not copy.', 'error'); } }
  }

  function replaceImage(imgId){
    const t = find(currentId); const img = t && (t.images || []).find(i => i.id === imgId); if(!img) return;
    const go = () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
      input.onchange = async () => {
        const f = input.files[0]; if(!f) return;
        const err = validateImage(f); if(err){ Utils.toast(err, 'error'); return; }
        try{
          const { blob, thumb } = await processImage(f);
          dropUrl(K_IMG(imgId)); dropUrl(K_THUMB(imgId));
          await AttachmentDB.put(K_IMG(imgId), blob);
          await AttachmentDB.put(K_THUMB(imgId), thumb);
          delete ocr.state[imgId];
          update(currentId, tt => {
            const im = (tt.images || []).find(i => i.id === imgId);
            if(im){ im.name = f.name || im.name; im.size = blob.size; im.type = blob.type || im.type; im.ocrText = ''; delete im.ocrStatus; delete im.ocrEdited; delete im.ocrTruncated; }
          });
          Utils.toast('Image replaced', 'success');
          renderImages(); queueOcr(currentId, imgId);
        }catch(e){ Utils.toast('Could not replace the image.', 'error'); }
      };
      input.click();
    };
    if(img.ocrText){
      confirmDialog({ title:'Replace this image?', message:'Its extracted text will be cleared and re-extracted from the new image.', confirmText:'Choose new image' }).then(ok => { if(ok) go(); });
    } else go();
  }

  async function deleteImage(imgId){
    const ok = await confirmDialog({ title:'Delete this image?', message:'The image and its extracted text will be permanently removed.', confirmText:'Delete', danger:true });
    if(!ok) return;
    await dropMedia(K_IMG(imgId)); await dropMedia(K_THUMB(imgId));
    delete ocr.state[imgId];
    update(currentId, t => { t.images = (t.images || []).filter(i => i.id !== imgId); });
    Utils.toast('Image deleted', 'success');
    renderImages();
  }

  /* ---------------- full-size viewer ---------------- */
  let viewerIdx = 0;
  async function viewImage(idx){
    const t = find(currentId); if(!t || !(t.images || []).length) return;
    const n = t.images.length;
    viewerIdx = (idx + n) % n;
    const img = t.images[viewerIdx];
    const o = ensureOverlay('txViewer', 'tx-viewer');
    o.firstElementChild.innerHTML = `
      <div class="tx-viewer-head">
        <span class="tx-viewer-name">${esc(img.name)} <small>(${viewerIdx + 1}/${n})</small></span>
        <div class="tx-viewer-tools">
          <a class="tx-icon-btn" id="txViewerDl" download="${esc(img.name)}" aria-label="Download">${ico('download', 15)}</a>
          <button type="button" class="tx-icon-btn" aria-label="Close" onclick="Tests.closeViewer()">${ico('x', 15)}</button>
        </div>
      </div>
      <div class="tx-viewer-stage">
        ${n > 1 ? `<button type="button" class="tx-nav prev" aria-label="Previous image" onclick="Tests.viewImage(${viewerIdx - 1})">${ico('left', 20)}</button>` : ''}
        <span class="tx-skel"></span><img id="txViewerImg" alt="${esc(img.name)}" hidden>
        <div class="tx-img-miss big" id="txViewerMiss" hidden>${ico('image', 30)}<small>This image isn't stored on this device.</small></div>
        ${n > 1 ? `<button type="button" class="tx-nav next" aria-label="Next image" onclick="Tests.viewImage(${viewerIdx + 1})">${ico('right', 20)}</button>` : ''}
      </div>`;
    o.onclick = e => { if(e.target === o) closeViewer(); };
    o.classList.add('open');
    const url = await mediaUrl(K_IMG(img.id));
    const el = $('txViewerImg'); if(!el || viewerIdx < 0) return;
    const skel = o.querySelector('.tx-viewer-stage .tx-skel'); if(skel) skel.remove();
    if(url){ el.src = url; el.hidden = false; const dl = $('txViewerDl'); if(dl) dl.href = url; }
    else { $('txViewerMiss').hidden = false; }
  }
  function closeViewer(){ const o = $('txViewer'); if(o) o.classList.remove('open'); }

  /* =========================================================
     Voice notes (detail page + shared recorder UI)
     ========================================================= */
  let recState = { active:false, where:null, sec:0 };
  const ctlId = where => where === 'detail' ? 'txVoiceCtl' : 'txFormVoiceCtl';

  function recCtlHtml(where){
    if(recState.active && recState.where === where){
      return `<div class="tx-rec-bar" role="status" aria-live="polite">
        <span class="tx-rec-dot"></span><span class="tx-rec-label">Recording</span>
        <span class="tx-rec-time" id="txRecTime-${where}">${fmtClock(recState.sec)}</span>
        <button type="button" class="pill-btn tx-danger" onclick="Tests.recStop('${where}')">${ico('stop', 12)}Stop &amp; save</button>
        <button type="button" class="pill-btn" onclick="Tests.recCancel('${where}')">Cancel</button>
      </div>`;
    }
    const busy = recState.active;
    return `<div class="tx-voice-btns">
      <button type="button" class="pill-btn primary" onclick="Tests.recStart('${where}')" ${busy ? 'disabled' : ''}>${ico('mic', 13)}Record voice note</button>
      <label class="pill-btn tx-upload">${ico('upload', 13)}Upload audio<input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac,.webm,.flac" multiple hidden onchange="Tests.voiceUpload('${where}', this)"></label>
    </div>`;
  }
  function renderRecCtl(where){
    const el = $(ctlId(where)); if(el) el.innerHTML = recCtlHtml(where);
  }
  async function recStart(where){
    if(Rec.isActive()) return;
    if(!Rec.supported()){ Utils.toast(micErrorMessage({ message:'unsupported' }), 'error'); return; }
    try{
      await Rec.start(sec => {
        recState.sec = sec;
        const el = $('txRecTime-' + recState.where); if(el) el.textContent = fmtClock(sec);
      });
    }catch(e){ Utils.toast(micErrorMessage(e), 'error'); return; }
    recState = { active:true, where, sec:0 };
    renderRecCtl(where);
    if(where === 'detail') renderRecCtl('form');
  }
  function voiceName(){
    return 'Voice note · ' + new Date().toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
  }
  async function recStop(where){
    const res = await Rec.stop();
    recState = { active:false, where:null, sec:0 };
    renderRecCtl('detail'); renderRecCtl('form');
    if(!res || !res.blob || !res.blob.size){ Utils.toast('Nothing was recorded.', 'info'); return; }
    await addVoice(where, { id:Utils.uid(), blob:res.blob, name:voiceName(), duration:res.duration });
  }
  function recCancel(where){
    Rec.cancel();
    recState = { active:false, where:null, sec:0 };
    renderRecCtl('detail'); renderRecCtl('form');
    Utils.toast('Recording discarded', 'info');
  }
  async function voiceUpload(where, input){
    const files = [...input.files]; input.value = '';
    for(const f of files){
      const err = validateAudio(f);
      if(err){ Utils.toast(err, 'error'); continue; }
      const dur = await audioDuration(f);
      await addVoice(where, { id:Utils.uid(), blob:f, name:(f.name || voiceName()).replace(/\.[a-z0-9]+$/i, ''), duration:dur });
    }
  }
  async function addVoice(where, v){
    if(where === 'detail'){
      try{
        const meta = await storeVoice(v);
        update(currentId, t => { t.voices = (t.voices || []).concat([meta]); });
        Utils.toast('Voice note saved', 'success');
        if(view === 'detail'){ renderVoices(); renderHero(); }
      }catch(e){
        Utils.toast(e && e.name === 'QuotaExceededError' ? 'Not enough storage space on this device.' : 'Could not save the voice note.', 'error');
      }
    } else if(draft){
      draft.voices.push(v); draft.dirty = true;
      renderFormVoices();
    }
  }

  function renderVoices(){
    const panel = $('txVoicePanel'); if(!panel) return;
    const t = find(currentId); if(!t) return;
    stopAllAudio();
    const vs = t.voices || [];
    panel.innerHTML = `
      <div class="panel-head"><div><p class="panel-title">${ico('mic', 14)}Voice Notes</p><p class="panel-sub">${plural(vs.length, 'recording')}</p></div></div>
      <div id="txVoiceCtl">${recCtlHtml('detail')}</div>
      <div class="tx-voice-list">${vs.length ? vs.map(v => playerHtml(v.id, v.name, v.duration,
        `<button type="button" class="tx-icon-btn danger" aria-label="Delete ${esc(v.name)}" onclick="Tests.deleteVoice('${v.id}')">${ico('trash', 14)}</button>`)).join('')
        : `<div class="tx-empty small"><div class="tx-empty-ico">${ico('mic', 24)}</div><p>No voice notes yet. Record how you felt about the test or explain a tricky solution out loud.</p></div>`}
      </div>`;
    bindPlayers(panel, id => mediaUrl(K_AUD(id)));
  }
  async function deleteVoice(id){
    const ok = await confirmDialog({ title:'Delete this voice note?', message:'The recording will be permanently removed.', confirmText:'Delete', danger:true });
    if(!ok) return;
    stopAllAudio();
    await dropMedia(K_AUD(id));
    update(currentId, t => { t.voices = (t.voices || []).filter(v => v.id !== id); });
    Utils.toast('Voice note deleted', 'success');
    renderVoices(); renderHero();
  }

  /* =========================================================
     Error analysis (mistakes)
     ========================================================= */
  function typeBadge(type){
    const c = TYPE_COLORS[type] || TYPE_COLORS.Other;
    return `<span class="tx-badge" style="--tc:${c}">${esc(type || 'Other')}</span>`;
  }

  function renderMistakes(){
    const panel = $('txErrPanel'); if(!panel) return;
    const t = find(currentId); if(!t) return;
    const list = t.mistakes || [];
    const total = list.length, unres = list.filter(m => !m.resolved).length, res = total - unres;
    const byType = {};
    list.forEach(m => { byType[m.type] = (byType[m.type] || 0) + 1; });
    const f = mistakeView;
    const shown = list.map((m, i) => ({ m, n:i + 1 })).filter(({ m }) =>
      (f.status === 'all' || (f.status === 'unresolved') === !m.resolved) && (!f.type || m.type === f.type));

    panel.innerHTML = `
      <div class="panel-head">
        <div>
          <p class="panel-title">${ico('alert', 14)}Error Analysis</p>
          <p class="panel-sub"><b>${plural(total, 'mistake')}</b> total${total ? ` · <span class="${unres ? 'tx-unres' : 'tx-allres'}">${unres ? unres + ' unresolved' : 'all resolved'}</span>` : ''}</p>
        </div>
        <button type="button" class="pill-btn primary" onclick="Tests.openMistake({mode:'detail'})">${ico('plus', 13)}Add mistake</button>
      </div>
      ${total ? `
      <div class="tx-mis-filters">
        <div class="tx-seg" role="group" aria-label="Filter mistakes by status">
          ${[['all', 'All', total], ['unresolved', 'Unresolved', unres], ['resolved', 'Resolved', res]].map(([k, l, c]) =>
            `<button type="button" class="${f.status === k ? 'active' : ''}" aria-pressed="${f.status === k}" onclick="Tests.setMistakeStatus('${k}')">${l}<em>${c}</em></button>`).join('')}
        </div>
        <select aria-label="Filter by mistake type" onchange="Tests.setMistakeType(this.value)">
          <option value="">All types</option>${MISTAKE_TYPES.filter(x => byType[x]).map(x => `<option ${f.type === x ? 'selected' : ''} value="${esc(x)}">${esc(x)} (${byType[x]})</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="tx-mis-list">
        ${!total ? `<div class="tx-empty small"><div class="tx-empty-ico">${ico('check', 24)}</div><p>No mistakes logged. Add the questions you got wrong — and what you learned — to turn them into marks next time.</p></div>`
          : (!shown.length ? `<div class="tx-empty small"><p>No mistakes match this filter.</p></div>` : shown.map(({ m, n }) => mistakeHtml(m, n)).join(''))}
      </div>`;
  }

  function mistakeHtml(m, n){
    const exp = expandedMistakes.has(m.id);
    const row = (label, val) => `<div class="tx-mis-row"><span class="tx-mis-label">${label}</span><div class="tx-mis-val ${val ? '' : 'empty'}">${val ? esc(val) : 'Not provided'}</div></div>`;
    return `<div class="tx-mis ${m.resolved ? 'resolved' : 'unresolved'} ${exp ? 'expanded' : ''}" data-id="${m.id}" style="--tc:${TYPE_COLORS[m.type] || TYPE_COLORS.Other}">
      <div class="tx-mis-head" role="button" tabindex="0" aria-expanded="${exp}" aria-controls="mis-body-${m.id}"
        onclick="Tests.toggleMistake('${m.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();Tests.toggleMistake('${m.id}')}">
        <span class="tx-mis-num">${n}</span>
        <div class="tx-mis-title">${esc(m.question)}</div>
        ${typeBadge(m.type)}
        <span class="tx-mis-state ${m.resolved ? 'ok' : 'warn'}">${ico(m.resolved ? 'check' : 'alert', 12)}<span>${m.resolved ? 'Resolved' : 'Unresolved'}</span></span>
        <span class="tx-chev">${ico('chevron', 16)}</span>
      </div>
      <div class="tx-mis-body" id="mis-body-${m.id}"><div class="tx-mis-body-in">
        ${row('Question', m.question)}
        ${row('My attempted answer', m.attempted)}
        ${row('Correct answer', m.correct)}
        ${row('Explanation', m.explanation)}
        ${row('What I learned', m.learned)}
        <div class="tx-mis-actions">
          <button type="button" class="pill-btn ${m.resolved ? '' : 'primary'}" onclick="Tests.toggleResolved('${m.id}')">${ico('check', 12)}${m.resolved ? 'Reopen' : 'Mark resolved'}</button>
          <button type="button" class="pill-btn" onclick="Tests.openMistake({mode:'detail',id:'${m.id}'})">${ico('edit', 12)}Edit</button>
          <button type="button" class="pill-btn tx-danger-outline" onclick="Tests.deleteMistake('${m.id}')">${ico('trash', 12)}Delete</button>
        </div>
      </div></div>
    </div>`;
  }

  function toggleMistake(id){
    const el = document.querySelector(`.tx-mis[data-id="${id}"]`); if(!el) return;
    const on = !el.classList.contains('expanded');
    el.classList.toggle('expanded', on);
    el.querySelector('.tx-mis-head').setAttribute('aria-expanded', String(on));
    if(on) expandedMistakes.add(id); else expandedMistakes.delete(id);
  }
  function setMistakeStatus(s){ mistakeView.status = s; renderMistakes(); }
  function setMistakeType(v){ mistakeView.type = v; renderMistakes(); }
  function toggleResolved(id){
    update(currentId, t => {
      const m = (t.mistakes || []).find(x => x.id === id);
      if(m){ m.resolved = !m.resolved; m.resolvedAt = m.resolved ? Date.now() : undefined; }
    });
    renderMistakes(); renderHero();
    const m = (find(currentId).mistakes || []).find(x => x.id === id);
    if(m) Utils.toast(m.resolved ? 'Marked as resolved' : 'Mistake reopened', 'success');
  }
  async function deleteMistake(id){
    const ok = await confirmDialog({ title:'Delete this mistake?', message:'This removes it from the error analysis for good.', confirmText:'Delete', danger:true });
    if(!ok) return;
    update(currentId, t => { t.mistakes = (t.mistakes || []).filter(m => m.id !== id); });
    expandedMistakes.delete(id);
    renderMistakes(); renderHero();
    Utils.toast('Mistake deleted', 'success');
  }

  /* ---------------- mistake modal (detail + draft) ---------------- */
  let mctx = null;
  function openMistake(ctx){
    mctx = ctx || { mode:'detail' };
    let m = null;
    if(mctx.id){
      m = mctx.mode === 'draft'
        ? draft.mistakes.find(x => x.id === mctx.id)
        : ((find(currentId) || {}).mistakes || []).find(x => x.id === mctx.id);
    }
    const o = ensureOverlay('txMistakeModal', 'tx-modal tx-mistake-modal');
    const box = o.firstElementChild;
    box.setAttribute('aria-labelledby', 'txMTitle');
    const ta = (id, label, val, ph, rows) => `<div class="field"><label for="${id}">${label}</label><textarea id="${id}" rows="${rows || 2}" maxlength="2000" placeholder="${ph}">${esc(val || '')}</textarea></div>`;
    box.innerHTML = `
      <h3 id="txMTitle">${m ? 'Edit mistake' : 'Add mistake'}</h3>
      <p>Capture what went wrong so you don't repeat it.</p>
      <div class="tx-form">
        <div class="field" id="fld-tmQ"><label for="tmQ">Question *</label><textarea id="tmQ" rows="3" maxlength="2000" placeholder="Paste or describe the question…">${esc(m ? m.question : ((mctx.prefill && mctx.prefill.question) || ''))}</textarea><div class="tx-err" id="err-tmQ"></div></div>
        <div class="field-row">
          ${ta('tmAtt', 'My attempted answer', m && m.attempted, 'What I wrote / did…')}
          ${ta('tmCor', 'Correct answer', m && m.correct, 'The right answer…')}
        </div>
        <div class="field"><label for="tmType">Mistake type</label>
          <select id="tmType">${MISTAKE_TYPES.map(x => `<option ${m && m.type === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        ${ta('tmExp', 'Explanation', m && m.explanation, 'Why was my answer wrong?', 3)}
        ${ta('tmLearn', 'What I learned', m && m.learned, 'Key takeaway for next time…', 3)}
        <label class="tx-check"><input type="checkbox" id="tmRes" ${m && m.resolved ? 'checked' : ''}><span>Mark as resolved</span></label>
      </div>
      <div class="modal-actions">
        <button type="button" class="pill-btn" onclick="Tests.closeMistake()">Cancel</button>
        <button type="button" class="pill-btn primary" onclick="Tests.saveMistake()">${m ? 'Save changes' : 'Add mistake'}</button>
      </div>`;
    o.onclick = e => { if(e.target === o) closeMistake(); };
    o.classList.add('open');
    setTimeout(() => { const q = $('tmQ'); if(q) q.focus(); }, 60);
    $('tmQ').addEventListener('input', () => setErr('tmQ', ''));
  }
  function closeMistake(){ const o = $('txMistakeModal'); if(o) o.classList.remove('open'); mctx = null; }

  function saveMistake(){
    const q = $('tmQ').value.trim();
    if(!q){ setErr('tmQ', 'Please enter the question.'); Utils.shakeElement($('tmQ')); $('tmQ').focus(); return; }
    const data = {
      question:q, attempted:$('tmAtt').value.trim(), correct:$('tmCor').value.trim(), type:$('tmType').value,
      explanation:$('tmExp').value.trim(), learned:$('tmLearn').value.trim(), resolved:$('tmRes').checked
    };
    const ctx = mctx; if(!ctx) return;
    let newId = ctx.id;
    if(ctx.mode === 'draft'){
      if(ctx.id){
        const m = draft.mistakes.find(x => x.id === ctx.id);
        if(m){ Object.assign(m, data); if(data.resolved && !m.resolvedAt) m.resolvedAt = Date.now(); if(!data.resolved) delete m.resolvedAt; }
      } else {
        newId = Utils.uid();
        draft.mistakes.push(Object.assign({ id:newId, createdAt:Date.now() }, data, data.resolved ? { resolvedAt:Date.now() } : {}));
      }
      draft.dirty = true;
      closeMistake(); renderFormMistakes();
      return;
    }
    if(!find(currentId)){ closeMistake(); return; }
    update(currentId, t => {
      t.mistakes = t.mistakes || [];
      if(ctx.id){
        const m = t.mistakes.find(x => x.id === ctx.id);
        if(m){ Object.assign(m, data); if(data.resolved && !m.resolvedAt) m.resolvedAt = Date.now(); if(!data.resolved) delete m.resolvedAt; }
      } else {
        newId = Utils.uid();
        t.mistakes.push(Object.assign({ id:newId, createdAt:Date.now() }, data, data.resolved ? { resolvedAt:Date.now() } : {}));
      }
    });
    closeMistake();
    expandedMistakes.add(newId);
    mistakeView = { status:'all', type:'' };
    renderMistakes(); renderHero();
    Utils.toast(ctx.id ? 'Mistake updated' : 'Mistake added', 'success');
    const el = document.querySelector(`.tx-mis[data-id="${newId}"]`);
    if(el) el.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }

  /* shared inline-error helper for every form */
  function setErr(fieldId, msg){
    const e = $('err-' + fieldId), f = $('fld-' + fieldId) || ($(fieldId) && $(fieldId).closest('.field'));
    if(e) e.textContent = msg || '';
    if(f) f.classList.toggle('has-error', !!msg);
    const inp = $(fieldId); if(inp){ if(msg) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
  }

  /* =========================================================
     Question splitting (Option B: Extract Test from Image)
     Heuristic splitter for OCR text of a whole test paper.
     ========================================================= */
  function splitQuestions(raw){
    const text = String(raw || '').replace(/\r/g, '').replace(/\u00a0/g, ' ').replace(/(\w)-\n(\w)/g, '$1$2');
    const lines = text.split('\n');
    const reQ = /^\s*(?:Question|Ques|Q)\s*\.?\s*(\d{1,3})\s*[.):\]\-–]?\s*(.*)$/i;           // Q1. / Question 2: / Q 3)
    const rePlain = /^\s*(\d{1,3})\s*[.)\]:]\s+(\S.*)$/;                                       // 1. text / 2) text
    const reParen = /^\s*\((\d{1,3})\)\s*(\S.*)$/;                                             // (1) text
    const cands = [];
    lines.forEach((ln, i) => {
      let m;
      if((m = reQ.exec(ln))) cands.push({ i, n:+m[1], rest:m[2], style:'q' });
      else if((m = rePlain.exec(ln))) cands.push({ i, n:+m[1], rest:m[2], style:'plain' });
      else if((m = reParen.exec(ln))) cands.push({ i, n:+m[1], rest:m[2], style:'paren' });
    });
    // use the dominant numbering style only (so "(1) (2) (3) (4)" answer options aren't mistaken for questions)
    const count = st => cands.filter(c => c.style === st).length;
    let style = null;
    for(const st of ['q', 'plain', 'paren']) if(count(st) >= 2){ style = st; break; }
    if(!style) style = ['q', 'plain', 'paren'].find(st => count(st) >= 1) || null;
    const pool = style ? cands.filter(c => c.style === style) : [];
    // keep a sensible numbering sequence (tolerate one missed marker, allow section restarts at 1)
    const acc = []; let last = 0; const missing = [];
    pool.forEach(c => {
      const ok = acc.length === 0 ? c.n <= 3
        : (c.n === last + 1 || c.n === last + 2 || (c.n === 1 && last >= 2 && style !== 'paren'));
      if(ok){
        if(acc.length && c.n === last + 2) missing.push(last + 1);
        acc.push(c); last = c.n;
      }
    });
    const clean = s => s.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    if(acc.length >= 1 && !(acc.length === 1 && pool.length === 1 && style === 'paren')){
      const qs = acc.map((c, k) => {
        const end = k + 1 < acc.length ? acc[k + 1].i : lines.length;
        return clean([c.rest].concat(lines.slice(c.i + 1, end)).join('\n'));
      }).filter(Boolean);
      return { questions:qs, method:'numbered', missing, preamble:clean(lines.slice(0, acc[0].i).join('\n')) };
    }
    const paras = text.split(/\n\s*\n/).map(clean).filter(p => p.length >= 20);
    if(paras.length >= 2) return { questions:paras, method:'paragraphs', missing:[], preamble:'' };
    const whole = clean(text);
    return { questions:whole ? [whole] : [], method:'single', missing:[], preamble:'' };
  }

  /* =========================================================
     Questions (shared by the form and the details page)
     ctx = 'draft' (unsaved form)  |  'detail' (saved test)
     ========================================================= */
  const qOf = ctx => ctx === 'draft' ? (draft ? draft.questions : []) : ((find(currentId) || {}).questions || []);
  function qCommit(ctx, fn){
    if(ctx === 'draft'){ fn(draft.questions); draft.dirty = true; renderFormQuestions(); }
    else { update(currentId, t => { t.questions = t.questions || []; fn(t.questions); }); renderQuestions(); renderHero(); }
  }
  function qNewId(){ return Utils.uid(); }

  function optsHtml(ctx, compact){
    return `<div class="tx-opts ${compact ? 'compact' : ''}">
      <div class="tx-opt">
        <div class="tx-opt-tag">Option A</div>
        <div class="tx-opt-ico">${ico('camera', 20)}</div>
        <h4>Upload Question Photo</h4>
        <p>Attach a photo of one individual question. The image stays attached to that question.</p>
        <button type="button" class="pill-btn primary" onclick="Tests.openPhotoQuestion('${ctx}')">${ico('upload', 13)}Upload question photo</button>
      </div>
      <div class="tx-opt">
        <div class="tx-opt-tag alt">Option B</div>
        <div class="tx-opt-ico alt">${ico('scan', 20)}</div>
        <h4>Extract Test from Image</h4>
        <p>Upload photos of a complete test paper. Text is recognised and split into editable questions.</p>
        <button type="button" class="pill-btn primary" onclick="Tests.openExtract('${ctx}')">${ico('scan', 13)}Extract from image</button>
      </div>
    </div>
    <div class="tx-opts-foot"><button type="button" class="tx-link" onclick="Tests.openManualQuestion('${ctx}')">${ico('plus', 12)}Add a question manually</button></div>`;
  }

  function questionCardHtml(q, i, n, ctx){
    let media = '';
    if(q.kind === 'photo'){
      if(q.image){
        media = q._file
          ? `<button type="button" class="tx-img-thumb tx-q-thumb" onclick="Tests.viewQ('${ctx}','${q.id}')" aria-label="View question photo"><img alt="Question photo" src="${draftUrl(q.image.id, q._file)}"></button>`
          : `<button type="button" class="tx-img-thumb tx-q-thumb" onclick="Tests.viewQ('${ctx}','${q.id}')" aria-label="View question photo"><span class="tx-skel"></span><img alt="Question photo" data-thumb="${q.image.id}" hidden><span class="tx-img-miss" hidden>${ico('image', 20)}<small>Not on this device</small></span></button>`;
      } else media = `<div class="tx-q-nophoto">${ico('image', 16)}No photo</div>`;
    }
    return `<div class="tx-q ${q.kind}" data-qid="${q.id}">
      <div class="tx-q-num">Q${i + 1}</div>
      <div class="tx-q-body">
        ${q.title ? `<div class="tx-q-title">${esc(q.title)}</div>` : ''}
        ${media}
        ${q.kind === 'text' ? `<div class="tx-q-text">${esc(q.text)}</div>` : ''}
        ${q.note ? `<div class="tx-q-note"><span>Answer / notes</span>${esc(q.note)}</div>` : ''}
      </div>
      <div class="tx-q-actions">
        <button type="button" class="tx-icon-btn" aria-label="Move question up" ${i === 0 ? 'disabled' : ''} onclick="Tests.qMove('${ctx}','${q.id}',-1)">${ico('up', 14)}</button>
        <button type="button" class="tx-icon-btn" aria-label="Move question down" ${i === n - 1 ? 'disabled' : ''} onclick="Tests.qMove('${ctx}','${q.id}',1)">${ico('chevron', 14)}</button>
        <button type="button" class="tx-icon-btn" aria-label="Edit question" onclick="Tests.qEdit('${ctx}','${q.id}')">${ico('edit', 14)}</button>
        ${ctx === 'detail' ? `<button type="button" class="tx-icon-btn" aria-label="Log as a mistake" data-tip="Log mistake" onclick="Tests.qToMistake('${q.id}')">${ico('alert', 14)}</button>` : ''}
        <button type="button" class="tx-icon-btn danger" aria-label="Delete question" onclick="Tests.qDelete('${ctx}','${q.id}')">${ico('trash', 14)}</button>
      </div>
    </div>`;
  }
  function questionListHtml(ctx){
    const list = qOf(ctx);
    return list.length ? `<div class="tx-q-list">${list.map((q, i) => questionCardHtml(q, i, list.length, ctx)).join('')}</div>` : '';
  }

  function qMove(ctx, id, dir){
    qCommit(ctx, arr => {
      const i = arr.findIndex(q => q.id === id), j = i + dir;
      if(i < 0 || j < 0 || j >= arr.length) return;
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    });
  }
  async function qDelete(ctx, id){
    const q = qOf(ctx).find(x => x.id === id); if(!q) return;
    const ok = await confirmDialog({ title:'Delete this question?', message:q.kind === 'photo' && q.image ? 'The question and its photo will be removed.' : 'The question will be removed.', confirmText:'Delete', danger:true });
    if(!ok) return;
    if(ctx === 'draft'){
      if(q.image){
        if(q._file){ const u = draftUrls.get(q.image.id); if(u){ URL.revokeObjectURL(u); draftUrls.delete(q.image.id); } }
        else draft.removedImages.push(q.image.id);
      }
      qCommit(ctx, arr => { const i = arr.findIndex(x => x.id === id); if(i >= 0) arr.splice(i, 1); });
    } else {
      if(q.image){ await dropMedia(K_IMG(q.image.id)); await dropMedia(K_THUMB(q.image.id)); }
      qCommit(ctx, arr => { const i = arr.findIndex(x => x.id === id); if(i >= 0) arr.splice(i, 1); });
      Utils.toast('Question deleted', 'success');
    }
  }
  function qEdit(ctx, id){
    const q = qOf(ctx).find(x => x.id === id); if(q) openQuestionModal(ctx, q.kind, q);
  }
  function qToMistake(id){
    const q = qOf('detail').find(x => x.id === id); if(!q) return;
    setDetailTab('mistakes');
    openMistake({ mode:'detail', prefill:{ question:q.kind === 'text' ? q.text : (q.title || 'Question photo'), type:'Conceptual Error' } });
  }
  function viewQ(ctx, id){
    const q = qOf(ctx).find(x => x.id === id); if(!q || !q.image) return;
    viewSingle(q._file ? { url:draftUrl(q.image.id, q._file) } : { key:K_IMG(q.image.id) }, q.title || ('Question ' + (qOf(ctx).indexOf(q) + 1)));
  }

  /* ---------------- add / edit one question (Option A + manual) ---------------- */
  let qm = null;
  function openPhotoQuestion(ctx){ openQuestionModal(ctx, 'photo', null); }
  function openManualQuestion(ctx){ openQuestionModal(ctx, 'text', null); }

  function openQuestionModal(ctx, kind, existing){
    qm = existing
      ? Object.assign({ ctx, isEdit:true, photoChanged:false }, existing)
      : { ctx, isEdit:false, id:null, kind, text:'', title:'', note:'', image:null, photoChanged:false };
    const o = ensureOverlay('txQuestionModal', 'tx-modal tx-qmodal');
    const box = o.firstElementChild;
    box.setAttribute('aria-labelledby', 'txQTitle');
    const photo = kind === 'photo';
    box.innerHTML = `
      <h3 id="txQTitle">${qm.isEdit ? 'Edit question' : (photo ? 'Upload Question Photo' : 'Add Question')}</h3>
      <p>${photo ? 'Attach a photo of an individual question. It stays attached to this question.' : 'Type the question exactly as it appeared.'}</p>
      <div class="tx-form">
        ${photo ? `
        <div class="field" id="fld-qmPhoto"><label>Question photo</label>
          <div id="qmPhotoBox"></div><div class="tx-err" id="err-qmPhoto"></div></div>
        <div class="field"><label for="qmTitle">Label <span class="tx-hint">(optional)</span></label>
          <input type="text" id="qmTitle" maxlength="120" placeholder="e.g. Q7 — projectile problem" value="${esc(qm.title)}"></div>` : `
        <div class="field" id="fld-qmText"><label for="qmText">Question *</label>
          <textarea id="qmText" rows="5" maxlength="4000" placeholder="Type or paste the question…">${esc(qm.text)}</textarea><div class="tx-err" id="err-qmText"></div></div>`}
        <div class="field"><label for="qmNote">Description / answer details <span class="tx-hint">(optional)</span></label>
          <textarea id="qmNote" rows="3" maxlength="2000" placeholder="Your answer, the right answer, working, hints…">${esc(qm.note)}</textarea></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="pill-btn" onclick="Tests.closeQuestionModal()">Cancel</button>
        <button type="button" class="pill-btn primary" id="qmSave" onclick="Tests.saveQuestion()">${qm.isEdit ? 'Save changes' : 'Add question'}</button>
      </div>`;
    o.onclick = e => { if(e.target === o) closeQuestionModal(); };
    if(photo) renderQmPhoto();
    o.classList.add('open');
    setTimeout(() => { const f = $('qmText') || $('qmTitle'); if(f && !photo) f.focus(); }, 60);
  }
  function renderQmPhoto(){
    const box = $('qmPhotoBox'); if(!box) return;
    const img = qm.image;
    const pick = (label, cam) => `<label class="pill-btn ${img ? '' : 'primary'} tx-upload">${ico(cam ? 'camera' : 'upload', 13)}${label}<input type="file" accept="image/jpeg,image/png,image/webp${cam ? ',image/*' : ''}" ${cam ? 'capture="environment"' : ''} hidden onchange="Tests.qmPickPhoto(this)"></label>`;
    let preview = '';
    if(img){
      const src = qm._file ? draftUrl(img.id, qm._file) : null;
      preview = `<button type="button" class="tx-img-thumb tx-qm-preview" onclick="Tests.qmViewPhoto()" aria-label="View photo">${src ? `<img alt="Question photo" src="${src}">` : `<span class="tx-skel"></span><img alt="Question photo" data-thumb="${img.id}" hidden><span class="tx-img-miss" hidden>${ico('image', 22)}<small>Not on this device</small></span>`}</button>
        <div class="tx-hint">${esc(img.name || '')}${img.size ? ' · ' + fmtBytes(img.size) : ''}</div>`;
    }
    box.innerHTML = `${preview}<div class="tx-voice-btns">${pick(img ? 'Replace photo' : 'Choose photo')}${pick('Take photo', true)}
      ${img ? `<button type="button" class="pill-btn tx-danger-outline" onclick="Tests.qmRemovePhoto()">${ico('trash', 13)}Remove photo</button>` : ''}</div>`;
    hydrateThumbs(box);
  }
  function qmPickPhoto(input){
    const f = input.files[0]; input.value = '';
    if(!f) return;
    const err = validateImage(f); if(err){ Utils.toast(err, 'error'); return; }
    if(qm.image && qm._file){ const u = draftUrls.get(qm.image.id); if(u){ URL.revokeObjectURL(u); draftUrls.delete(qm.image.id); } }
    qm._file = f; qm.image = { id:Utils.uid(), name:f.name || 'photo', size:f.size, type:f.type || 'image/jpeg' };
    qm.photoChanged = true; setErr('qmPhoto', ''); renderQmPhoto();
  }
  function qmRemovePhoto(){
    if(qm.image && qm._file){ const u = draftUrls.get(qm.image.id); if(u){ URL.revokeObjectURL(u); draftUrls.delete(qm.image.id); } }
    qm._file = null; qm.image = null; qm.photoChanged = true; renderQmPhoto();
  }
  function qmViewPhoto(){
    if(!qm || !qm.image) return;
    viewSingle(qm._file ? { url:draftUrl(qm.image.id, qm._file) } : { key:K_IMG(qm.image.id) }, qm.title || 'Question photo');
  }
  function closeQuestionModal(){
    const o = $('txQuestionModal'); if(o) o.classList.remove('open');
    if(qm && qm._file && qm.photoChanged && qm.image){ const u = draftUrls.get(qm.image.id); if(u){ URL.revokeObjectURL(u); draftUrls.delete(qm.image.id); } }
    qm = null;
  }

  async function saveQuestion(){
    if(!qm) return;
    const note = $('qmNote').value.trim();
    const data = { kind:qm.kind, note };
    if(qm.kind === 'photo'){
      data.title = $('qmTitle').value.trim();
      if(!qm.image && !note){ setErr('qmPhoto', 'Add a photo (or a description if you remove the photo).'); Utils.shakeElement($('qmPhotoBox')); return; }
    } else {
      data.text = $('qmText').value.trim();
      if(!data.text){ setErr('qmText', 'Please enter the question.'); Utils.shakeElement($('qmText')); $('qmText').focus(); return; }
    }
    const M = qm, ctx = M.ctx;
    const old = M.isEdit ? qOf(ctx).find(x => x.id === M.id) : null;
    const entry = Object.assign({ id:M.id || qNewId(), createdAt:(old && old.createdAt) || Date.now(), text:'', title:'' }, data, { image:M.image || null });
    if(ctx === 'draft'){
      if(M.photoChanged && old && old.image && !old._file) draft.removedImages.push(old.image.id);
      if(M._file) entry._file = M._file;
      else if(old && old._file && !M.photoChanged) entry._file = old._file;
      qCommit(ctx, arr => { const i = arr.findIndex(x => x.id === entry.id); if(i >= 0) arr[i] = entry; else arr.push(entry); });
      qm = null; closeQuestionModal(); return;
    }
    const btn = $('qmSave'), label = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<span class="tx-spin"></span>Saving…';
    try{
      if(M.photoChanged && M._file){ entry.image = await storeImage({ id:M.image.id, file:M._file }); }
      if(M.photoChanged && old && old.image && (!M.image || M.image.id !== old.image.id)){ await dropMedia(K_IMG(old.image.id)); await dropMedia(K_THUMB(old.image.id)); }
      qCommit(ctx, arr => { const i = arr.findIndex(x => x.id === entry.id); if(i >= 0) arr[i] = entry; else arr.push(entry); });
      Utils.toast(M.isEdit ? 'Question updated' : 'Question added', 'success');
      qm = null; closeQuestionModal();
    }catch(e){
      Utils.toast(e && e.name === 'QuotaExceededError' ? 'Not enough storage space on this device.' : 'Could not save the question.', 'error');
      btn.disabled = false; btn.textContent = label;
    }
  }

  /* =========================================================
     Extract Test from Image (Option B) — OCR → editable questions
     The original photos are only read for text; they are not stored
     or shown in the resulting question list.
     ========================================================= */
  let ext = null;
  function openExtract(ctx){
    ext = { ctx, step:'pick', files:[], runs:[], items:[], raw:'', method:'', missing:[], cur:null, cancel:false, error:'' };
    const o = ensureOverlay('txExtractModal', 'tx-modal tx-extract');
    o.firstElementChild.setAttribute('aria-labelledby', 'txXTitle');
    o.onclick = e => { if(e.target === o) requestCloseExtract(); };
    o.classList.add('open');
    renderExtract();
  }
  function extBox(){ const o = $('txExtractModal'); return o && o.firstElementChild; }
  function renderExtract(){
    const box = extBox(); if(!box || !ext) return;
    const head = (t, sub) => `<div class="tx-modal-head"><div><h3 id="txXTitle">${t}</h3><p>${sub}</p></div>
      <button type="button" class="tx-icon-btn" aria-label="Close" onclick="Tests.requestCloseExtract()">${ico('x', 16)}</button></div>`;
    if(ext.step === 'pick'){
      box.innerHTML = head('Extract Test from Image', 'Upload one or more photos of a complete test paper. We\'ll read the text and split it into individual questions you can review and edit.') + `
        ${ext.error ? `<div class="tx-callout err">${ico('alert', 15)}<span>${esc(ext.error)}</span></div>` : ''}
        <div class="tx-xdrop" id="extDrop">
          <div class="tx-empty-ico">${ico('scan', 24)}</div>
          <p>Photos of the question paper — in page order</p>
          <div class="tx-voice-btns" style="justify-content:center">
            <label class="pill-btn primary tx-upload">${ico('upload', 13)}Choose photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onchange="Tests.extPick(this)"></label>
            <label class="pill-btn tx-upload">${ico('camera', 13)}Take photo<input type="file" accept="image/*" capture="environment" hidden onchange="Tests.extPick(this)"></label>
          </div>
        </div>
        <div class="tx-xfiles">${ext.files.map((f, i) => `<div class="tx-xfile"><span class="tx-xfile-n">${i + 1}</span><span class="tx-xfile-name" title="${esc(f.file.name)}">${esc(f.file.name)}</span><span class="tx-hint">${fmtBytes(f.file.size)}</span>
          <button type="button" class="tx-icon-btn" aria-label="Move up" ${i === 0 ? 'disabled' : ''} onclick="Tests.extMoveFile('${f.id}',-1)">${ico('up', 13)}</button>
          <button type="button" class="tx-icon-btn danger" aria-label="Remove ${esc(f.file.name)}" onclick="Tests.extRemoveFile('${f.id}')">${ico('x', 13)}</button></div>`).join('')}</div>
        <div class="tx-hint tx-note">Photos are only used to read the text and are not saved. Works best with sharp, well-lit, straight-on pages. The first use downloads the text-recognition engine.</div>
        <div class="modal-actions">
          <button type="button" class="pill-btn" onclick="Tests.requestCloseExtract()">Cancel</button>
          <button type="button" class="pill-btn primary" id="extGo" ${ext.files.length ? '' : 'disabled'} onclick="Tests.extRun()">${ico('scan', 13)}Extract questions</button>
        </div>`;
      const d = $('extDrop');
      ['dragenter', 'dragover'].forEach(ev => d.addEventListener(ev, e => { e.preventDefault(); d.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(ev => d.addEventListener(ev, e => { e.preventDefault(); d.classList.remove('over'); }));
      d.addEventListener('drop', e => extAdd([...(e.dataTransfer && e.dataTransfer.files || [])]));
    } else if(ext.step === 'run'){
      box.innerHTML = head('Reading your test paper…', 'This runs on your device. Larger photos take longer.') + `
        <div class="tx-bar big"><i id="extTotal" style="width:0%"></i></div>
        <div class="tx-runs">${ext.runs.map((r, i) => `<div class="tx-run" id="extRun-${i}"></div>`).join('')}</div>
        <div class="modal-actions"><button type="button" class="pill-btn" onclick="Tests.extCancel()">Cancel</button></div>`;
      ext.runs.forEach((r, i) => updateRunRow(i));
    } else {
      renderExtractReview(box, head);
    }
  }
  function updateRunRow(i){
    if(!ext) return;
    const r = ext.runs[i], el = $('extRun-' + i); if(!r || !el) return;
    const label = { waiting:'Waiting', reading:'Reading… ' + r.progress + '%', done:'Done', failed:'Failed' }[r.status];
    el.className = 'tx-run ' + r.status;
    el.innerHTML = `${r.status === 'reading' ? '<span class="tx-spin"></span>' : ico(r.status === 'done' ? 'check' : (r.status === 'failed' ? 'alert' : 'image'), 14)}
      <span class="tx-run-name">${esc(r.name)}</span><span class="tx-run-st">${esc(label)}</span>${r.status === 'failed' && r.error ? `<div class="tx-hint">${esc(r.error)}</div>` : ''}`;
    const done = ext.runs.reduce((s, x) => s + (x.status === 'done' || x.status === 'failed' ? 100 : (x.status === 'reading' ? x.progress : 0)), 0) / ext.runs.length;
    const t = $('extTotal'); if(t) t.style.width = Math.round(done) + '%';
  }
  function extAdd(files){
    if(!ext || ext.step !== 'pick') return;
    files.forEach(f => {
      const err = validateImage(f); if(err){ Utils.toast(err, 'error'); return; }
      ext.files.push({ id:Utils.uid(), file:f });
    });
    ext.error = ''; renderExtract();
  }
  function extPick(input){ const f = [...input.files]; input.value = ''; extAdd(f); }
  function extRemoveFile(id){ ext.files = ext.files.filter(f => f.id !== id); renderExtract(); }
  function extMoveFile(id, dir){
    const i = ext.files.findIndex(f => f.id === id), j = i + dir;
    if(i < 0 || j < 0 || j >= ext.files.length) return;
    const t = ext.files[i]; ext.files[i] = ext.files[j]; ext.files[j] = t; renderExtract();
  }
  function extCancel(){ if(ext){ ext.cancel = true; } }

  async function extRun(){
    const E = ext; if(!E || !E.files.length) return;
    E.step = 'run'; E.cancel = false; E.error = '';
    E.runs = E.files.map(f => ({ name:f.file.name, status:'waiting', progress:0 }));
    renderExtract();
    let worker = null; const texts = []; let okCount = 0;
    const aborted = () => ext !== E || E.cancel;
    try{
      await loadTesseract();
      if(aborted()) throw new Error('cancelled');
      worker = await window.Tesseract.createWorker('eng', 1, {
        logger: m => { if(ext === E && E.cur != null && m && m.status === 'recognizing text'){ E.runs[E.cur].progress = Math.round((m.progress || 0) * 100); updateRunRow(E.cur); } }
      });
      for(let i = 0; i < E.files.length; i++){
        if(aborted()) throw new Error('cancelled');
        E.cur = i; E.runs[i].status = 'reading'; E.runs[i].progress = 0; updateRunRow(i);
        try{
          const { blob } = await processImage(E.files[i].file);
          const res = await worker.recognize(blob);
          texts.push((res && res.data && res.data.text) || '');
          E.runs[i].status = 'done'; E.runs[i].progress = 100; okCount++;
        }catch(e){
          E.runs[i].status = 'failed'; E.runs[i].error = 'Could not read this image.';
        }
        updateRunRow(i);
      }
    }catch(e){
      if(ext === E){
        if(E.cancel || (e && e.message === 'cancelled')){ E.step = 'pick'; E.cancel = false; }
        else { E.step = 'pick'; E.error = (e && e.message) || 'Text recognition failed.'; }
        renderExtract();
      }
      return;
    } finally { if(worker){ try{ await worker.terminate(); }catch(e){} } }
    if(ext !== E) return;
    if(E.cancel){ E.step = 'pick'; E.cancel = false; renderExtract(); return; }
    if(!okCount){ E.step = 'pick'; E.error = 'None of the images could be read. Try sharper photos.'; renderExtract(); return; }
    extBuildReview(texts.join('\n'));
  }
  function extBuildReview(raw){
    const r = splitQuestions(raw);
    ext.raw = raw; ext.method = r.method; ext.missing = r.missing || [];
    ext.items = r.questions.map(t => ({ id:Utils.uid(), text:t }));
    ext.step = 'review'; renderExtract();
  }
  function renderExtractReview(box, head){
    const n = ext.items.length;
    const msg = ext.method === 'numbered' ? `${plural(n, 'question')} found by their numbers`
      : ext.method === 'paragraphs' ? 'No question numbers were found — text was split by paragraph'
      : (n ? 'No question numbers were found — all text is in one entry' : 'No readable text was found');
    box.innerHTML = head('Review extracted questions', 'Fix any recognition mistakes, reorder, merge or delete entries, and add anything that was missed.') + `
      <div class="tx-callout ${ext.method === 'numbered' && !ext.missing.length ? 'ok' : 'warn'}">${ico(ext.method === 'numbered' && !ext.missing.length ? 'check' : 'alert', 15)}
        <span>${esc(msg)}.${ext.missing.length ? ' Numbering skips ' + esc(ext.missing.map(m => 'Q' + m).join(', ')) + ' — add ' + (ext.missing.length > 1 ? 'them' : 'it') + ' manually if needed.' : ''} Please review before adding.</span></div>
      <div class="tx-ext-items" id="extItems">${ext.items.map((it, i) => extItemHtml(it, i, n)).join('')}</div>
      <button type="button" class="pill-btn tx-add-row" onclick="Tests.extAddItem()">${ico('plus', 13)}Add a missing question</button>
      <details class="tx-raw"><summary>Raw recognised text</summary>
        <textarea id="extRaw" rows="6">${esc(ext.raw)}</textarea>
        <button type="button" class="pill-btn" onclick="Tests.extResplit()">${ico('refresh', 12)}Re-split from this text</button></details>
      <div class="modal-actions">
        <button type="button" class="pill-btn" onclick="Tests.extBack()">${ico('left', 12)}Back</button>
        <button type="button" class="pill-btn primary" id="extConfirm" onclick="Tests.extConfirm()">${ico('check', 13)}Add ${plural(n, 'question')} to test</button>
      </div>`;
    box.querySelectorAll('.tx-ext-item textarea').forEach(autoGrow);
  }
  function autoGrow(ta){ ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 320) + 'px'; }
  function extItemHtml(it, i, n){
    return `<div class="tx-ext-item" data-id="${it.id}">
      <div class="tx-ext-head"><span class="tx-q-num">Q${i + 1}</span>
        <div class="tx-ext-tools">
          <button type="button" class="tx-icon-btn" aria-label="Move up" ${i === 0 ? 'disabled' : ''} onclick="Tests.extMove('${it.id}',-1)">${ico('up', 13)}</button>
          <button type="button" class="tx-icon-btn" aria-label="Move down" ${i === n - 1 ? 'disabled' : ''} onclick="Tests.extMove('${it.id}',1)">${ico('chevron', 13)}</button>
          <button type="button" class="tx-icon-btn" aria-label="Merge into previous question" data-tip="Merge up" ${i === 0 ? 'disabled' : ''} onclick="Tests.extMerge('${it.id}')">${ico('merge', 13)}</button>
          <button type="button" class="tx-icon-btn" aria-label="Add a question below" onclick="Tests.extAddItem('${it.id}')">${ico('plus', 13)}</button>
          <button type="button" class="tx-icon-btn danger" aria-label="Delete question ${i + 1}" onclick="Tests.extDelete('${it.id}')">${ico('trash', 13)}</button>
        </div></div>
      <textarea rows="3" maxlength="4000" aria-label="Question ${i + 1} text" oninput="Tests.extEdit('${it.id}',this)">${esc(it.text)}</textarea></div>`;
  }
  function extRerender(focusId){
    const box = extBox(); if(!box) return;
    const c = $('extItems'); if(!c) return;
    const n = ext.items.length;
    c.innerHTML = ext.items.map((it, i) => extItemHtml(it, i, n)).join('');
    c.querySelectorAll('textarea').forEach(autoGrow);
    const b = $('extConfirm'); if(b) b.innerHTML = `${ico('check', 13)}Add ${plural(n, 'question')} to test`;
    if(focusId){ const ta = c.querySelector(`.tx-ext-item[data-id="${focusId}"] textarea`); if(ta){ ta.focus(); ta.scrollIntoView({ block:'center', behavior:'smooth' }); } }
  }
  function extEdit(id, ta){ const it = ext.items.find(x => x.id === id); if(it) it.text = ta.value; autoGrow(ta); }
  function extMove(id, dir){
    const i = ext.items.findIndex(x => x.id === id), j = i + dir; if(i < 0 || j < 0 || j >= ext.items.length) return;
    const t = ext.items[i]; ext.items[i] = ext.items[j]; ext.items[j] = t; extRerender();
  }
  function extMerge(id){
    const i = ext.items.findIndex(x => x.id === id); if(i < 1) return;
    ext.items[i - 1].text = (ext.items[i - 1].text.trimEnd() + '\n' + ext.items[i].text).trim();
    ext.items.splice(i, 1); extRerender();
  }
  function extDelete(id){ ext.items = ext.items.filter(x => x.id !== id); extRerender(); }
  function extAddItem(afterId){
    const it = { id:Utils.uid(), text:'' };
    const i = afterId ? ext.items.findIndex(x => x.id === afterId) : ext.items.length - 1;
    ext.items.splice(i + 1, 0, it); extRerender(it.id);
  }
  function extResplit(){ const t = $('extRaw').value; extBuildReview(t); }
  function extBack(){ ext.step = 'pick'; renderExtract(); }
  function extConfirm(){
    const items = ext.items.map(i => i.text.trim()).filter(Boolean);
    if(!items.length){ Utils.toast('There are no questions to add yet.', 'info'); return; }
    const ctx = ext.ctx;
    qCommit(ctx, arr => items.forEach(text => arr.push({ id:qNewId(), kind:'text', text, title:'', note:'', image:null, createdAt:Date.now() })));
    closeExtract();
    Utils.toast(items.length === 1 ? '1 question added' : `${items.length} questions added`, 'success');
  }
  function closeExtract(){ if(ext) ext.cancel = true; ext = null; const o = $('txExtractModal'); if(o) o.classList.remove('open'); }
  async function requestCloseExtract(){
    if(ext && ext.step === 'review' && ext.items.some(i => i.text.trim())){
      const ok = await confirmDialog({ title:'Discard extracted questions?', message:'The extracted questions haven\'t been added to the test yet.', confirmText:'Discard', cancelText:'Keep reviewing', danger:true });
      if(!ok) return;
    }
    closeExtract();
  }

  /* =========================================================
     Add / edit test modal  (tabbed: Details · Questions · Voice · Mistakes)
     ========================================================= */
  let draft = null;   // { mode, id, chapters, questions, removedImages, voices, mistakes, dirty, subjectTouched }
  let saving = false;
  const draftUrls = new Map();
  function draftUrl(id, blob){
    if(draftUrls.has(id)) return draftUrls.get(id);
    const u = URL.createObjectURL(blob); draftUrls.set(id, u); return u;
  }
  function clearDraftUrls(){ draftUrls.forEach(u => { try{ URL.revokeObjectURL(u); }catch(e){} }); draftUrls.clear(); }

  function chaptersForSubject(subject){
    try{ return ((Storage.get('chapters', {}) || {})[subject] || []).map(c => c && c.name).filter(Boolean); }
    catch(e){ return []; }
  }
  function chapterSearch(q, limit){
    if(typeof ChapterAutocomplete !== 'undefined' && ChapterAutocomplete.search) return ChapterAutocomplete.search(q, limit);
    return [];
  }
  function taskOptions(selected){
    const tasks = (typeof App !== 'undefined' && App.getTasks) ? App.getTasks().filter(t => String(t.type || '').split(/[,|]/).map(x=>x.trim().toUpperCase()).includes('TEST')) : [];
    const ts = (v => isNaN(v) ? 0 : v);
    let list = tasks.slice().sort((a, b) => ts(new Date(b.date)) - ts(new Date(a.date))).slice(0, 80);
    if(selected && !list.some(t => t.id === selected)){
      const extra = tasks.find(t => t.id === selected); if(extra) list.push(extra);
    }
    return '<option value="">— Not linked —</option>' + list.map(t => {
      const d = new Date(t.date);
      return `<option value="${esc(t.id)}" ${t.id === selected ? 'selected' : ''}>${esc(t.title)} · ${esc(t.subject || 'General')}${isNaN(d) ? '' : ' · ' + esc(Utils.fmtDate(d))}</option>`;
    }).join('');
  }

  function newDraft(mode, t, opts){
    return {
      mode, id:t ? t.id : null,
      chapters:t ? chaptersOf(t).slice() : [],
      questions:t ? (t.questions || []).map(q => Object.assign({}, q)) : [],
      removedImages:[], voices:[], mistakes:[], dirty:false, subjectTouched:!!t
    };
  }
  function openCreate(opts){
    opts = opts || {};
    draft = newDraft('create', null, opts);
    showTestModal(null, opts);
  }
  function openEdit(id){
    const t = find(id); if(!t){ Utils.toast('That test no longer exists.', 'error'); return; }
    draft = newDraft('edit', t);
    showTestModal(t, {});
  }

  const FORM_TABS = [['details', 'Details', 'clipboard'], ['voice', 'Voice', 'mic'], ['mistakes', 'Mistakes', 'alert']];
  function formTabsHtml(editing){
    return FORM_TABS.filter(t => !(editing && t[0] === 'mistakes')).map((t, i) =>
      `<button type="button" role="tab" id="fmTab-${t[0]}" class="${i === 0 ? 'active' : ''}" data-tab="${t[0]}" aria-selected="${i === 0}" aria-controls="fmPanel-${t[0]}" onclick="Tests.switchFormTab('${t[0]}')">
        ${ico(t[2], 18)}<span class="tx-tab-label">${t[1]}</span><em class="tx-tab-count" id="fmCount-${t[0]}" hidden>0</em></button>`).join('');
  }
  function switchFormTab(name){
    const box = $('txTestModal') && $('txTestModal').firstElementChild; if(!box) return;
    box.querySelectorAll('.tx-tabs [data-tab]').forEach(b => { const on = b.dataset.tab === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    box.querySelectorAll('.tx-tabpanel').forEach(p => p.classList.toggle('active', p.dataset.tab === name));
    const body = box.querySelector('.tx-modal-body'); if(body) body.scrollTop = 0;
  }
  function updateFormCounts(){
    if(!draft) return;
    const set = (id, n) => { const el = $('fmCount-' + id); if(el){ el.textContent = n; el.hidden = !n; } };
    set('questions', draft.questions.length); set('voice', draft.voices.length); set('mistakes', draft.mistakes.length);
  }

  function showTestModal(t, opts){
    const editing = !!t;
    const subject = t ? t.subject : (SUBJECTS.includes(opts.subject) ? opts.subject : 'Physics');
    const taskId = t ? t.taskId : opts.taskId;
    const o = ensureOverlay('txTestModal', 'tx-modal tx-test-modal');
    const box = o.firstElementChild;
    box.setAttribute('aria-labelledby', 'txTTitle');
    box.innerHTML = `
      <div class="tx-modal-head">
        <div><h3 id="txTTitle">${editing ? 'Edit test' : 'Add New Test'}</h3>
        <p>${editing ? 'Update this test, its questions and voice notes.' : 'Log a test — you can add more questions, voice notes and mistakes later too.'}</p></div>
        <button type="button" class="tx-icon-btn" aria-label="Close" onclick="Tests.requestCloseTestModal()">${ico('x', 16)}</button>
      </div>
      <div class="tx-tabs" role="tablist" aria-label="Test sections">${formTabsHtml(editing)}</div>
      <div class="tx-modal-body">
      <form class="tx-form" id="txTestForm" novalidate>
        <section class="tx-tabpanel active" role="tabpanel" id="fmPanel-details" data-tab="details" aria-labelledby="fmTab-details">
          <div class="field"><label for="fmMissionLink">LINK TO MISSION DASHBOARD</label><select id="fmMissionLink"><option value="">— Select a TEST mission —</option>${taskOptions(taskId).replace('<option value="">— Not linked —</option>','')}</select><div class="tx-hint">Choose a Mission Dashboard task with Type = TEST to copy its details.</div></div>
          <div class="field"><label for="fmName">Test name *</label>
            <input type="text" id="fmName" maxlength="120" placeholder="e.g. Rotational Motion — Unit Test" autocomplete="off" value="${esc(t ? t.name : '')}">
            <div class="tx-err" id="err-fmName"></div></div>
          <div class="field-row">
            <div class="field"><label for="fmDate">Test date *</label><input type="date" id="fmDate" value="${esc(t ? t.date : localDateStr())}"><div class="tx-err" id="err-fmDate"></div></div>
            <div class="field"><label for="fmSubject">Subject *</label>
              <select id="fmSubject">${SUBJECTS.map(s => `<option ${s === subject ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
          </div>
          <div class="field"><label for="fmTime">Test time</label><input type="time" id="fmTime" value="${esc(t ? (t.time || '') : '')}"></div>
          <div class="field"><label for="fmChapInput">Chapters / topics <span class="tx-hint">(pick several from your Syllabus)</span></label>
            <div class="tx-chp ac-host" id="fmChapHost">
              <div class="tx-chp-box" id="fmChapBox"><span class="tx-chp-chips" id="fmChapChips"></span>
                <input type="text" id="fmChapInput" role="combobox" aria-autocomplete="list" aria-controls="fmChapList" aria-expanded="false" autocomplete="off" maxlength="120" placeholder="Type to search chapters…"></div>
              <ul class="ac-list" id="fmChapList" role="listbox" hidden></ul>
            </div></div>
          <div class="field-row">
            <div class="field"><label for="fmMax">Maximum marks *</label><input type="number" id="fmMax" inputmode="decimal" step="any" min="0" placeholder="e.g. 300" value="${t ? esc(t.maxMarks) : ''}"><div class="tx-err" id="err-fmMax"></div></div>
            <div class="field"><label for="fmMarks">Marks obtained *</label><input type="number" id="fmMarks" inputmode="decimal" step="any" placeholder="Negative marking allowed" value="${t ? esc(t.marks) : ''}"><div class="tx-err" id="err-fmMarks"></div></div>
          </div>
          <div class="tx-preview" id="fmPreview" aria-live="polite"></div>
          <div class="field"><label for="fmTask">Linked mission / task <span class="tx-hint">(optional)</span></label>
            <select id="fmTask">${taskOptions(taskId)}</select></div>
          <div class="field"><label for="fmDesc">Description</label>
            <textarea id="fmDesc" rows="3" maxlength="2000" placeholder="How did it go? Topics covered, time pressure, anything to remember…">${esc(t ? t.description : '')}</textarea></div>
        </section>

        <section class="tx-tabpanel" role="tabpanel" id="fmPanel-questions" data-tab="questions" aria-labelledby="fmTab-questions">
          ${optsHtml('draft', false)}
          <div id="fmQList"></div>
        </section>

        <section class="tx-tabpanel" role="tabpanel" id="fmPanel-voice" data-tab="voice" aria-labelledby="fmTab-voice">
          <div id="${ctlId('form')}">${recCtlHtml('form')}</div>
          <div class="tx-voice-list" id="fmVoiceList"></div>
          ${editing ? '<div class="tx-hint tx-note">Existing voice notes are managed on the test\'s details page.</div>' : ''}
        </section>

        ${editing ? '' : `<section class="tx-tabpanel" role="tabpanel" id="fmPanel-mistakes" data-tab="mistakes" aria-labelledby="fmTab-mistakes">
          <div class="tx-form-sec-head"><span>${ico('alert', 14)}Mistakes</span>
            <button type="button" class="pill-btn" onclick="Tests.openMistake({mode:'draft'})">${ico('plus', 12)}Add mistake</button></div>
          <div class="tx-hint">Optional — you can also log mistakes after saving.</div>
          <div class="tx-draft-mis" id="fmMisList"></div>
        </section>`}
      </form>
      </div>
      <div class="modal-actions">
        <button type="button" class="pill-btn" onclick="Tests.requestCloseTestModal()">Cancel</button>
        <button type="button" class="pill-btn primary" id="fmSave" onclick="Tests.saveTest()">${editing ? 'Save changes' : 'Save test'}</button>
      </div>`;

    const updatePreview = () => {
      const max = parseFloat($('fmMax').value), m = parseFloat($('fmMarks').value);
      const pv = $('fmPreview');
      if(max > 0 && Number.isFinite(m)){
        const p = (m / max) * 100;
        pv.className = 'tx-preview ' + pctClass(p);
        pv.innerHTML = `<span>Score</span><b>${fmtNum(m)} / ${fmtNum(max)}</b><em>${fmtPct(p)}</em>`;
      } else { pv.className = 'tx-preview'; pv.innerHTML = '<span>Score preview appears here</span>'; }
    };
    updatePreview();

    const form = $('txTestForm');
    form.addEventListener('input', e => {
      draft.dirty = true;
      if(e.target.id && $('err-' + e.target.id)) setErr(e.target.id, '');
      if(e.target.id === 'fmMax' || e.target.id === 'fmMarks'){ setErr('fmMax', ''); setErr('fmMarks', ''); updatePreview(); }
    });
    $('fmSubject').addEventListener('change', () => { draft.subjectTouched = true; });
    $('fmTask').addEventListener('change', () => {
      const id = $('fmTask').value; if(!id) return;
      const tk = (App.getTasks({ id }) || [])[0];
      if(tk && SUBJECTS.includes(tk.subject) && !draft.chapters.length){ $('fmSubject').value = tk.subject; draft.subjectTouched = true; }
    });
    $('fmMissionLink').addEventListener('change', () => {
      const id = $('fmMissionLink').value; if(!id) return;
      const tk = (App.getTasks({ id }) || [])[0]; if(!tk) return;
      $('fmName').value = tk.title || '';
      if(SUBJECTS.includes(tk.subject)) $('fmSubject').value = tk.subject;
      $('fmDate').value = (()=>{ const d=new Date(tk.date); return isNaN(d)?'':`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
      $('fmTime').value = tk.time || '';
      $('fmDesc').value = tk.description || '';
      $('fmTask').value = tk.id;
      draft.chapters = (tk.chapters && tk.chapters.length ? tk.chapters : (tk.chapterId ? [tk.chapterId] : String(tk.title||'').split(', '))).filter(Boolean);
      const chips=$('fmChapChips'); if(chips) chips.innerHTML=draft.chapters.map((c,i)=>`<span class="tx-chap"><span>${esc(c)}</span><button type="button" data-i="${i}" aria-label="Remove chapter">${ico('x',11)}</button></span>`).join('');
      draft.dirty = true;
    });
    form.addEventListener('submit', e => { e.preventDefault(); saveTest(); });
    bindChapterPicker();
    renderFormQuestions(); renderFormVoices(); renderFormMistakes(); updateFormCounts();
    o.onclick = e => { if(e.target === o) requestCloseTestModal(); };
    o.classList.add('open');
    box.querySelector('.tx-modal-body').scrollTop = 0;
    setTimeout(() => { const n = $('fmName'); if(n && !editing && window.innerWidth > 700) n.focus(); }, 80);
  }

  /* ---------------- multi-chapter picker (same source & ranking as Study Schedule) ---------------- */
  function bindChapterPicker(){
    const input = $('fmChapInput'), list = $('fmChapList'), chipsEl = $('fmChapChips');
    let items = [], active = -1;
    const has = n => draft.chapters.some(c => c.toLowerCase() === n.toLowerCase());
    const close = () => { list.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
    function renderChips(){
      chipsEl.innerHTML = draft.chapters.map((c, i) => `<span class="tx-chap"><span>${esc(c)}</span><button type="button" data-i="${i}" aria-label="Remove chapter ${esc(c)}">${ico('x', 11)}</button></span>`).join('');
      chipsEl.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { draft.chapters.splice(+b.dataset.i, 1); draft.dirty = true; renderChips(); input.focus(); }));
    }
    function build(){
      const raw = input.value.trim();
      if(raw){
        items = chapterSearch(raw, 40).filter(c => !has(c.name)).slice(0, 8);
        if(!has(raw)) items.push({ custom:true, text:raw });
      } else {
        const subj = $('fmSubject').value;
        items = chaptersForSubject(subj).filter(n => !has(n)).slice(0, 8).map(n => ({ name:n, subject:subj }));
      }
    }
    function render(){
      build();
      if(!items.length){ close(); return; }
      list.innerHTML = items.map((it, i) => `<li class="ac-item${it.custom ? ' ac-custom' : ''}" id="fmChapList-${i}" role="option" aria-selected="false" data-i="${i}"><span>${it.custom ? '+ Custom' : esc(it.name)}</span><span class="ac-sub">${esc(it.custom ? it.text : it.subject)}</span></li>`).join('');
      list.hidden = false; input.setAttribute('aria-expanded', 'true'); active = -1;
    }
    function setActive(i){
      active = i;
      [...list.children].forEach((li, k) => { li.classList.toggle('active', k === i); li.setAttribute('aria-selected', String(k === i)); });
      if(i >= 0){ input.setAttribute('aria-activedescendant', list.children[i].id); list.children[i].scrollIntoView({ block:'nearest' }); }
    }
    function add(name, subject){
      name = (name || '').trim(); if(!name || has(name)) return;
      if(draft.chapters.length >= 20){ Utils.toast('You can add up to 20 chapters.', 'info'); return; }
      draft.chapters.push(name); draft.dirty = true;
      if(subject && !draft.subjectTouched && draft.chapters.length === 1 && SUBJECTS.includes(subject)) $('fmSubject').value = subject;
      input.value = ''; renderChips(); render();
    }
    list.addEventListener('pointerdown', e => {
      const li = e.target.closest('li'); if(!li) return;
      e.preventDefault();
      const it = items[+li.dataset.i]; if(it) add(it.custom ? it.text : it.name, it.subject);
      input.focus();
    });
    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('blur', close);
    input.addEventListener('keydown', e => {
      if(e.key === 'ArrowDown' && !list.hidden){ e.preventDefault(); setActive((active + 1) % items.length); }
      else if(e.key === 'ArrowUp' && !list.hidden){ e.preventDefault(); setActive((active - 1 + items.length) % items.length); }
      else if(e.key === 'Enter'){
        e.preventDefault();
        if(active >= 0 && items[active]) add(items[active].custom ? items[active].text : items[active].name, items[active].subject);
        else if(input.value.trim()) add(input.value);
      }
      else if(e.key === ',' && input.value.trim()){ e.preventDefault(); add(input.value); }
      else if(e.key === 'Backspace' && !input.value && draft.chapters.length){ draft.chapters.pop(); draft.dirty = true; renderChips(); }
      else if(e.key === 'Escape' && !list.hidden){ e.stopPropagation(); close(); }
    });
    $('fmChapBox').addEventListener('click', () => input.focus());
    renderChips();
  }

  function renderFormQuestions(){
    const box = $('fmQList'); if(!box || !draft) return;
    box.innerHTML = questionListHtml('draft');
    hydrateThumbs(box); updateFormCounts();
  }
  function renderFormVoices(){
    const box = $('fmVoiceList'); if(!box || !draft) return;
    updateFormCounts();
    if(!draft.voices.length){ box.innerHTML = ''; return; }
    box.innerHTML = draft.voices.map(v => playerHtml(v.id, v.name, v.duration,
      `<button type="button" class="tx-icon-btn danger" aria-label="Remove ${esc(v.name)}" onclick="Tests.removeDraftVoice('${v.id}')">${ico('trash', 14)}</button>`)).join('');
    bindPlayers(box, id => { const v = draft && draft.voices.find(x => x.id === id); return Promise.resolve(v ? draftUrl(id, v.blob) : null); });
  }
  function removeDraftVoice(id){
    stopAllAudio();
    const u = draftUrls.get(id); if(u){ URL.revokeObjectURL(u); draftUrls.delete(id); }
    draft.voices = draft.voices.filter(v => v.id !== id);
    renderFormVoices();
  }
  function renderFormMistakes(){
    const box = $('fmMisList'); if(!box || !draft) return;
    updateFormCounts();
    box.innerHTML = draft.mistakes.map((m, i) => `
      <div class="tx-draft-mis-row">
        <span class="tx-mis-num">${i + 1}</span>
        <div class="tx-mis-title">${esc(m.question)}</div>${typeBadge(m.type)}
        <button type="button" class="tx-icon-btn" aria-label="Edit mistake ${i + 1}" onclick="Tests.openMistake({mode:'draft',id:'${m.id}'})">${ico('edit', 14)}</button>
        <button type="button" class="tx-icon-btn danger" aria-label="Remove mistake ${i + 1}" onclick="Tests.removeDraftMistake('${m.id}')">${ico('trash', 14)}</button>
      </div>`).join('');
  }
  function removeDraftMistake(id){ draft.mistakes = draft.mistakes.filter(m => m.id !== id); draft.dirty = true; renderFormMistakes(); }

  function validateForm(){
    let ok = true, first = null;
    const bad = (id, msg) => { setErr(id, msg); ok = false; if(!first) first = $(id); Utils.shakeElement($(id)); };
    const pending = $('fmChapInput').value.trim();     // typed but not yet turned into a chip
    if(pending && !draft.chapters.some(c => c.toLowerCase() === pending.toLowerCase())) draft.chapters.push(pending);
    const name = $('fmName').value.trim();
    if(!name) bad('fmName', 'Please give the test a name.');
    const date = $('fmDate').value;
    if(!date || !parseDateStr(date)) bad('fmDate', 'Please choose the test date.');
    const max = parseFloat($('fmMax').value);
    if(!Number.isFinite(max) || max <= 0) bad('fmMax', 'Enter the maximum marks (greater than 0).');
    else if(max > 100000) bad('fmMax', 'That looks too large — please check.');
    const marks = parseFloat($('fmMarks').value);
    if(!Number.isFinite(marks)) bad('fmMarks', 'Enter the marks you obtained.');
    else if(Number.isFinite(max) && max > 0 && marks > max) bad('fmMarks', `Marks can't exceed the maximum (${fmtNum(max)}).`);
    else if(Number.isFinite(max) && max > 0 && marks < -max) bad('fmMarks', `Marks can't be below −${fmtNum(max)}.`);
    if(!ok){ switchFormTab('details'); if(first) first.focus(); return null; }
    return {
      name, date, time:$('fmTime').value, subject:$('fmSubject').value, chapters:draft.chapters.slice(), chapter:draft.chapters.join(', '),
      maxMarks:max, marks, description:$('fmDesc').value.trim(), taskId:$('fmTask').value || undefined
    };
  }

  async function saveTest(){
    if(saving || !draft) return;
    if(recState.active && recState.where === 'form'){ switchFormTab('voice'); Utils.toast('Stop the recording before saving.', 'info'); return; }
    const v = validateForm(); if(!v) return;
    saving = true;
    const btn = $('fmSave'), label = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<span class="tx-spin"></span>Saving…';
    const wasCreate = draft.mode === 'create', editId = draft.id;
    try{
      let failed = 0;
      const qs = draft.questions.map(q => Object.assign({}, q));
      for(const q of qs){
        if(q._file){
          try{ q.image = await storeImage({ id:q.image.id, file:q._file }); }catch(e){ failed++; q.image = null; }
          delete q._file;
        }
      }
      for(const id of draft.removedImages){ await dropMedia(K_IMG(id)); await dropMedia(K_THUMB(id)); }
      const voiceMetas = [];
      for(const vv of draft.voices){ try{ voiceMetas.push(await storeVoice(vv)); }catch(e){ failed++; } }
      let id = editId;
      if(wasCreate){
        id = Utils.uid();
        const t = Object.assign({ id, images:[], voices:voiceMetas, mistakes:draft.mistakes.slice(), questions:qs, createdAt:Date.now(), updatedAt:Date.now() }, v);
        if(!t.taskId) delete t.taskId;
        const list = all(); list.push(t); saveAll(list);
      } else {
        update(id, t => {
          Object.assign(t, v);
          if(!v.taskId) delete t.taskId;
          t.questions = qs;
          t.voices = (t.voices || []).concat(voiceMetas);
        });
      }
      if(failed) Utils.toast(failed === 1 ? '1 file couldn\'t be stored (is the device storage full?).' : `${failed} files couldn't be stored (is the device storage full?).`, 'error');
      closeTestModal();
      Utils.toast(wasCreate ? 'Test saved' : 'Test updated', 'success');
      if(pageVisible()){
        if(wasCreate){ open(id); }
        else if(view === 'detail'){ renderHero(); renderQuestions(); renderVoices(); }
        else renderList();
      } else if(shellBuilt){ renderList(); }
    }catch(e){
      console.error('[Tests] save failed', e);
      Utils.toast('Could not save the test. Please try again.', 'error');
      btn.disabled = false; btn.textContent = label;
    } finally { saving = false; }
  }

  function closeTestModal(){
    const o = $('txTestModal'); if(o) o.classList.remove('open');
    if(Rec.isActive() && recState.where === 'form'){ Rec.cancel(); recState = { active:false, where:null, sec:0 }; }
    stopAllAudio();
    clearDraftUrls();
    draft = null;
  }
  async function requestCloseTestModal(){
    if(draft && draft.dirty){
      const ok = await confirmDialog({ title:'Discard changes?', message:'You have unsaved changes in this form. They will be lost.', confirmText:'Discard', cancelText:'Keep editing', danger:true });
      if(!ok) return;
    }
    closeTestModal();
  }

  /* ---------------- delete a test ---------------- */
  async function remove(id){
    const t = find(id); if(!t) return;
    const bits = [];
    if((t.mistakes || []).length) bits.push(plural(t.mistakes.length, 'mistake'));
    if((t.images || []).length) bits.push(plural(t.images.length, 'image'));
    if((t.voices || []).length) bits.push(plural(t.voices.length, 'voice note'));
    const ok = await confirmDialog({
      title:`Delete “${t.name}”?`,
      message:'This permanently removes the test' + (bits.length ? ' along with its ' + bits.join(', ') : '') + '. This can\'t be undone.',
      confirmText:'Delete test', danger:true
    });
    if(!ok) return;
    stopAllAudio();
    await deleteTestMedia(t);
    t.images && t.images.forEach(i => delete ocr.state[i.id]);
    saveAll(all().filter(x => x.id !== id));
    Utils.toast('Test deleted', 'success');
    if(view === 'detail' && currentId === id) back(); else renderList();
  }

  /* =========================================================
     Public hooks used by app.js / enhancements
     ========================================================= */
  function ensureShell(){ if(!shellBuilt) buildShell(); }
  function render(){
    ensureShell();
    if(view === 'detail'){
      if(!find(currentId)){ back(); return; }
      buildDetail();
    } else renderList();
  }
  function reload(){
    if(!shellBuilt) return;
    if(view === 'detail'){
      if(!find(currentId)){ back(); return; }
      renderHero(); renderMistakes(); renderQuestions();
      const ae = document.activeElement;
      if($('txImgPanel') && !(ae && ae.closest && ae.closest('#txImgPanel'))) renderImages();
    } else renderList();
  }
  function hasMatch(term){
    term = String(term || '').toLowerCase(); if(!term) return false;
    return all().some(t => [t.name, t.subject, chaptersOf(t).join(' '), t.description].join(' ').toLowerCase().includes(term));
  }
  function setSearch(term){
    ensureShell();
    search = term || ''; const s = $('txSearch'); if(s) s.value = search;
    if(view === 'detail') back(); else renderList();
  }

  /* Escape closes only the top-most Tests overlay (and never throws away an
     unsaved form silently); arrows page through the image viewer. Registered
     in the capture phase so it runs before the app-wide Escape handler. */
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){
      if(isOpen('txConfirm')){ e.stopImmediatePropagation(); if(confirmResolve) confirmResolve(false); return; }
      if(isOpen('txQuestionModal')){ e.stopImmediatePropagation(); closeQuestionModal(); return; }
      if(isOpen('txExtractModal')){ e.stopImmediatePropagation(); requestCloseExtract(); return; }
      if(isOpen('txMistakeModal')){ e.stopImmediatePropagation(); closeMistake(); return; }
      if(isOpen('txViewer')){ e.stopImmediatePropagation(); closeViewer(); return; }
      if(isOpen('txTestModal')){ e.stopImmediatePropagation(); requestCloseTestModal(); return; }
    } else if(isOpen('txViewer') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')){
      e.preventDefault(); viewImage(viewerIdx + (e.key === 'ArrowRight' ? 1 : -1));
    }
  }, true);

  return {
    confirmDialog, render, reload, open, back, openCreate, openEdit, remove, resetAll, hasMatch, setSearch,
    requestCloseTestModal, openMistake, closeMistake, saveMistake, toggleMistake, toggleResolved, deleteMistake,
    setMistakeStatus, setMistakeType, recStart, recStop, recCancel, voiceUpload, deleteVoice,
    viewImage, closeViewer, replaceImage, deleteImage, runOcr, copyOcr,
    removeDraftVoice, removeDraftMistake, saveTest, switchFormTab, setDetailTab,
    openPhotoQuestion, openManualQuestion, openExtract, qMove, qEdit, qDelete, qToMistake, viewQ,
    saveQuestion, closeQuestionModal, qmPickPhoto, qmRemovePhoto, qmViewPhoto,
    extPick, extRemoveFile, extMoveFile, extRun, extCancel, extEdit, extMove, extMerge, extDelete, extAddItem,
    extResplit, extBack, extConfirm, requestCloseExtract,
    _splitQuestions:splitQuestions
  };
})();

window.Tests = Tests;
