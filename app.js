/* =========================================================
   TaskxNova — app.js
   Core application: dashboard, today's schedule, pomodoro,
   notes, goals, settings, page navigation, boot sequence.
   ========================================================= */

/* ---------------- Gamification ---------------- */
const Gamification = (function(){
  const LEVEL_XP = 200; // xp per level
  const BADGES = [
    { id:'first_log', icon:'🌱', label:'First Steps', test:g => g.totalLogs >= 1 },
    { id:'streak3', icon:'🔥', label:'3-Day Streak', test:g => g.streak >= 3 },
    { id:'streak7', icon:'⚡', label:'Week Warrior', test:g => g.streak >= 7 },
    { id:'streak30', icon:'👑', label:'Monthly Master', test:g => g.streak >= 30 },
    { id:'chapters10', icon:'📘', label:'10 Chapters', test:g => g.chaptersCompleted >= 10 },
    { id:'rev25', icon:'🧠', label:'25 Revisions', test:g => g.revisionsCompleted >= 25 },
    { id:'level5', icon:'💎', label:'Level 5', test:g => levelFor(g.xp).level >= 5 },
    { id:'pomo20', icon:'🍅', label:'20 Pomodoros', test:g => g.pomodoros >= 20 }
  ];

  let state = Storage.get('gamification', null) || {
    xp:0, streak:0, lastActiveDay:null, totalLogs:0, chaptersCompleted:0,
    revisionsCompleted:0, pomodoros:0, earnedBadges:[]
  };

  function save(){ Storage.set('gamification', state); }

  function levelFor(xp){
    const level = Math.floor(xp / LEVEL_XP) + 1;
    const into = xp % LEVEL_XP;
    return { level, into, pct: Math.round((into/LEVEL_XP)*100) };
  }

  function addXP(amount){
    state.xp += amount;
    save();
    checkBadges();
    renderWidget();
  }

  function touchDailyStreak(){
    const today = new Date().toDateString();
    if(state.lastActiveDay === today) return;
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if(state.lastActiveDay === yesterday) state.streak += 1;
    else if(state.lastActiveDay !== today) state.streak = 1;
    state.lastActiveDay = today;
    save();
    checkBadges();
  }

  function onLogAdded(){ state.totalLogs += 1; touchDailyStreak(); addXP(15); }
  function onTaskCompleted(){ touchDailyStreak(); addXP(10); }
  function onChapterCompleted(){ state.chaptersCompleted += 1; save(); touchDailyStreak(); addXP(25); }
  function onRevisionAdded(){ addXP(5); }
  function onRevisionCompleted(){ state.revisionsCompleted += 1; save(); touchDailyStreak(); addXP(20); }
  function onPomodoroCompleted(){ state.pomodoros += 1; save(); touchDailyStreak(); addXP(30); }

  function checkBadges(){
    let newOnes = [];
    BADGES.forEach(b => {
      if(!state.earnedBadges.includes(b.id) && b.test(state)){
        state.earnedBadges.push(b.id);
        newOnes.push(b);
      }
    });
    if(newOnes.length){
      save();
      newOnes.forEach(b => Utils.toast(`Badge unlocked: ${b.icon} ${b.label}`, 'success'));
      renderBadges();
    }
  }

  function renderWidget(){
    const lvl = levelFor(state.xp);
    const lvlNum = document.getElementById('lvlNum');
    if(lvlNum) lvlNum.textContent = lvl.level;
    const ring = document.getElementById('xpRingFill');
    if(ring){
      const c = 2 * Math.PI * 22;
      ring.style.strokeDasharray = c;
      ring.style.strokeDashoffset = c - (c * lvl.pct/100);
    }
    const streakEl = document.getElementById('streakNum');
    if(streakEl) streakEl.textContent = state.streak;
    const streakEl2 = document.getElementById('streakNum2');
    if(streakEl2) streakEl2.textContent = state.streak;
    const xpText = document.getElementById('xpText');
    if(xpText) xpText.textContent = `${lvl.into}/${LEVEL_XP} XP`;
  }

  function renderBadges(){
    const grid = document.getElementById('badgeGrid');
    if(!grid) return;
    grid.innerHTML = BADGES.map(b => `
      <div class="badge ${state.earnedBadges.includes(b.id)?'earned':''}" data-tip="${b.label}">${b.icon}</div>
    `).join('');
  }

  function render(){ renderWidget(); renderBadges(); }

  // Re-read from Storage (used after a cloud merge lands new data).
  function reload(){ state = Storage.get('gamification', state); render(); }

  return { onLogAdded, onTaskCompleted, onChapterCompleted, onRevisionAdded, onRevisionCompleted, onPomodoroCompleted, render, reload, levelFor, get state(){ return state; } };
})();

/* ---------------- Sound effects (Web Audio, no external files) ---------------- */
const SoundFX = (function(){
  let ctx = null;

  function getCtx(){
    if(!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function tone(ac, freq, startOffset, dur, opts){
    opts = opts || {};
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.value = freq;
    const t0 = ac.currentTime + startOffset;
    const peak = opts.peak != null ? opts.peak : 0.16;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function scheduleChime(ac, kind){
    if(kind === 'focusEnd'){
      // bright ascending two-note chime — "focus session done, take a break"
      tone(ac, 880.00, 0,    0.30, { peak:0.18 });
      tone(ac, 1318.51, 0.16, 0.38, { peak:0.16 });
    } else if(kind === 'breakEnd'){
      // softer two-note chime — "break's over, back to focus"
      tone(ac, 659.25, 0,    0.24, { peak:0.14 });
      tone(ac, 987.77, 0.13, 0.30, { peak:0.13 });
    } else if(kind === 'tick'){
      tone(ac, 784, 0, 0.09, { peak:0.10, type:'sine' });
    }
  }

  function play(kind){
    if(!AppSettings.settings.sound) return;
    try{
      const ac = getCtx();
      // A focus/break phase can run for many minutes with the tab backgrounded,
      // during which browsers commonly auto-suspend the AudioContext (power
      // saving / autoplay policy). resume() is async — scheduling tones before
      // it resolves silently drops the sound. Wait for resume, then schedule.
      if(ac.state === 'suspended'){
        ac.resume().then(() => scheduleChime(ac, kind)).catch(() => {});
      } else {
        scheduleChime(ac, kind);
      }
    } catch(err){ /* Web Audio unavailable — fail silently */ }
  }

  function prime(){
    // Called from a real user gesture (tapping Start) so the browser grants
    // audio permission up front, ahead of the timer-triggered chimes later.
    try{
      const ac = getCtx();
      if(ac.state === 'suspended') ac.resume().catch(() => {});
    } catch(err){ /* ignore */ }
  }

  return { play, prime };
})();

/* ---------------- Pomodoro ---------------- */
const Pomodoro = (function(){
  let mode = 'focus25';
  const MODES = { focus25:{focus:25,brk:5}, focus50:{focus:50,brk:10}, custom:{focus:25,brk:5} };
  let phase = 'focus';
  let secondsLeft = MODES.focus25.focus * 60;
  let totalSeconds = secondsLeft;
  let timer = null;
  let running = false;

  function setMode(m){
    mode = m;
    if(m === 'custom'){
      const f = parseInt(prompt('Focus minutes:', MODES.custom.focus)) || MODES.custom.focus;
      const b = parseInt(prompt('Break minutes:', MODES.custom.brk)) || MODES.custom.brk;
      MODES.custom.focus = f; MODES.custom.brk = b;
    }
    reset();
    document.querySelectorAll('.pomo-modes button').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  }

  function reset(){
    pause();
    phase = 'focus';
    secondsLeft = MODES[mode].focus * 60;
    totalSeconds = secondsLeft;
    updateDisplay();
  }

  function toggle(){ running ? pause() : start(); }

  function start(){
    if(running) return;
    SoundFX.prime(); // unlock audio on this user gesture so timer-triggered chimes can play later
    running = true;
    document.getElementById('pomoMainIcon') && (document.getElementById('pomoMainIcon').innerHTML = pauseIcon());
    timer = setInterval(tick, 1000);
  }
  function pause(){
    running = false;
    clearInterval(timer);
    const ic = document.getElementById('pomoMainIcon');
    if(ic) ic.innerHTML = playIcon();
  }

  function tick(){
    secondsLeft -= 1;
    if(secondsLeft <= 0){
      if(phase === 'focus'){
        Gamification.onPomodoroCompleted();
        logPomodoro();
        SoundFX.play('focusEnd');
        Utils.toast('Focus session complete — take a break', 'success');
        phase = 'break';
        secondsLeft = MODES[mode].brk * 60;
        totalSeconds = secondsLeft;
      } else {
        SoundFX.play('breakEnd');
        Utils.toast('Break over — back to focus', 'info');
        phase = 'focus';
        secondsLeft = MODES[mode].focus * 60;
        totalSeconds = secondsLeft;
      }
    } else if(secondsLeft <= 3){
      SoundFX.play('tick'); // short countdown beep for the last 3 seconds of a phase
    }
    updateDisplay();
  }

  function logPomodoro(){
    const log = Storage.get('pomodoroLog', []);
    log.push({ ts: Date.now(), minutes: MODES[mode].focus });
    Storage.set('pomodoroLog', log);
  }

  function updateDisplay(){
    const m = Math.floor(secondsLeft/60), s = secondsLeft%60;
    const t = document.getElementById('pomoTimeText');
    if(t) t.textContent = `${Utils.pad2(m)}:${Utils.pad2(s)}`;
    const modeLabel = document.getElementById('pomoModeText');
    if(modeLabel) modeLabel.textContent = phase === 'focus' ? 'Focus' : 'Break';
    const ring = document.getElementById('pomoRingFill');
    if(ring){
      const c = 2 * Math.PI * 100;
      const pct = totalSeconds ? (secondsLeft/totalSeconds) : 0;
      ring.style.strokeDasharray = c;
      ring.style.strokeDashoffset = c * (1-pct);
    }
  }

  function playIcon(){ return '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'; }
  function pauseIcon(){ return '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>'; }

  function init(){ updateDisplay(); }

  return { setMode, toggle, start, reset, init };
})();

/* ---------------- Notes ---------------- */
const Notes = (function(){
  // normalize old notes (pre-attachments) so every note has an attachments array
  let notes = Storage.get('notes', []).map(n => ({ attachments: [], ...n }));
  let filter = '';

  // transient (not persisted) upload progress per note id: { done, total }
  let uploadStatus = {};
  // transient target for the shared hidden file input: { noteId, mode:'add'|'replace', attId }
  let pendingTarget = null;

  function save(){ Storage.set('notes', notes); }

  function add(title, body){
    const n = { id: Utils.uid(), title: title || 'Untitled note', body: body || '', pinned:false, ts:Date.now(), attachments:[] };
    notes.unshift(n);
    save(); render();
    return n;
  }
  function update(id, field, value){
    const n = notes.find(x => x.id === id);
    if(n){ n[field] = value; n.ts = Date.now(); save(); }
  }
  function togglePin(id){
    const n = notes.find(x => x.id === id);
    if(n){ n.pinned = !n.pinned; save(); render(); }
  }
  function remove(id){
    const n = notes.find(x => x.id === id);
    if(n){ (n.attachments||[]).forEach(a => AttachmentDB.remove(a.id).catch(()=>{})); }
    notes = notes.filter(n => n.id !== id);
    save(); render();
  }
  function setFilter(term){ filter = term.toLowerCase(); render(); }

  /* ---------------- Attachments ---------------- */

  function pickFiles(noteId){
    const input = document.getElementById('noteFileInput');
    if(!input) return;
    pendingTarget = { noteId, mode:'add' };
    input.multiple = true;
    input.value = '';
    input.click();
  }

  function pickReplacement(noteId, attId){
    const input = document.getElementById('noteFileInput');
    if(!input) return;
    pendingTarget = { noteId, mode:'replace', attId };
    input.multiple = false;
    input.value = '';
    input.click();
  }

  function onFileInputChange(e){
    const files = e.target.files;
    const target = pendingTarget;
    pendingTarget = null;
    if(!target || !files || !files.length) return;
    if(target.mode === 'add') handleFiles(target.noteId, files);
    else handleReplace(target.noteId, target.attId, files[0]);
  }

  function handleDrop(e, noteId){
    e.preventDefault();
    const files = e.dataTransfer && e.dataTransfer.files;
    if(files && files.length) handleFiles(noteId, files);
  }

  async function handleFiles(noteId, fileList){
    const files = Array.from(fileList || []);
    if(!files.length) return;
    const n = notes.find(x => x.id === noteId);
    if(!n) return;
    if(!n.attachments) n.attachments = [];

    uploadStatus[noteId] = { done:0, total:files.length };
    render();

    for(const file of files){
      const check = AttachmentUtils.validate(file);
      if(!check.ok){
        Utils.toast(check.reason, 'error');
        uploadStatus[noteId].done++;
        continue;
      }
      const isDup = n.attachments.some(a => a.name === file.name && (a.origSize || a.size) === file.size);
      if(isDup){
        Utils.toast(`"${file.name}" is already attached.`, 'info');
        uploadStatus[noteId].done++;
        continue;
      }
      const ext = AttachmentUtils.extOf(file.name);
      const isImg = AttachmentUtils.isImageExt(ext);
      const attId = Utils.uid();
      try{
        if(isImg){
          const { blob, thumb } = await AttachmentUtils.processImage(file, ext);
          await AttachmentDB.put(attId, blob);
          n.attachments.push({ id:attId, name:file.name, mime:file.type||blob.type, size:blob.size, origSize:file.size, kind:'image', ext, thumb, addedAt:Date.now() });
        } else {
          await AttachmentDB.put(attId, file);
          n.attachments.push({ id:attId, name:file.name, mime:file.type, size:file.size, origSize:file.size, kind:'file', ext, addedAt:Date.now() });
        }
      }catch(err){
        console.warn('Attachment failed', err);
        Utils.toast(`Couldn't attach "${file.name}".`, 'error');
      }
      uploadStatus[noteId].done++;
      n.ts = Date.now();
      save(); render();
    }
    delete uploadStatus[noteId];
    save(); render();
  }

  async function handleReplace(noteId, attId, file){
    if(!file) return;
    const n = notes.find(x => x.id === noteId);
    if(!n) return;
    const idx = (n.attachments||[]).findIndex(a => a.id === attId);
    if(idx === -1) return;
    const check = AttachmentUtils.validate(file);
    if(!check.ok){ Utils.toast(check.reason, 'error'); return; }

    uploadStatus[noteId] = { done:0, total:1 };
    render();

    const ext = AttachmentUtils.extOf(file.name);
    const isImg = AttachmentUtils.isImageExt(ext);
    const keepId = n.attachments[idx].id;
    try{
      if(isImg){
        const { blob, thumb } = await AttachmentUtils.processImage(file, ext);
        await AttachmentDB.put(keepId, blob);
        n.attachments[idx] = { id:keepId, name:file.name, mime:file.type||blob.type, size:blob.size, origSize:file.size, kind:'image', ext, thumb, addedAt:Date.now() };
      } else {
        await AttachmentDB.put(keepId, file);
        n.attachments[idx] = { id:keepId, name:file.name, mime:file.type, size:file.size, origSize:file.size, kind:'file', ext, addedAt:Date.now() };
      }
      n.ts = Date.now();
      Utils.toast(`Replaced "${file.name}".`, 'success');
    }catch(err){
      console.warn('Attachment replace failed', err);
      Utils.toast(`Couldn't replace attachment.`, 'error');
    }
    delete uploadStatus[noteId];
    save(); render();
  }

  function removeAttachment(noteId, attId){
    const n = notes.find(x => x.id === noteId);
    if(!n) return;
    n.attachments = (n.attachments||[]).filter(a => a.id !== attId);
    n.ts = Date.now();
    AttachmentDB.remove(attId).catch(()=>{});
    save(); render();
  }

  async function viewAttachment(attId){
    try{
      const blob = await AttachmentDB.get(attId);
      if(!blob){ Utils.toast('File data not found on this device.', 'error'); return; }
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      // give the new tab time to load the blob before releasing it
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }catch(err){
      console.warn('View attachment failed', err);
      Utils.toast('Could not open file.', 'error');
    }
  }

  async function downloadAttachment(attId){
    try{
      const blob = await AttachmentDB.get(attId);
      if(!blob){ Utils.toast('File data not found on this device.', 'error'); return; }
      const owner = notes.find(x => (x.attachments||[]).some(a => a.id === attId));
      const meta = owner && owner.attachments.find(a => a.id === attId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = meta ? meta.name : 'download';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }catch(err){
      console.warn('Download attachment failed', err);
      Utils.toast('Could not download file.', 'error');
    }
  }

  async function openLightbox(attId){
    const owner = notes.find(x => (x.attachments||[]).some(a => a.id === attId));
    const meta = owner && owner.attachments.find(a => a.id === attId);
    if(!meta) return;
    const overlay = document.getElementById('attachmentLightbox');
    const img = document.getElementById('lightboxImg');
    const dl = document.getElementById('lightboxDownload');
    const name = document.getElementById('lightboxName');
    if(!overlay || !img) return;
    img.src = meta.thumb || '';
    if(name) name.textContent = meta.name;
    if(dl) dl.download = meta.name;
    overlay.classList.add('open');
    try{
      const blob = await AttachmentDB.get(attId);
      if(blob){
        const url = URL.createObjectURL(blob);
        img.src = url;
        if(dl) dl.href = url;
      }
    }catch(err){ /* keep showing the thumbnail on failure */ }
  }

  function closeLightbox(){
    const overlay = document.getElementById('attachmentLightbox');
    if(overlay) overlay.classList.remove('open');
    const img = document.getElementById('lightboxImg');
    if(img) img.src = '';
  }

  function attachmentCardHtml(n, a){
    if(a.kind === 'image'){
      return `<div class="att-thumb" onclick="Notes.openLightbox('${a.id}')" data-tip="${Utils.escapeHtml(a.name)}">
        <img src="${a.thumb}" loading="lazy" alt="${Utils.escapeHtml(a.name)}">
        <div class="att-thumb-actions">
          <button onclick="event.stopPropagation();Notes.pickReplacement('${n.id}','${a.id}')" data-tip="Replace">⇄</button>
          <button onclick="event.stopPropagation();Notes.removeAttachment('${n.id}','${a.id}')" data-tip="Remove">✕</button>
        </div>
      </div>`;
    }
    return `<div class="att-file">
      <div class="att-file-icon">${AttachmentUtils.iconSvg(a.ext)}</div>
      <div class="att-file-meta">
        <span class="att-file-name" title="${Utils.escapeHtml(a.name)}">${Utils.escapeHtml(a.name)}</span>
        <span class="att-file-size">${AttachmentUtils.formatBytes(a.size)}</span>
      </div>
      <div class="att-file-actions">
        <button onclick="Notes.viewAttachment('${a.id}')" data-tip="Open">↗</button>
        <button onclick="Notes.downloadAttachment('${a.id}')" data-tip="Download">⬇</button>
        <button onclick="Notes.pickReplacement('${n.id}','${a.id}')" data-tip="Replace">⇄</button>
        <button onclick="Notes.removeAttachment('${n.id}','${a.id}')" data-tip="Delete">✕</button>
      </div>
    </div>`;
  }

  function render(){
    const grid = document.getElementById('notesGrid');
    if(!grid) return;
    let list = notes.filter(n => !filter || n.title.toLowerCase().includes(filter) || n.body.toLowerCase().includes(filter));
    list = [...list.filter(n=>n.pinned), ...list.filter(n=>!n.pinned)];
    if(list.length === 0){
      grid.innerHTML = `<div class="queue-empty"><div class="msg">No notes yet — tap + Add Note to start</div></div>`;
      return;
    }
    grid.innerHTML = list.map(n => {
      const atts = n.attachments || [];
      const status = uploadStatus[n.id];
      const attachmentsBlock = (atts.length || status) ? `
        <div class="note-attachments">
          ${atts.map(a => attachmentCardHtml(n, a)).join('')}
          ${status ? `<div class="note-upload-progress"><span class="spinner"></span> Processing ${status.done}/${status.total}…</div>` : ''}
        </div>` : '';
      return `
      <div class="note-card ${n.pinned?'pinned':''}"
        ondragover="event.preventDefault();event.currentTarget.classList.add('drag-over')"
        ondragleave="event.currentTarget.classList.remove('drag-over')"
        ondrop="event.currentTarget.classList.remove('drag-over');Notes.handleDrop(event,'${n.id}')">
        <input class="note-title" value="${Utils.escapeHtml(n.title)}" onchange="Notes.update('${n.id}','title',this.value)">
        <textarea class="note-body" onchange="Notes.update('${n.id}','body',this.value)">${Utils.escapeHtml(n.body)}</textarea>
        ${attachmentsBlock}
        <div class="note-foot">
          <span class="note-date">${Utils.fmtDate(n.ts)}</span>
          <div class="note-actions">
            <button onclick="Notes.pickFiles('${n.id}')" data-tip="Attach file or image">📎</button>
            <button class="${n.pinned?'pin-on':''}" onclick="Notes.togglePin('${n.id}')" data-tip="Pin">📌</button>
            <button onclick="Notes.remove('${n.id}')" data-tip="Delete">🗑️</button>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  // Re-read from Storage (used after a cloud merge lands new data).
  function reload(){ notes = Storage.get('notes', []).map(n => ({ attachments: [], ...n })); render(); }

  return {
    add, update, togglePin, remove, setFilter, render, reload,
    pickFiles, pickReplacement, onFileInputChange, handleDrop,
    handleFiles, handleReplace, removeAttachment, viewAttachment, downloadAttachment,
    openLightbox, closeLightbox
  };
})();

/* ---------------- Goals ---------------- */
const Goals = (function(){
  let goals = Storage.get('goals', { daily:4, weekly:24, monthly:90 });

  function save(){ Storage.set('goals', goals); }
  function setTarget(period, val){ goals[period] = parseFloat(val) || 0; save(); render(); }

  function progress(period){
    const entries = Storage.get('entries', []);
    const now = new Date();
    let hours = 0;
    if(period === 'daily') hours = entries.filter(e => Utils.sameDay(e.ts, now)).reduce((s,e)=>s+e.dur,0);
    if(period === 'weekly'){
      const start = new Date(now); start.setDate(now.getDate()-now.getDay()); start.setHours(0,0,0,0);
      hours = entries.filter(e => e.ts >= start.getTime()).reduce((s,e)=>s+e.dur,0);
    }
    if(period === 'monthly') hours = entries.filter(e => new Date(e.ts).getMonth()===now.getMonth() && new Date(e.ts).getFullYear()===now.getFullYear()).reduce((s,e)=>s+e.dur,0);
    const target = goals[period] || 1;
    return { hours, target, pct: Utils.clamp(Math.round((hours/target)*100),0,100) };
  }

  function render(){
    const box = document.getElementById('goalsBox');
    if(!box) return;
    const periods = [['daily','Daily Goal'],['weekly','Weekly Goal'],['monthly','Monthly Goal']];
    box.innerHTML = periods.map(([key,label]) => {
      const p = progress(key);
      return `
      <div class="goal-card">
        <div class="goal-top">
          <span class="goal-label">${label}</span>
          <span class="goal-pct">${p.pct}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${p.pct}%;background:var(--primary-grad);"></div></div>
        <div class="field-row" style="margin-top:10px;">
          <span class="q-meta" style="font-size:11px;">${Utils.formatDuration(p.hours)} of</span>
          <input type="number" step="0.5" value="${goals[key]}" style="width:70px;" onchange="Goals.setTarget('${key}', this.value)">
          <span class="q-meta" style="font-size:11px;">hrs</span>
        </div>
      </div>`;
    }).join('');
  }

  // Re-read from Storage (used after a cloud merge lands new data).
  function reload(){ goals = Storage.get('goals', goals); render(); }

  return { setTarget, progress, render, reload };
})();

/* ---------------- Settings ---------------- */
const AppSettings = (function(){
  let settings = Storage.get('settings', { theme:'dark', accent:'#6C63FF', notifications:true, sound:true });
  if(settings.sound === undefined) settings.sound = true; // migrate older saved settings

  function save(){ Storage.set('settings', settings); }

  function applyTheme(){
    document.documentElement.setAttribute('data-theme', settings.theme);
    document.documentElement.style.setProperty('--primary', settings.accent);
  }

  function toggleTheme(){
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    save(); applyTheme(); render();
  }
  function setAccent(hex){
    settings.accent = hex; save(); applyTheme(); render();
  }
  function toggleNotifications(){
    settings.notifications = !settings.notifications;
    save(); render();
  }
  function toggleSound(){
    settings.sound = !settings.sound;
    save(); render();
    if(settings.sound) SoundFX.play('breakEnd'); // quick audible confirmation it's on
  }

  function render(){
    const themeSwitch = document.getElementById('themeSwitch');
    if(themeSwitch) themeSwitch.classList.toggle('on', settings.theme === 'light');
    const notifSwitch = document.getElementById('notifSwitch');
    if(notifSwitch) notifSwitch.classList.toggle('on', settings.notifications);
    const soundSwitch = document.getElementById('soundSwitch');
    if(soundSwitch) soundSwitch.classList.toggle('on', settings.sound);
    document.querySelectorAll('.pomo-sound-toggle').forEach(b => b.classList.toggle('muted', !settings.sound));
    document.querySelectorAll('.accent-dot').forEach(d => d.classList.toggle('active', d.dataset.color === settings.accent));
  }

  function init(){ applyTheme(); }

  // Re-read from Storage (used after a cloud merge lands new data).
  function reload(){ settings = Storage.get('settings', settings); applyTheme(); render(); }

  return { toggleTheme, setAccent, toggleNotifications, toggleSound, save, render, init, reload, get settings(){ return settings; } };
})();

/* ---------------- Core App ---------------- */
  const App = (function(){
  const CATS = { "Physics":"#FBBF24", "Chemistry":"#60A5FA", "Maths":"#A78BFA" };
  let entries = Storage.get('entries', []) || [];
  let tasks = Storage.get('tasks', []) || [];

  /* One-time, idempotent migration: minutes are now the canonical internal
     duration unit for newly-created entries/tasks (see addEntry/addTask), but
     any record saved before this change only has the old decimal-hours field
     (`dur`/`duration`). Backfill the integer-minutes companion field from it
     so every record has one — the legacy hour field itself is left exactly as
     it was, so nothing that still reads it changes behavior. */
  function normalizeDurations(){
    let changed = false;
    entries.forEach(e => {
      if(e.durMin === undefined && typeof e.dur === 'number'){ e.durMin = Math.round(e.dur * 60); changed = true; }
    });
    tasks.forEach(t => {
      if(t.durationMin === undefined && typeof t.duration === 'number'){ t.durationMin = Math.round(t.duration * 60); changed = true; }
    });
    if(changed){ save(); saveTasks(); }
  }
  normalizeDurations();

  let range = 'today';
  let currentPage = 'dashboard';
  let reminderDismissed = false;
  let distChart, waveChart;

  function save(){ Storage.set('entries', entries); }
  function saveTasks(){ Storage.set('tasks', tasks); }
  function reloadAll(){
  entries = Storage.get('entries', []) || [];
  tasks = Storage.get('tasks', []) || [];
  normalizeDurations();
  Revision.reload();
  Syllabus.reload();
  Reminders.reload();
  Notes.reload();
  Goals.reload();
  Gamification.reload();
  AppSettings.reload();
  render();
  Revision.render();
  Syllabus.render();
  Calendar.render();
  Notes.render();
  Goals.render();
  Gamification.render();
}
 
  function inRange(ts){
    const d = new Date(ts), n = new Date();
    if(range === 'today') return d.toDateString() === n.toDateString();
    if(range === 'week'){ const start = new Date(n); start.setDate(n.getDate()-n.getDay()); start.setHours(0,0,0,0); return d >= start; }
    if(range === 'month') return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
    if(range === 'year') return d.getFullYear() === n.getFullYear();
    return true;
  }

  function setRange(r){
    range = r;
    document.querySelectorAll('#rangeTabs button').forEach(b => b.classList.toggle('active', b.dataset.range === r));
    render();
  }

  function updateClock(){
    const now = new Date();
    const dateEl = document.getElementById('dateStr');
    const timeEl = document.getElementById('timeStr');
    if(dateEl) dateEl.textContent = now.toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric',year:'numeric'}).toUpperCase();
    if(timeEl) timeEl.textContent = now.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
    const chip = document.getElementById('topbarDate');
    if(chip) chip.textContent = now.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  }

  function render(){
    const greetEl = document.getElementById('greetText');
    if(greetEl) greetEl.textContent = Utils.greeting();
    const quoteEl = document.getElementById('quoteText');
    if(quoteEl) quoteEl.textContent = Utils.dailyQuote();

    const periodEntries = entries.filter(e => inRange(e.ts));
    const gross = periodEntries.reduce((s,e)=>s+e.dur,0);
    const probPeriod = periodEntries.reduce((s,e)=>s+(e.prob||0),0);
    const probTotal = entries.reduce((s,e)=>s+(e.prob||0),0);
    const focus = gross > 0 ? Math.min(100, Math.round((probPeriod / (gross*4)) * 100)) : 0;
    const dueCounts = Revision.getDueCounts ? Revision.getDueCounts() : {total:0};
    const tasksDone = tasks.filter(t => Utils.sameDay(t.date||Date.now(), new Date()) && t.done).length;
    const tasksTotal = tasks.filter(t => Utils.sameDay(t.date||Date.now(), new Date())).length;

    setNum('statGross', gross, { format: v => Utils.formatDuration(v) });
    setNum('statProbPeriod', probPeriod, {});
    setNum('statFocus', focus, {suffix:'%'});
    setText('statRevDue', dueCounts.total);
    setText('statTasksDone', `${tasksDone}/${tasksTotal}`);
    setText('statStreak', Gamification.state.streak);

    Charts.distribution(periodEntries, CATS);
    Charts.weeklyWave(entries);
    Charts.monthlyBars(entries);
    Charts.heatmap(entries);

    renderTasks();
    renderQueue();
  }

  function setNum(id, val, opts){
    const el = document.getElementById(id);
    if(!el) return;
    Utils.animateCounter(el, val, opts);
  }
  function setText(id, val){ const el = document.getElementById(id); if(el) el.textContent = val; }

  let queueView = 'today';

  function setQueueView(v){
    queueView = v;
    document.querySelectorAll('#queueTabs .q-tab').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    const clearBtn = document.getElementById('queueClearBtn');
    if(clearBtn) clearBtn.style.display = v === 'today' ? '' : 'none';
    renderQueue();
  }

  function queueItemHtml(e){
    const priority = e.priority || 'medium';
    const completed = e.completed !== false; // undefined/true = completed (existing entries default to completed)
    return `
        <div class="queue-item">
          <span class="q-dot" style="background:${CATS[e.cat]||'var(--text-faint)'}"></span>
          <div class="q-main">
            <div class="q-desc">${Utils.escapeHtml(e.desc)}${!completed ? ' <span class="priority-tag low">PLANNED</span>' : ''}</div>
            <div class="q-meta">${e.type ? Utils.formatTaskTypes(e.type) + ' · ' : ''}${Utils.formatDuration(e.dur)} · ${e.prob||0} problems · ${Utils.fmtTime(e.ts)}</div>
            ${e.notes ? `<div class="q-notes">${Utils.escapeHtml(e.notes)}</div>` : ''}
          </div>
          <span class="priority-tag ${priority}">${priority.toUpperCase()}</span>
          <span class="q-cat-tag" style="background:${CATS[e.cat]||'rgba(255,255,255,0.08)'}22; color:${CATS[e.cat]||'var(--text-dim)'};">${e.cat}</span>
          <button class="q-edit" onclick="App.openEditEntry('${e.ts}')" data-tip="Edit"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
          <button class="q-del" onclick="App.removeEntry('${e.ts}')">&times;</button>
        </div>`;
  }

  function renderQueue(){
    const list = document.getElementById('queueList');
    if(!list) return;

    if(queueView === 'past'){
      const past = entries.filter(e => !Utils.sameDay(e.ts, new Date())).sort((a,b)=>b.ts-a.ts);
      if(past.length === 0){
        list.innerHTML = `<div class="queue-empty">
          <div class="msg">No past objectives logged yet</div>
        </div>`;
        return;
      }
      let html = '', lastKey = '';
      past.forEach(e => {
        const key = new Date(e.ts).toDateString();
        if(key !== lastKey){ html += `<div class="queue-date-heading">${Utils.fmtDateLong(e.ts)}</div>`; lastKey = key; }
        html += queueItemHtml(e);
      });
      list.innerHTML = html;
      return;
    }

    const todays = entries.filter(e => Utils.sameDay(e.ts, new Date())).sort((a,b)=>b.ts-a.ts);
    if(todays.length === 0){
      list.innerHTML = `<div class="queue-empty">
        <div class="ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5D5D80" stroke-width="1.8"><path d="M12 2l1.5 6L20 9l-6 3 1 7-3-4-3 4 1-7-6-3 6.5-1z"/></svg></div>
        <div class="msg">No study sessions logged for today</div>
      </div>`;
    } else {
      list.innerHTML = todays.map(queueItemHtml).join('');
    }
  }

  function addEntry(desc, cat, type, dur, prob, taskId){
    const ts = Date.now();
    const entry = { ts, desc, cat, type, dur, durMin: Math.round((dur||0) * 60), prob };
    if(taskId) entry.taskId = taskId; // stable link back to the task, independent of ts collisions
    entries.push(entry);
    save();
    Gamification.onLogAdded();
    render();
    return ts;
  }
  function removeEntry(ts){
    const removed = entries.find(e => e.ts == ts);
    entries = entries.filter(e => e.ts != ts);
    const linked = tasks.find(t => t.id === (removed && removed.taskId) || t.entryTs == ts);
    if(linked){ linked.entryTs = null; linked.done = false; saveTasks(); }
    save(); render();
  }
  /* Editing an Objectives (queue) entry — mirrors editTask's pattern below:
     updates the entry in place (no duplicate created) and, if this entry is
     linked back to a Today's Schedule task, keeps that task's fields in sync
     too so the two views never drift apart. */
  function editEntry(ts, patch){
    const e = entries.find(x => String(x.ts) === String(ts));
    if(!e) return null;
    const oldTs = e.ts;
    ['desc','cat','type','dur','prob','priority','notes','completed'].forEach(k => {
      if(patch[k] === undefined) return;
      e[k] = patch[k];
    });
    if(patch.dur !== undefined) e.durMin = Math.round((patch.dur||0) * 60);
    if(patch.dateStr){
      const d = new Date(patch.dateStr + 'T00:00:00');
      if(!isNaN(d)){
        const old = new Date(oldTs);
        d.setHours(old.getHours(), old.getMinutes(), old.getSeconds(), old.getMilliseconds());
        let newTs = d.getTime();
        while(entries.some(x => x !== e && x.ts === newTs)) newTs += 1; // avoid ts collisions — ts doubles as a stable id
        e.ts = newTs;
        const linkedTask = tasks.find(t => t.entryTs === oldTs);
        if(linkedTask){ linkedTask.entryTs = newTs; saveTasks(); }
      }
    }
    if(e.taskId){
      const t = tasks.find(x => x.id === e.taskId);
      if(t){
        if(patch.desc !== undefined) t.title = patch.desc;
        if(patch.cat !== undefined) t.subject = patch.cat;
        if(patch.type !== undefined) t.type = patch.type;
        if(patch.dur !== undefined){ t.duration = patch.dur; t.durationMin = e.durMin; }
        if(patch.prob !== undefined) t.problems = patch.prob;
        if(patch.priority !== undefined) t.priority = patch.priority;
        saveTasks();
      }
    }
    save();
    render();
    return e;
  }
  function clearQueue(){
    if(queueView === 'past'){ Utils.toast('Switch to Today to clear entries', 'info'); return; }
    if(!confirm("Clear all of today's logged objectives? This cannot be undone.")) return;
    entries = entries.filter(e => !Utils.sameDay(e.ts, new Date()));
    tasks.forEach(t => { if(t.date === new Date().toDateString()){ t.entryTs = null; t.done = false; } });
    saveTasks(); save(); render();
  }

  /* ------- Today's Schedule (tasks) — integrates logging a session ------- */
  function addTask(title, subject, type, duration, problems, priority, dateStr){
    const task = { id: Utils.uid(), title, subject, type, duration, durationMin: Math.round((duration||0) * 60), problems, priority: priority||'medium', done:false, date: dateStr || new Date().toDateString(), entryTs:null, subtasks:[] };
    tasks.push(task);
    saveTasks();
    if(duration > 0 && task.date === new Date().toDateString()){
      task.entryTs = addEntry(title, subject, type, duration, problems, task.id);
      task.done = true;
      saveTasks();
    }
    render();
    return task;
  }
  /* Explicit done-state setter — toggleTask below is just a thin wrapper around
     this so UI clicks and AI-driven completeTask/restoreTask share one code path. */
  function setTaskDone(id, done){
    const t = tasks.find(x => x.id === id);
    if(!t) return null;
    t.done = !!done;
    if(t.done && !t.entryTs){
      t.entryTs = addEntry(t.title, t.subject, t.type||'', t.duration||0, t.problems||0, t.id);
    } else if(t.done){
      Gamification.onTaskCompleted();
    } else if(!t.done && t.entryTs){
      // match by taskId as well as ts — a stable identity so an unlucky Date.now()
      // collision between two entries can never remove (or leave behind) the wrong one
      entries = entries.filter(e => e.ts !== t.entryTs && e.taskId !== t.id);
      save();
      t.entryTs = null;
    }
    saveTasks();
    render();
    return t;
  }
  function toggleTask(id){
    const t = tasks.find(x => x.id === id);
    if(!t) return;
    setTaskDone(id, !t.done);
  }
  function deleteTask(id){
    const t = tasks.find(x => x.id === id);
    if(t && t.entryTs){ entries = entries.filter(e => e.ts !== t.entryTs && e.taskId !== t.id); save(); }
    tasks = tasks.filter(x => x.id !== id);
    saveTasks(); render();
  }
  function editTask(id, patch){
    const t = tasks.find(x => x.id === id);
    if(!t) return null;
    const allowed = ['title','subject','type','duration','problems','priority','date'];
    allowed.forEach(k => {
      if(patch[k] === undefined || patch[k] === null) return;
      if(patch[k] === '' && k !== 'type') return; // blank is only a valid value for Type ("—")
      t[k] = patch[k];
    });
    if(patch.duration !== undefined && patch.duration !== null) t.durationMin = Math.round((t.duration||0) * 60);
    saveTasks();
    // A task that's already checked off has a linked Objectives entry — if the
    // user then edits its title/subject/type/duration/problems, that entry must
    // be updated too, or Objectives silently goes stale/out of sync.
    if(t.entryTs){
      const entry = entries.find(e => e.taskId === t.id || e.ts === t.entryTs);
      if(entry){
        entry.desc = t.title;
        entry.cat = t.subject;
        entry.type = t.type || '';
        entry.dur = t.duration || 0;
        entry.durMin = Math.round((t.duration||0) * 60);
        entry.prob = t.problems || 0;
        if(!entry.taskId) entry.taskId = t.id; // backfill link for entries logged before this fix
        save();
      }
    }
    render();
    return t;
  }
  function getTasks(filter){
    filter = filter || {};
    let list = tasks.slice();
    if(filter.id) list = list.filter(t => t.id === filter.id);
    if(filter.date) list = list.filter(t => t.date === new Date(filter.date).toDateString());
    if(filter.from) list = list.filter(t => new Date(t.date) >= new Date(new Date(filter.from).toDateString()));
    if(filter.to) list = list.filter(t => new Date(t.date) <= new Date(new Date(filter.to).toDateString()));
    if(filter.done !== undefined && filter.done !== null) list = list.filter(t => !!t.done === !!filter.done);
    if(filter.subject) list = list.filter(t => (t.subject||'').toLowerCase() === String(filter.subject).toLowerCase());
    if(filter.priority) list = list.filter(t => t.priority === filter.priority);
    if(filter.query){
      const q = String(filter.query).toLowerCase();
      list = list.filter(t => t.title.toLowerCase().includes(q));
    }
    return list;
  }
  function addSubtask(taskId, title){
    const t = tasks.find(x => x.id === taskId);
    if(!t || !title) return null;
    t.subtasks = t.subtasks || [];
    const sub = { id: Utils.uid(), title, done:false };
    t.subtasks.push(sub);
    saveTasks(); render();
    return sub;
  }
  function toggleSubtask(taskId, subtaskId){
    const t = tasks.find(x => x.id === taskId);
    if(!t || !t.subtasks) return;
    const s = t.subtasks.find(x => x.id === subtaskId);
    if(!s) return;
    s.done = !s.done;
    saveTasks(); render();
  }
  function deleteSubtask(taskId, subtaskId){
    const t = tasks.find(x => x.id === taskId);
    if(!t || !t.subtasks) return;
    t.subtasks = t.subtasks.filter(x => x.id !== subtaskId);
    saveTasks(); render();
  }
  function getStatistics(rangeKey){
    rangeKey = rangeKey || 'today';
    const now = new Date();
    const inR = (ts) => {
      const d = new Date(ts);
      if(rangeKey === 'today') return d.toDateString() === now.toDateString();
      if(rangeKey === 'week'){ const start = new Date(now); start.setDate(now.getDate()-now.getDay()); start.setHours(0,0,0,0); return d >= start; }
      if(rangeKey === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      if(rangeKey === 'year') return d.getFullYear() === now.getFullYear();
      return true; // 'all'
    };
    const periodEntries = entries.filter(e => inR(e.ts));
    const gross = periodEntries.reduce((s,e)=>s+e.dur,0);
    const probPeriod = periodEntries.reduce((s,e)=>s+(e.prob||0),0);
    const focus = gross > 0 ? Math.min(100, Math.round((probPeriod / (gross*4)) * 100)) : 0;
    const dueCounts = Revision.getDueCounts ? Revision.getDueCounts() : {overdue:0, dueToday:0, total:0};
    const todayStr = new Date().toDateString();
    const tasksToday = tasks.filter(t => t.date === todayStr);
    return {
      range: rangeKey,
      studyHours: Math.round(gross*10)/10,
      problemsSolved: probPeriod,
      focusScorePct: focus,
      revisionDue: dueCounts,
      tasksToday: { done: tasksToday.filter(t=>t.done).length, total: tasksToday.length },
      streak: Gamification.state.streak,
      level: Gamification.levelFor(Gamification.state.xp).level
    };
  }
  function renderTasks(){
    const list = document.getElementById('taskList');
    if(!list) return;
    const todays = tasks.filter(t => t.date === new Date().toDateString());
    if(todays.length === 0){
      list.innerHTML = `<div class="queue-empty"><div class="msg">No objectives scheduled — add one above</div></div>`;
      return;
    }
    list.innerHTML = todays.map(t => `
      <div class="task-row">
        <div class="task-check ${t.done?'on':''}" onclick="App.toggleTask('${t.id}')">${t.done?'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>':''}</div>
        <div class="task-body">
          <div class="task-title ${t.done?'done':''}">${Utils.escapeHtml(t.title)}</div>
          <div class="task-meta">${t.subject||'General'}${t.type?' · '+Utils.formatTaskTypes(t.type):''}${t.duration?' · '+Utils.formatDuration(t.duration):''}${t.problems?' · '+t.problems+' probs':''}</div>
          ${t.subtasks && t.subtasks.length ? `<div class="task-subtasks">${t.subtasks.map(s => `
            <div class="subtask-row">
              <span class="subtask-check ${s.done?'on':''}" onclick="App.toggleSubtask('${t.id}','${s.id}')"></span>
              <span class="subtask-title ${s.done?'done':''}">${Utils.escapeHtml(s.title)}</span>
            </div>`).join('')}</div>` : ''}
        </div>
        <span class="priority-tag ${t.priority}">${t.priority.toUpperCase()}</span>
        <button class="q-edit" onclick="App.openEditTask('${t.id}')" data-tip="Edit"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
        <button class="q-del" onclick="App.deleteTask('${t.id}')">&times;</button>
      </div>`).join('');
  }

  /* ------- Reminders ------- */
  function checkReminder(){
    if(reminderDismissed) return;
    const c = Revision.getDueCounts();
    const bar = document.getElementById('reminderBar');
    if(!bar) return;
    if(c.total === 0){ bar.style.display = 'none'; return; }
    let msg = '';
    if(c.overdue > 0 && c.dueToday > 0) msg = `<b>${c.overdue} topic${c.overdue!=1?'s':''} overdue</b> and <b>${c.dueToday} due today</b> for revision.`;
    else if(c.overdue > 0) msg = `<b>${c.overdue} topic${c.overdue!=1?'s':''} overdue</b> for revision — revise before it slips further.`;
    else msg = `<b>${c.dueToday} topic${c.dueToday!=1?'s':''} due today</b> for revision.`;
    document.getElementById('reminderText').innerHTML = msg;
    bar.style.display = 'block';
  }
  function dismissReminder(){ reminderDismissed = true; document.getElementById('reminderBar').style.display = 'none'; }
  function gotoRevisionFromReminder(){ dismissReminder(); setPage('revision'); }

  /* ------- Page nav ------- */
  function setPage(page){
    currentPage = page;
    document.querySelectorAll('#pageNav .page-tab').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    document.querySelectorAll('.page-view').forEach(el => el.style.display = 'none');
    const target = document.getElementById('page-' + page);
    if(target) { target.style.display = 'block'; target.classList.add('anim-in'); }
    if(page === 'revision') Revision.render();
    if(page === 'syllabus') Syllabus.render();
    if(page === 'calendar') Calendar.render();
    if(page === 'notes') Notes.render();
    if(page === 'goals') Goals.render();
    if(page === 'gamification') Gamification.render();
    if(page === 'settings') AppSettings.render();
  }

  /* ------- Search & filter ------- */
  function globalSearch(term){
    term = term.trim().toLowerCase();
    if(!term) return;
    const inTasks = tasks.some(t => t.title.toLowerCase().includes(term));
    const inTopics = Revision.topics.some(t => t.name.toLowerCase().includes(term));
    const inNotes = (Storage.get('notes',[])||[]).some(n => n.title.toLowerCase().includes(term) || n.body.toLowerCase().includes(term));
    if(inNotes) setPage('notes');
    else if(inTopics) setPage('revision');
    else if(inTasks) setPage('dashboard');
    Notes.setFilter(term);
  }

  /* ------- Data reset / backup ------- */
  function resetData(){
    // Explicit, user-confirmed local reset — unrelated to cloud sync/migration
    // (those never call this). Only wipes THIS DEVICE's active namespace —
    // the signed-in account's own local cache if signed in, or the shared
    // guest cache otherwise. The cloud copy in Firestore (if signed in) is
    // untouched, so signing back in on this device (or any other) still
    // restores everything. Never touches another account's namespace, and
    // never touches the legacy unscoped keys unless that IS the active
    // namespace (i.e. currently in guest mode).
    if(!confirm('Reset UQTxNova data on this device for the current session? This clears this device\'s local cache only — your cloud account data (if signed in) is not affected.')) return;
    const prefix = Storage.activePrefix();
    Storage.KEYS.forEach(k => localStorage.removeItem(prefix + k));
    localStorage.removeItem(prefix + '__meta');
    location.reload();
  }
  function importFile(fileInput){
    const file = fileInput.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try{ Storage.importJSON(e.target.result); Utils.toast('Backup imported', 'success'); reloadAll(); }
      catch(err){ Utils.toast('Import failed: ' + err.message, 'error'); }
    };
    reader.readAsText(file);
  }

  /* ------- Edit Task modal ------- */
  function toDateInputValue(dateStr){
    if(!dateStr) return '';
    const d = new Date(dateStr);
    if(isNaN(d)) return '';
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  /* ------- Type multi-select dropdown (Lecture/DPP/Revision/PYQ/HW) -------
     One dropdown control per spec; internally multi-select via checkboxes with a
     tick on the right. The stored value stays a single string (via
     Utils.typesToString / Utils.parseTaskTypes) so nothing else that reads
     task.type / entry.type needs to change. Shared by Today's Schedule and both
     Edit modals. */
  const TYPE_DROPDOWN_VALUE_IDS = {
    todayTypeDropdown: 'todayTypeValue',
    editTypeDropdown: 'editTypeValue',
    editEntryTypeDropdown: 'editEntryTypeValue'
  };
  function getCheckedTypes(dropdownId){
    const group = document.getElementById(dropdownId);
    if(!group) return [];
    return Array.from(group.querySelectorAll('.type-opt-input:checked')).map(i => i.dataset.type);
  }
  function setCheckedTypes(dropdownId, typeStr){
    const group = document.getElementById(dropdownId);
    if(!group) return;
    const selected = Utils.parseTaskTypes(typeStr);
    group.querySelectorAll('.type-opt-input').forEach(i => { i.checked = selected.includes(i.dataset.type); });
    // preserve any legacy label the 6 checkboxes don't cover so it isn't
    // silently dropped if the user saves without touching Type.
    group.dataset.legacyExtra = selected.filter(s => !Utils.TASK_TYPES.includes(s)).join(' • ');
    updateTypeDropdownValue(dropdownId);
  }
  function updateTypeDropdownValue(dropdownId){
    const valueId = TYPE_DROPDOWN_VALUE_IDS[dropdownId];
    const valueEl = valueId && document.getElementById(valueId);
    if(!valueEl) return;
    const checked = getCheckedTypes(dropdownId);
    valueEl.textContent = checked.length ? checked.join(' • ') : 'Select type';
    valueEl.classList.toggle('placeholder', !checked.length);
  }
  function onTypeOptionChange(dropdownId){
    updateTypeDropdownValue(dropdownId);
  }
  function toggleTypeDropdown(dropdownId){
    const target = document.getElementById(dropdownId);
    if(!target) return;
    const isOpen = target.classList.contains('open');
    document.querySelectorAll('.type-dropdown.open').forEach(d => d.classList.remove('open'));
    if(!isOpen) target.classList.add('open');
  }
  function closeAllTypeDropdowns(){
    document.querySelectorAll('.type-dropdown.open').forEach(d => d.classList.remove('open'));
  }
  function openEditTask(id){
    const t = tasks.find(x => x.id === id);
    if(!t) return;
    document.getElementById('editTaskId').value = t.id;
    document.getElementById('editTitle').value = t.title || '';
    document.getElementById('editSubject').value = t.subject || 'Physics';
    setCheckedTypes('editTypeDropdown', t.type || '');
    const hm = Utils.hoursToHM(t.duration || 0);
    document.getElementById('editDurationHrs').value = hm.h || '';
    document.getElementById('editDurationMins').value = hm.m || '';
    document.getElementById('editProblems').value = t.problems || '';
    document.getElementById('editPriority').value = t.priority || 'medium';
    document.getElementById('editDate').value = toDateInputValue(t.date);
    document.getElementById('editTaskModal').classList.add('open');
  }
  function closeEditTask(){
    const m = document.getElementById('editTaskModal');
    if(m) m.classList.remove('open');
  }
  function saveEditTask(){
    const id = document.getElementById('editTaskId').value;
    const titleInput = document.getElementById('editTitle');
    const title = titleInput.value.trim();
    if(!title){ Utils.shakeElement(titleInput); titleInput.focus(); return; }
    const subject = document.getElementById('editSubject').value;
    const editTypeDropdown = document.getElementById('editTypeDropdown');
    const legacyExtra = editTypeDropdown ? editTypeDropdown.dataset.legacyExtra : '';
    const type = Utils.typesToString([...getCheckedTypes('editTypeDropdown'), ...(legacyExtra ? legacyExtra.split(' • ') : [])]);
    const duration = Utils.hmToHours(document.getElementById('editDurationHrs').value, document.getElementById('editDurationMins').value);
    const problems = parseInt(document.getElementById('editProblems').value) || 0;
    const priority = document.getElementById('editPriority').value;
    const dateVal = document.getElementById('editDate').value;
    const patch = { title, subject, type, duration, problems, priority };
    if(dateVal){
      const d = new Date(dateVal + 'T00:00:00');
      if(!isNaN(d)) patch.date = d.toDateString();
    }
    editTask(id, patch);
    closeEditTask();
    Utils.toast('Task updated', 'success');
  }

  /* ------- Edit Objective (queue entry) modal ------- */
  function openEditEntry(ts){
    const e = entries.find(x => String(x.ts) === String(ts));
    if(!e) return;
    document.getElementById('editEntryTs').value = e.ts;
    document.getElementById('editEntryDesc').value = e.desc || '';
    document.getElementById('editEntryNotes').value = e.notes || '';
    document.getElementById('editEntrySubject').value = e.cat || 'Physics';
    setCheckedTypes('editEntryTypeDropdown', e.type || '');
    const hm = Utils.hoursToHM(e.dur || 0);
    document.getElementById('editEntryDurationHrs').value = hm.h || '';
    document.getElementById('editEntryDurationMins').value = hm.m || '';
    document.getElementById('editEntryProblems').value = e.prob || '';
    document.getElementById('editEntryPriority').value = e.priority || 'medium';
    document.getElementById('editEntryDate').value = toDateInputValue(new Date(e.ts));
    document.getElementById('editEntryCompleted').checked = e.completed !== false;
    document.getElementById('editEntryModal').classList.add('open');
  }
  function closeEditEntry(){
    const m = document.getElementById('editEntryModal');
    if(m) m.classList.remove('open');
  }
  function saveEditEntry(){
    const ts = document.getElementById('editEntryTs').value;
    const descInput = document.getElementById('editEntryDesc');
    const desc = descInput.value.trim();
    if(!desc){ Utils.shakeElement(descInput); descInput.focus(); return; }
    const notes = document.getElementById('editEntryNotes').value.trim();
    const cat = document.getElementById('editEntrySubject').value;
    const editEntryTypeDropdown = document.getElementById('editEntryTypeDropdown');
    const entryLegacyExtra = editEntryTypeDropdown ? editEntryTypeDropdown.dataset.legacyExtra : '';
    const type = Utils.typesToString([...getCheckedTypes('editEntryTypeDropdown'), ...(entryLegacyExtra ? entryLegacyExtra.split(' • ') : [])]);
    const dur = Utils.hmToHours(document.getElementById('editEntryDurationHrs').value, document.getElementById('editEntryDurationMins').value);
    const prob = parseInt(document.getElementById('editEntryProblems').value) || 0;
    const priority = document.getElementById('editEntryPriority').value;
    const dateVal = document.getElementById('editEntryDate').value;
    const completed = document.getElementById('editEntryCompleted').checked;
    const patch = { desc, notes, cat, type, dur, prob, priority, completed };
    if(dateVal) patch.dateStr = dateVal;
    editEntry(ts, patch);
    closeEditEntry();
    Utils.toast('Objective updated', 'success');
  }

  /* ------- FAB ------- */
  function toggleFab(){
    document.getElementById('fabMenu').classList.toggle('open');
  }

  function init(){
    AppSettings.init();
    Utils.attachGlobalClickEffects();
    Utils.attachTiltEffect();
    updateClock();
    setInterval(updateClock, 1000);
    Pomodoro.init();
    Reminders.init();

    document.getElementById('todayForm').addEventListener('submit', function(e){
      e.preventDefault();
      const titleInput = document.getElementById('todayTitle');
      const title = titleInput.value.trim();
      const subject = document.getElementById('todaySubject').value;
      const type = Utils.typesToString(getCheckedTypes('todayTypeDropdown'));
      const duration = Utils.hmToHours(document.getElementById('todayDurationHrs').value, document.getElementById('todayDurationMins').value);
      const problems = parseInt(document.getElementById('todayProblems').value) || 0;
      const priority = document.getElementById('todayPriority').value;
      if(!title){ Utils.shakeElement(titleInput); titleInput.focus(); return; }
      addTask(title, subject, type, duration, problems, priority);
      const submitBtn = this.querySelector('.btn-submit');
      Utils.showButtonSuccess(submitBtn, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="vertical-align:-2px;margin-right:6px;"><path d="M20 6L9 17l-5-5"/></svg>Added');
      this.reset();
      updateTypeDropdownValue('todayTypeDropdown');
      titleInput.focus();
    });

    document.getElementById('topicForm').addEventListener('submit', function(e){
      e.preventDefault();
      const subject = document.getElementById('topicSubject').value;
      const nameInput = document.getElementById('topicName');
      const name = nameInput.value.trim();
      if(!name){ Utils.shakeElement(nameInput); nameInput.focus(); return; }
      Revision.addTopic(subject, name);
      const submitBtn = this.querySelector('.btn-submit');
      Utils.showButtonSuccess(submitBtn, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="vertical-align:-2px;margin-right:6px;"><path d="M20 6L9 17l-5-5"/></svg>Scheduled');
      this.reset();
      nameInput.focus();
    });

    document.getElementById('rangeTabs').addEventListener('click', function(e){
      const btn = e.target.closest('button'); if(!btn) return;
      setRange(btn.dataset.range);
    });

    document.getElementById('pageNav').addEventListener('click', function(e){
      const btn = e.target.closest('button'); if(!btn) return;
      setPage(btn.dataset.page);
    });

    document.getElementById('sylTabs').addEventListener('click', function(e){
      const btn = e.target.closest('button'); if(!btn) return;
      Syllabus.setSubject(btn.dataset.subject);
    });

    document.getElementById('globalSearch').addEventListener('input', Utils.debounce(function(e){
      globalSearch(e.target.value);
    }, 300));

    document.addEventListener('keydown', function(e){
      if(e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA'){
        e.preventDefault(); document.getElementById('globalSearch').focus();
      }
      if(e.key === 'Escape'){
        document.getElementById('fabMenu').classList.remove('open');
        document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
        closeAllTypeDropdowns();
      }
    });

    document.addEventListener('click', function(e){
      if(!e.target.closest('.type-dropdown')) closeAllTypeDropdowns();
    });

    render();
    Revision.render();
    Syllabus.render();
    Calendar.render();
    Notes.render();
    Goals.render();
    Gamification.render();
    checkReminder();
  }

  return {
    CATS, init, render, setRange, setPage, removeEntry, clearQueue, resetData, importFile,
    toggleTask, deleteTask, checkReminder, dismissReminder, gotoRevisionFromReminder,
    reloadAll, toggleFab, setQueueView,
    addTask, editTask, setTaskDone, getTasks, addSubtask, toggleSubtask, deleteSubtask, getStatistics,
    openEditTask, closeEditTask, saveEditTask,
    editEntry, openEditEntry, closeEditEntry, saveEditEntry,
    toggleTypeDropdown, onTypeOptionChange
  };
})();

window.App = App;
document.addEventListener('DOMContentLoaded', function(){
  App.init();
  Auth.init();
});
