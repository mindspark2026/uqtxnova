/* =========================================================
   UQTxNova — qtt.js   (QUESTION TIME TRACKER)

   Times how long every question takes during a test, records whether it
   was correct / incorrect / unattempted, keeps a history of finished tests
   and shows analytics computed only from the recorded data.

   Timing is timestamp-based (never "tick counting"), so it stays accurate
   when the tab is in the background or the browser is minimised:
       elapsed(question) = accMs + (runStart ? Date.now() - runStart : 0)
   An unfinished session is written to storage on every state change
   (start / pause / resume / mark / reset / undo) plus a 5 s heartbeat, and
   is restored after a refresh. If the app was closed for a while the
   restored question is paused at the last heartbeat instead of silently
   counting the time you were away.

   Data:
     Storage 'qtt'        finished tests  (synced like the other keys)
       { id, name, startedAt, endedAt, targetSec, createdAt, updatedAt,
         questions:[{ id, n, status:'correct'|'incorrect'|'unattempted', ms,
                      subject, chapter, topic, difficulty, at }] }
     Storage 'qttActive'  the unfinished session (device-local, per account)
   ========================================================= */

const QTT = (function(){
  'use strict';

  const ACTIVE_KEY = 'qttActive';
  const SUBJECTS = ['Physics', 'Chemistry', 'Maths', 'General'];
  const DIFFS = ['Easy', 'Medium', 'Hard'];
  const TARGETS = [60, 90, 120, 180, 300];
  const DEFAULT_TARGET = 120;
  const AWAY_PAUSE_MS = 90 * 1000;       // restored after being away longer than this → paused at last heartbeat
  const STATUS = {
    correct:['Correct', 'ok'], incorrect:['Incorrect', 'bad'], unattempted:['Unattempted', 'skip']
  };
  const $ = id => document.getElementById(id);
  const esc = s => Utils.escapeHtml(s);

  const ICONS = {
    check:'<path d="M20 6L9 17l-5-5"/>', x:'<path d="M18 6L6 18M6 6l12 12"/>',
    refresh:'<path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    pause:'<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>', play:'<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z" fill="currentColor" stroke="none"/>',
    endx:'<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',
    skip:'<path d="M5 4l10 8-10 8zM19 5v14"/>', undo:'<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
    back:'<path d="M15 18l-6-6 6-6"/>', chevron:'<path d="M6 9l6 6 6-6"/>',
    download:'<path d="M12 3v13m0 0l-4-4m4 4l4-4M5 21h14"/>', trash:'<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>',
    edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/>',
    log:'<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h6"/>',
    timer:'<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>', clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    chart:'<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>'
  };
  const ico = (n, s) => `<svg width="${s || 18}" height="${s || 18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;

  /* ---------------- time helpers ---------------- */
  const now = () => Date.now();
  const pad = n => String(n).padStart(2, '0');
  function fmtMS(ms){ const s = Math.max(0, Math.floor(ms / 1000)); return pad(Math.floor(s / 60)) + ':' + pad(s % 60); }
  function fmtClock(ms){
    const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600);
    return h > 0 ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : fmtMS(ms);
  }
  const fmtDate = ts => new Date(ts).toLocaleDateString(undefined, { weekday:'short', day:'numeric', month:'short', year:'numeric' });
  const localDay = ts => { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };

  /* ---------------- storage ---------------- */
  const hist = () => { const v = Storage.get('qtt', []); return Array.isArray(v) ? v : []; };
  const saveHist = list => Storage.set('qtt', list);
  let sess = null;                                   // unfinished session (mirrors Storage 'qttActive')
  function saveActive(){ Storage.set(ACTIVE_KEY, sess); }
  function loadActive(){
    const s = Storage.get(ACTIVE_KEY, null);
    sess = (s && s.cur && Array.isArray(s.questions)) ? s : null;
    if(sess && sess.cur.runStart){
      const gap = now() - (sess.lastSeen || sess.cur.runStart);
      if(gap > AWAY_PAUSE_MS){                       // was away: stop the clock where we last saw it
        sess.cur.accMs += Math.max(0, (sess.lastSeen || sess.cur.runStart) - sess.cur.runStart);
        sess.cur.runStart = null; saveActive();
        restoredPaused = true;
      }
    }
  }
  let restoredPaused = false;

  function curMs(s){ return s.cur.accMs + (s.cur.runStart ? now() - s.cur.runStart : 0); }
  function sessTotal(s){ return s.questions.reduce((a, q) => a + q.ms, 0) + curMs(s); }
  const isRunning = () => !!(sess && sess.cur.runStart);

  /* ---------------- session control ---------------- */
  function freshMeta(m){ return { subject:(m && m.subject) || '', chapter:(m && m.chapter) || '', topic:'', difficulty:'' }; }
  function startSession(name, targetSec, meta, resume){
    const t = now();
    const qs = resume ? resume.questions.map(q => Object.assign({}, q)) : [];
    const nextN = qs.length ? Math.max(...qs.map(q => q.n)) + 1 : 1;
    sess = {
      id:resume ? resume.id : Utils.uid(), resumeOf:resume ? resume.id : null,
      name, startedAt:resume ? resume.startedAt : t, targetSec, questions:qs,
      cur:{ n:nextN, accMs:0, runStart:t, meta:freshMeta(meta) }, lastSeen:t
    };
    saveActive();
    openScreen();
  }

  function pause(){
    if(!sess || !sess.cur.runStart) return;
    sess.cur.accMs += now() - sess.cur.runStart; sess.cur.runStart = null; saveActive(); refreshScreen(); updateTimers();
  }
  function resume(){
    if(!sess || sess.cur.runStart) return;
    sess.cur.runStart = now(); sess.lastSeen = now(); saveActive(); refreshScreen(); updateTimers();
  }
  function togglePause(){ if(isRunning()) pause(); else resume(); }

  let lastMark = 0;
  function mark(status){
    if(!sess) return;
    const t = now();
    if(t - lastMark < 350) return;                   // guard against double taps
    lastMark = t;
    const c = sess.cur, ms = curMs(sess);
    sess.questions.push({ id:Utils.uid(), n:c.n, status, ms, subject:c.meta.subject || '', chapter:c.meta.chapter || '', topic:c.meta.topic || '', difficulty:c.meta.difficulty || '', at:t });
    sess.cur = { n:c.n + 1, accMs:0, runStart:c.runStart ? t : null, meta:freshMeta(c.meta) };   // next question starts automatically
    sess.lastSeen = t; saveActive();
    refreshScreen(true); updateTimers();
    flashFeedback(status, ms, c.n);
  }
  function resetCurrent(){
    if(!sess) return;
    sess.cur.accMs = 0; sess.cur.runStart = sess.cur.runStart ? now() : null; saveActive(); updateTimers(); refreshScreen();
  }
  /* reopen the last recorded question (e.g. after a mis-tap) — its time carries on from where it was */
  function undo(){
    if(!sess || !sess.questions.length) return;
    const q = sess.questions.pop(), extra = curMs(sess), run = !!sess.cur.runStart;
    sess.cur = { n:q.n, accMs:q.ms + extra, runStart:run ? now() : null, meta:{ subject:q.subject, chapter:q.chapter, topic:q.topic, difficulty:q.difficulty } };
    saveActive(); refreshScreen(true); updateTimers();
    Utils.toast(`Question #${q.n} reopened`, 'info');
  }

  /* three-way choice dialog (used when ending with an unmarked question) */
  function choose(opts){
    return new Promise(resolve => {
      let o = $('qttChoose');
      if(!o){ o = document.createElement('div'); o.id = 'qttChoose'; o.className = 'modal-overlay qtt-overlay'; o.innerHTML = '<div class="modal tx-confirm" role="dialog" aria-modal="true"></div>'; document.body.appendChild(o); }
      const box = o.firstElementChild;
      box.innerHTML = `<div class="tx-confirm-ico">${ico('clock', 20)}</div><h3>${esc(opts.title)}</h3><p>${esc(opts.message)}</p>
        <div class="qtt-choices">${opts.options.map(([k, l, cls]) => `<button type="button" class="pill-btn ${cls || ''}" data-k="${k}">${esc(l)}</button>`).join('')}</div>`;
      const done = v => { o.classList.remove('open'); o.onclick = null; document.removeEventListener('keydown', esc_, true); resolve(v); };
      const esc_ = e => { if(e.key === 'Escape'){ e.stopImmediatePropagation(); done('cancel'); } };
      document.addEventListener('keydown', esc_, true);
      box.querySelectorAll('button').forEach(b => b.onclick = () => done(b.dataset.k));
      o.onclick = e => { if(e.target === o) done('cancel'); };
      o.classList.add('open'); box.querySelector('button').focus();
    });
  }
  function askText(title, value, label){
    return new Promise(resolve => {
      let o = $('qttAsk');
      if(!o){ o = document.createElement('div'); o.id = 'qttAsk'; o.className = 'modal-overlay qtt-overlay'; o.innerHTML = '<div class="modal tx-confirm" role="dialog" aria-modal="true"></div>'; document.body.appendChild(o); }
      const box = o.firstElementChild;
      box.innerHTML = `<h3>${esc(title)}</h3><div class="field" style="text-align:left;margin:10px 0 14px"><label for="qttAskIn">${esc(label)}</label><input id="qttAskIn" type="text" maxlength="80" value="${esc(value)}"></div>
        <div class="modal-actions"><button type="button" class="pill-btn" data-k="no">Cancel</button><button type="button" class="pill-btn primary" data-k="yes">Save</button></div>`;
      const input = box.querySelector('input');
      const done = v => { o.classList.remove('open'); document.removeEventListener('keydown', k_, true); resolve(v); };
      const k_ = e => { if(e.key === 'Escape'){ e.stopImmediatePropagation(); done(null); } else if(e.key === 'Enter'){ e.preventDefault(); e.stopImmediatePropagation(); done(input.value.trim() || null); } };
      document.addEventListener('keydown', k_, true);
      box.querySelector('[data-k="no"]').onclick = () => done(null);
      box.querySelector('[data-k="yes"]').onclick = () => done(input.value.trim() || null);
      o.onclick = e => { if(e.target === o) done(null); };
      o.classList.add('open'); input.focus(); input.select();
    });
  }

  async function endTest(){
    if(!sess) return;
    const cur = curMs(sess), hasCur = cur >= 1000;
    if(!sess.questions.length && !hasCur){
      const ok = await Tests.confirmDialog({ title:'Discard this test?', message:'No questions have been recorded yet.', confirmText:'Discard', danger:true });
      if(ok) discardSession();
      return;
    }
    let saveCur = false;
    if(hasCur){
      const c = await choose({ title:`Question #${sess.cur.n} isn't marked`, message:`It has ${fmtMS(cur)} on the clock. What should happen to it?`,
        options:[['unattempted', 'Save as unattempted', 'primary'], ['discard', 'Discard it'], ['cancel', 'Keep going']] });
      if(c === 'cancel' || !c) return;
      saveCur = c === 'unattempted';
    }
    const t = now();
    if(saveCur){
      const c = sess.cur;
      sess.questions.push({ id:Utils.uid(), n:c.n, status:'unattempted', ms:cur, subject:c.meta.subject || '', chapter:c.meta.chapter || '', topic:c.meta.topic || '', difficulty:c.meta.difficulty || '', at:t });
    }
    if(!sess.questions.length){ Utils.toast('No questions were recorded, so nothing was saved.', 'info'); discardSession(); return; }
    const test = { id:sess.id, name:sess.name, startedAt:sess.startedAt, endedAt:t, targetSec:sess.targetSec, questions:sess.questions, createdAt:sess.startedAt, updatedAt:t };
    const list = hist(), i = list.findIndex(x => x.id === test.id);
    if(i >= 0) list[i] = Object.assign({}, list[i], test); else list.push(test);
    saveHist(list);
    const total = test.questions.reduce((a, q) => a + q.ms, 0);
    discardSession(true);
    Utils.toast(`Test saved · ${test.questions.length} question${test.questions.length > 1 ? 's' : ''} · ${fmtClock(total)}`, 'success');
    openCards.add(test.id);
    render();
    const card = document.querySelector(`.qh-card[data-id="${test.id}"]`); if(card) card.scrollIntoView({ behavior:'smooth', block:'center' });
  }
  function discardSession(keepScreenClose){
    sess = null; Storage.set(ACTIVE_KEY, null);
    closeScreen(); render();
  }

  /* leaving the screen keeps the session (and clock) running */
  function minimize(){ closeScreen(); render(); }
  function continueTest(){
    if(sess){ openScreen(); return; }
    const list = hist();
    if(!list.length){ Utils.toast('There\'s no test to continue yet — start a new one.', 'info'); return; }
    const last = list.slice().sort((a, b) => (b.endedAt || b.startedAt) - (a.endedAt || a.startedAt))[0];
    Tests.confirmDialog({ title:`Continue “${last.name}”?`, message:`It has ${last.questions.length} recorded question${last.questions.length === 1 ? '' : 's'}. You can keep adding questions to it.`, confirmText:'Continue' })
      .then(ok => { if(ok) startSession(last.name, last.targetSec || DEFAULT_TARGET, null, last); });
  }
  function reload(){
    const keep = sess && sess.cur.runStart;
    if(!keep) loadActive();
    render();
  }

  /* =========================================================
     Start dialog
     ========================================================= */
  function chapterNames(){
    try{ return (typeof ChapterAutocomplete !== 'undefined' && ChapterAutocomplete.allChapters) ? [...new Set(ChapterAutocomplete.allChapters().map(c => c.name))] : []; }catch(e){ return []; }
  }
  function uniqueName(base){
    const names = new Set(hist().map(t => t.name));
    if(!names.has(base)) return base;
    let i = 2; while(names.has(`${base} (${i})`)) i++;
    return `${base} (${i})`;
  }
  async function openStart(){
    if(sess){
      const c = await choose({ title:'A test is already in progress', message:`“${sess.name}” hasn't been ended yet. Continue it, or end it first so nothing is lost.`, options:[['continue', 'Continue it', 'primary'], ['cancel', 'Cancel']] });
      if(c === 'continue') openScreen();
      return;
    }
    let o = $('qttStart');
    if(!o){ o = document.createElement('div'); o.id = 'qttStart'; o.className = 'modal-overlay qtt-overlay'; o.innerHTML = '<div class="modal tx-modal qtt-start" role="dialog" aria-modal="true" aria-labelledby="qttStartTitle"></div>'; document.body.appendChild(o); }
    const box = o.firstElementChild;
    box.innerHTML = `
      <h3 id="qttStartTitle">Start New Test</h3><p>Every question gets its own timer. You can mark each one correct, incorrect or skipped.</p>
      <form class="tx-form" id="qttStartForm" novalidate>
        <div class="field"><label for="qsName">Test name</label><input id="qsNameIn" type="text" maxlength="80" value="${esc(uniqueName('Test ' + localDay(now())))}"><div class="tx-err" id="qsNameErr"></div></div>
        <div class="field"><label>Target time per question</label>
          <div class="qtt-chips" id="qsTargets">${TARGETS.map(s => `<button type="button" class="qtt-chip ${s === DEFAULT_TARGET ? 'active' : ''}" data-s="${s}">${fmtMS(s * 1000)}</button>`).join('')}</div>
          <div class="qtt-target-custom"><input id="qsTargetIn" type="number" min="10" max="3600" inputmode="numeric" value="${DEFAULT_TARGET}" aria-label="Target seconds"><span>seconds</span></div>
          <div class="tx-err" id="qsTargetErr"></div></div>
        <div class="field-row">
          <div class="field"><label for="qsSubjIn">Subject <span class="tx-hint">(optional)</span></label><select id="qsSubjIn"><option value="">—</option>${SUBJECTS.map(s => `<option>${s}</option>`).join('')}</select></div>
          <div class="field"><label for="qsChapIn">Chapter <span class="tx-hint">(optional)</span></label><input id="qsChapIn" type="text" maxlength="120" list="qttChapList" autocomplete="off" placeholder="From your Syllabus…"></div>
        </div>
        <datalist id="qttChapList">${chapterNames().map(n => `<option value="${esc(n)}">`).join('')}</datalist>
        <div class="modal-actions"><button type="button" class="pill-btn" id="qsCancel">Cancel</button><button type="submit" class="pill-btn primary" id="qsGo">${ico('play', 15)}Start</button></div>
      </form>`;
    const close = () => { o.classList.remove('open'); document.removeEventListener('keydown', onKey, true); };
    const onKey = e => { if(e.key === 'Escape'){ e.stopImmediatePropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    const tIn = $('qsTargetIn');
    box.querySelectorAll('.qtt-chip').forEach(b => b.onclick = () => { tIn.value = b.dataset.s; box.querySelectorAll('.qtt-chip').forEach(x => x.classList.toggle('active', x === b)); });
    tIn.addEventListener('input', () => box.querySelectorAll('.qtt-chip').forEach(x => x.classList.toggle('active', x.dataset.s === tIn.value)));
    $('qsCancel').onclick = close;
    o.onclick = e => { if(e.target === o) close(); };
    $('qttStartForm').addEventListener('submit', e => {
      e.preventDefault();
      const name = $('qsNameIn').value.trim(), target = parseInt(tIn.value, 10);
      $('qsNameErr').textContent = name ? '' : 'Please enter a name for this test.';
      $('qsTargetErr').textContent = (target >= 10 && target <= 3600) ? '' : 'Choose between 10 and 3600 seconds.';
      if(!name || !(target >= 10 && target <= 3600)) return;
      close();
      startSession(name, target, { subject:$('qsSubjIn').value, chapter:$('qsChapIn').value.trim() }, null);
    });
    o.classList.add('open'); setTimeout(() => $('qsNameIn').select(), 60);
  }

  /* =========================================================
     Full-screen active test
     ========================================================= */
  let screenOpen = false, wake = null, baseTitle = null;
  const openCards = new Set();
  let logOpen = false, trendView = 'daily';

  async function requestWake(){
    try{ if('wakeLock' in navigator && !wake){ wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } }catch(e){}
  }
  function releaseWake(){ try{ if(wake){ wake.release(); } }catch(e){} wake = null; }

  function openScreen(){
    if(!sess) return;
    let el = $('qttScreen');
    if(!el){ el = document.createElement('div'); el.id = 'qttScreen'; el.className = 'qtt-screen'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Active test timer'); document.body.appendChild(el); }
    screenOpen = true; el.hidden = false; document.body.classList.add('qtt-lock');
    buildScreen(); updateTimers(); requestWake();
    if(restoredPaused){ restoredPaused = false; Utils.toast('Unfinished test restored — the timer is paused where you left it.', 'info'); }
  }
  function closeScreen(){
    screenOpen = false;
    const el = $('qttScreen'); if(el) el.hidden = true;
    document.body.classList.remove('qtt-lock'); releaseWake();
  }

  function detailsHtml(){
    const m = sess.cur.meta;
    return `<div class="qs-fields">
      <div class="field"><label for="qsSubj">Subject</label><select id="qsSubj"><option value="">—</option>${SUBJECTS.map(s => `<option ${m.subject === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label for="qsChap">Chapter</label><input id="qsChap" type="text" maxlength="120" list="qsChapList" autocomplete="off" placeholder="Syllabus chapter…" value="${esc(m.chapter)}"></div>
      <div class="field"><label for="qsTopic">Topic</label><input id="qsTopic" type="text" maxlength="120" autocomplete="off" placeholder="e.g. Torque" value="${esc(m.topic)}"></div>
      <div class="field"><label>Difficulty</label><div class="qtt-chips" id="qsDiff">${DIFFS.map(d => `<button type="button" class="qtt-chip ${m.difficulty === d ? 'active' : ''}" data-d="${d}" aria-pressed="${m.difficulty === d}">${d}</button>`).join('')}</div></div>
      <datalist id="qsChapList">${chapterNames().map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>`;
  }
  function bindDetails(){
    const save = Utils.debounce(() => saveActive(), 200);
    const set = (k, v) => { if(sess){ sess.cur.meta[k] = v; save(); } };
    $('qsSubj').addEventListener('change', e => set('subject', e.target.value));
    $('qsChap').addEventListener('input', e => set('chapter', e.target.value.trim()));
    $('qsTopic').addEventListener('input', e => set('topic', e.target.value.trim()));
    $('qsDiff').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const on = !b.classList.contains('active');
      $('qsDiff').querySelectorAll('button').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false'); });
      if(on){ b.classList.add('active'); b.setAttribute('aria-pressed', 'true'); }
      set('difficulty', on ? b.dataset.d : '');
    }));
  }

  function buildScreen(){
    const el = $('qttScreen'); if(!el || !sess) return;
    const det = $('qsDetails'), detOpen = det ? det.open : false;
    el.innerHTML = `
      <div class="qs-wrap">
        <div class="qs-top">
          <button type="button" class="qs-iconbtn" onclick="QTT.minimize()" aria-label="Back to dashboard (the timer keeps running)">${ico('back', 20)}</button>
          <div class="qs-title"><b>${esc(sess.name)}</b><span><span id="qsCount"></span> · Total <em id="qsTotal">00:00</em></span></div>
          <button type="button" class="qs-iconbtn" id="qsUndo" onclick="QTT.undo()" aria-label="Undo last question">${ico('undo', 19)}</button>
        </div>
        <div class="qs-qrow">
          <label class="qs-qlabel" for="qsNum">Question #<input id="qsNum" type="number" min="1" max="9999" inputmode="numeric" value="${sess.cur.n}"></label>
          <button type="button" class="qs-sq ok" onclick="QTT.mark('correct')" aria-label="Mark correct" data-tip="Correct (C)">${ico('check', 22)}</button>
          <button type="button" class="qs-sq bad" onclick="QTT.mark('incorrect')" aria-label="Mark incorrect" data-tip="Incorrect (X)">${ico('x', 22)}</button>
          <button type="button" class="qs-sq skip" onclick="QTT.mark('unattempted')" aria-label="Skip — unattempted" data-tip="Skip (S)">${ico('skip', 20)}</button>
          <button type="button" class="qs-sq rst" onclick="QTT.resetCurrent()" aria-label="Reset this question's timer" data-tip="Reset (R)">${ico('refresh', 21)}</button>
        </div>
        <div class="qs-timer" id="qsTimer" role="timer" aria-live="off">00:00</div>
        <div class="qs-target"><div class="qs-bar"><i id="qsBar"></i></div><span id="qsTargetTxt"></span></div>
        <div class="qs-ctrl">
          <button type="button" class="qs-big pause" id="qsPause" onclick="QTT.togglePause()"></button>
          <button type="button" class="qs-big end" onclick="QTT.endTest()">${ico('endx', 22)}<span>End Test</span></button>
        </div>
        <details class="qs-details" id="qsDetails" ${detOpen ? 'open' : ''}><summary>Question details <small>optional · applies to this question</small></summary>${detailsHtml()}</details>
        <div class="qs-recent" id="qsRecent" aria-label="Recently recorded questions"></div>
        <div class="qs-hint">Keys: C correct · X incorrect · S skip · R reset · Space pause · U undo</div>
      </div>`;
    $('qsNum').addEventListener('change', e => { const v = parseInt(e.target.value, 10); if(sess && v >= 1){ sess.cur.n = v; saveActive(); } else if(sess) e.target.value = sess.cur.n; });
    bindDetails();
    syncScreen();
  }
  /* cheap update of the parts that change on a state transition (keeps typing focus intact) */
  function syncScreen(){
    if(!screenOpen || !sess) return;
    const run = isRunning();
    const pb = $('qsPause');
    if(pb){ pb.innerHTML = `${ico(run ? 'pause' : 'play', 22)}<span>${run ? 'Pause' : 'Resume'}</span>`; pb.classList.toggle('resume', !run); }
    const t = $('qsTimer'); if(t) t.classList.toggle('paused', !run);
    const n = $('qsNum'); if(n && document.activeElement !== n) n.value = sess.cur.n;
    const c = $('qsCount'); if(c) c.textContent = `${sess.questions.length} recorded`;
    const u = $('qsUndo'); if(u) u.disabled = !sess.questions.length;
    const r = $('qsRecent');
    if(r) r.innerHTML = sess.questions.slice(-4).reverse().map(q => `<span class="qs-chip ${STATUS[q.status][1]}"><b>Q${q.n}</b> ${ico(q.status === 'correct' ? 'check' : (q.status === 'incorrect' ? 'x' : 'skip'), 12)} ${fmtMS(q.ms)}</span>`).join('');
  }
  function refreshScreen(full){ if(!screenOpen) return; if(full){ buildScreen(); } else syncScreen(); }

  function flashFeedback(status, ms, n){
    const t = $('qsTimer'); if(!t) return;
    t.classList.remove('flash-ok', 'flash-bad', 'flash-skip'); void t.offsetWidth;
    t.classList.add(status === 'correct' ? 'flash-ok' : (status === 'incorrect' ? 'flash-bad' : 'flash-skip'));
    if(navigator.vibrate){ try{ navigator.vibrate(18); }catch(e){} }
  }

  /* ---------------- clocks ---------------- */
  function updateTimers(){
    if(!sess){
      const dt = $('qdTimer'); if(dt) dt.textContent = '00:00';
      if(baseTitle !== null){ document.title = baseTitle; baseTitle = null; }
      return;
    }
    const ms = curMs(sess), txt = fmtMS(ms), long = ms >= 6000000;
    const st = $('qsTimer'); if(st){ if(st.textContent !== txt) st.textContent = txt; st.classList.toggle('long', long); }
    const tot = $('qsTotal'); if(tot) tot.textContent = fmtClock(sessTotal(sess));
    const tgt = sess.targetSec * 1000;
    const bar = $('qsBar'); if(bar){ bar.style.width = Math.min(100, (ms / tgt) * 100) + '%'; bar.parentElement.classList.toggle('over', ms > tgt); }
    const tt = $('qsTargetTxt'); if(tt) tt.textContent = ms > tgt ? `Target ${fmtMS(tgt)} · over by ${fmtMS(ms - tgt)}` : `Target ${fmtMS(tgt)} · ${fmtMS(tgt - ms)} left`;
    const dt = $('qdTimer'); if(dt){ dt.textContent = txt; dt.classList.toggle('long', long); dt.classList.toggle('paused', !isRunning()); }
    const ds = $('qdSub'); if(ds) ds.textContent = `${sess.name} · Question #${sess.cur.n} · ${isRunning() ? 'running' : 'paused'}`;
    if(isRunning()){ if(baseTitle === null) baseTitle = document.title; document.title = `⏱ ${txt} · Q${sess.cur.n}`; }
    else if(baseTitle !== null){ document.title = baseTitle; baseTitle = null; }
  }

  /* =========================================================
     Statistics (all from recorded questions)
     ========================================================= */
  const attempted = q => q.status === 'correct' || q.status === 'incorrect';
  function testStats(t){
    const qs = t.questions || [], total = qs.reduce((a, q) => a + q.ms, 0), att = qs.filter(attempted);
    const target = (t.targetSec || DEFAULT_TARGET) * 1000;
    const fast = att.length ? att.reduce((a, q) => q.ms < a.ms ? q : a) : null;
    const slow = att.length ? att.reduce((a, q) => q.ms > a.ms ? q : a) : null;
    return {
      n:qs.length, total, avg:qs.length ? total / qs.length : 0, fast, slow,
      inTarget:att.filter(q => q.ms <= target).length, attempted:att.length,
      correct:qs.filter(q => q.status === 'correct').length, incorrect:qs.filter(q => q.status === 'incorrect').length,
      skipped:qs.filter(q => q.status === 'unattempted').length
    };
  }
  function groupBy(qs, key, blank){
    const m = {};
    qs.forEach(q => { const k = (q[key] || '').trim() || blank; if(!k) return; (m[k] = m[k] || []).push(q); });
    return Object.keys(m).map(k => {
      const a = m[k], c = a.filter(q => q.status === 'correct').length, i = a.filter(q => q.status === 'incorrect').length;
      return { label:k, n:a.length, avg:a.reduce((s, q) => s + q.ms, 0) / a.length, acc:(c + i) ? Math.round(c / (c + i) * 100) : null };
    }).sort((x, y) => y.n - x.n);
  }
  function allQuestions(){ return hist().flatMap(t => (t.questions || []).map(q => Object.assign({ testId:t.id }, q))); }
  function periodBuckets(qs, mode){
    const out = [], today = new Date(); today.setHours(0, 0, 0, 0);
    const mk = (start, end, label, title) => ({ start:start.getTime(), end:end.getTime(), label, title, qs:[] });
    if(mode === 'daily'){
      for(let i = 13; i >= 0; i--){ const d = new Date(today); d.setDate(d.getDate() - i); const e = new Date(d); e.setHours(23, 59, 59, 999); out.push(mk(d, e, String(d.getDate()), d.toLocaleDateString(undefined, { weekday:'short', day:'numeric', month:'short' }))); }
    } else {
      const ws = new Date(today); ws.setDate(ws.getDate() - ws.getDay());        // weeks start Sunday, like the rest of the app
      for(let i = 7; i >= 0; i--){ const d = new Date(ws); d.setDate(d.getDate() - i * 7); const e = new Date(d); e.setDate(e.getDate() + 6); e.setHours(23, 59, 59, 999); out.push(mk(d, e, d.toLocaleDateString(undefined, { day:'numeric', month:'short' }), 'Week of ' + d.toLocaleDateString(undefined, { day:'numeric', month:'short' }))); }
    }
    qs.forEach(q => { const b = out.find(x => q.at >= x.start && q.at <= x.end); if(b) b.qs.push(q); });
    return out;
  }

  /* =========================================================
     Dashboard page
     ========================================================= */
  function qRowHtml(q, owner){
    const [label, cls] = STATUS[q.status] || STATUS.unattempted;
    const meta = [q.subject, q.chapter, q.topic, q.difficulty].filter(Boolean).map(esc).join(' · ');
    return `<div class="ql-row">
      <span class="ql-n">${q.n}</span>
      <span class="ql-st ${cls}" title="${label}">${ico(q.status === 'correct' ? 'check' : (q.status === 'incorrect' ? 'x' : 'skip'), 13)}<span>${label}</span></span>
      <span class="ql-time">${fmtMS(q.ms)}</span>
      <span class="ql-meta">${meta || '<i>no details</i>'}</span>
      <button type="button" class="tx-icon-btn" aria-label="Edit question ${q.n}" onclick="QTT.editQ('${owner}','${q.id}')">${ico('edit', 13)}</button></div>`;
  }
  function logHtml(){
    const list = hist(), latest = list.slice().sort((a, b) => (b.endedAt || b.startedAt) - (a.endedAt || a.startedAt))[0];
    const src = sess ? { name:sess.name, qs:sess.questions, owner:'active', live:true } : (latest ? { name:latest.name, qs:latest.questions, owner:latest.id } : null);
    return `<section class="panel qd-log">
      <button type="button" class="qd-log-head" id="qdLogToggle" aria-expanded="${logOpen}" onclick="QTT.toggleLog()">
        <span class="qd-log-ico">${ico('log', 18)}</span><b>Question Log</b>
        <span class="qd-log-sub">${src ? esc(src.name) + ' · ' + src.qs.length + ' recorded' + (src.live ? ' · in progress' : '') : 'nothing recorded yet'}</span>
        <span class="qd-chev ${logOpen ? 'open' : ''}">${ico('chevron', 18)}</span></button>
      ${logOpen ? `<div class="qd-log-body">${src && src.qs.length ? src.qs.slice().sort((a, b) => a.n - b.n).map(q => qRowHtml(q, src.owner)).join('') : '<div class="tx-empty small"><p>Questions you record will appear here.</p></div>'}</div>` : ''}
    </section>`;
  }

  function barList(rows, unit){
    if(!rows.length) return '<div class="qa-none">Not enough details recorded yet — add a subject, chapter or difficulty while timing.</div>';
    const max = Math.max(...rows.map(r => r.avg), 1);
    return rows.map(r => `<div class="qa-row"><span class="qa-label" title="${esc(r.label)}">${esc(r.label)}</span>
      <span class="qa-bar"><i style="width:${Math.max(4, r.avg / max * 100)}%"></i></span>
      <span class="qa-val"><b>${fmtMS(r.avg)}</b><small>${r.n} q${r.acc !== null ? ' · ' + r.acc + '%' : ''}</small></span></div>`).join('');
  }
  function trendHtml(qs){
    const b = periodBuckets(qs, trendView), max = Math.max(1, ...b.map(x => x.qs.length));
    return `<div class="qa-trend" role="img" aria-label="Questions per ${trendView === 'daily' ? 'day' : 'week'}">${b.map(x => {
      const n = x.qs.length, c = x.qs.filter(q => q.status === 'correct').length, i = x.qs.filter(q => q.status === 'incorrect').length, o = n - c - i;
      const avg = n ? x.qs.reduce((s, q) => s + q.ms, 0) / n : 0;
      const tip = n ? `${x.title}: ${n} question${n > 1 ? 's' : ''}, avg ${fmtMS(avg)}, ${c} correct, ${i} incorrect` : `${x.title}: no questions`;
      const h = v => (v / max * 100) + '%';
      return `<div class="qa-col" title="${esc(tip)}" tabindex="0" aria-label="${esc(tip)}"><div class="qa-stack">${n ? `<i class="ok" style="height:${h(c)}"></i><i class="bad" style="height:${h(i)}"></i><i class="skip" style="height:${h(o)}"></i>` : ''}</div><em>${esc(x.label)}</em>${n && trendView === 'weekly' ? `<small>${fmtMS(avg)}</small>` : ''}</div>`;
    }).join('')}</div>`;
  }
  function analyticsHtml(){
    const qs = allQuestions();
    if(!qs.length) return `<section class="panel qd-an"><div class="panel-head"><div><p class="panel-title">${ico('chart', 14)} Performance Analytics</p><p class="panel-sub">Calculated from your finished tests</p></div></div>
      <div class="tx-empty small"><div class="tx-empty-ico">${ico('chart', 22)}</div><p>Finish a test to see average times, accuracy and trends.</p></div></section>`;
    const total = qs.reduce((a, q) => a + q.ms, 0), c = qs.filter(q => q.status === 'correct').length, i = qs.filter(q => q.status === 'incorrect').length, u = qs.length - c - i;
    const acc = (c + i) ? Math.round(c / (c + i) * 100) : null;
    const diffRows = DIFFS.map(d => groupBy(qs.filter(q => q.difficulty === d), 'difficulty', d)[0]).filter(Boolean);
    const noDiff = qs.filter(q => !q.difficulty);
    if(diffRows.length && noDiff.length) diffRows.push({ label:'Not specified', n:noDiff.length, avg:noDiff.reduce((s, q) => s + q.ms, 0) / noDiff.length, acc:null });
    return `<section class="panel qd-an">
      <div class="panel-head"><div><p class="panel-title">${ico('chart', 14)} Performance Analytics</p><p class="panel-sub">${plural(hist().length, 'finished test')} · ${plural(qs.length, 'question')}</p></div></div>
      <div class="qa-kpis">
        <div class="qa-kpi"><span>Avg time / question</span><b>${fmtMS(total / qs.length)}</b></div>
        <div class="qa-kpi ok"><span>Correct</span><b>${c}</b></div>
        <div class="qa-kpi bad"><span>Incorrect</span><b>${i}</b></div>
        <div class="qa-kpi skip"><span>Unattempted</span><b>${u}</b></div>
        <div class="qa-kpi"><span>Accuracy</span><b>${acc === null ? '—' : acc + '%'}</b></div>
      </div>
      <div class="qa-grid">
        <div class="qa-box"><h4>Subject-wise average time</h4>${barList(groupBy(qs, 'subject', ''))}</div>
        <div class="qa-box"><h4>Chapter-wise average time</h4>${barList(groupBy(qs, 'chapter', '').slice(0, 8))}</div>
        <div class="qa-box"><h4>By difficulty</h4>${barList(diffRows)}</div>
        <div class="qa-box"><div class="qa-box-head"><h4>${trendView === 'daily' ? 'Daily (last 14 days)' : 'Weekly (last 8 weeks)'}</h4>
          <div class="tx-seg" role="group" aria-label="Trend period"><button type="button" class="${trendView === 'daily' ? 'active' : ''}" onclick="QTT.setTrend('daily')">Daily</button><button type="button" class="${trendView === 'weekly' ? 'active' : ''}" onclick="QTT.setTrend('weekly')">Weekly</button></div></div>
          ${trendHtml(qs)}<div class="qa-legend"><span class="ok">Correct</span><span class="bad">Incorrect</span><span class="skip">Unattempted</span></div></div>
      </div>
    </section>`;
  }
  const plural = (n, a, b) => n + ' ' + (n === 1 ? a : (b || a + 's'));

  function cardHtml(t){
    const s = testStats(t), open = openCards.has(t.id);
    const tile = (l, v, sub) => `<div class="qh-tile"><span>${l}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const qs = (t.questions || []).slice().sort((a, b) => a.n - b.n);
    return `<article class="qh-card" data-id="${t.id}">
      <header class="qh-head">
        <button type="button" class="qh-name" onclick="QTT.rename('${t.id}')" aria-label="Rename ${esc(t.name)}">${ico('edit', 14)}<span>${esc(t.name)}</span></button>
        <span class="qh-date">${esc(fmtDate(t.startedAt))}</span>
        <div class="qh-actions">
          <button type="button" class="tx-icon-btn" aria-label="Download ${esc(t.name)} as CSV" data-tip="Download CSV" onclick="QTT.exportCsv('${t.id}')">${ico('download', 15)}</button>
          <button type="button" class="tx-icon-btn danger" aria-label="Delete ${esc(t.name)}" data-tip="Delete" onclick="QTT.remove('${t.id}')">${ico('trash', 15)}</button>
        </div></header>
      <div class="qh-tiles">
        ${tile('Total Questions', s.n)}${tile('Total Time', fmtClock(s.total))}${tile('Avg Time', fmtMS(s.avg))}
        ${tile('Fastest Question', s.fast ? fmtMS(s.fast.ms) : 'N/A', s.fast ? 'Q' + s.fast.n : '')}${tile('Slowest Question', s.slow ? fmtMS(s.slow.ms) : 'N/A', s.slow ? 'Q' + s.slow.n : '')}
        ${tile('Completed In Target Time', s.inTarget, s.attempted ? `of ${s.attempted} attempted · ≤ ${fmtMS((t.targetSec || DEFAULT_TARGET) * 1000)}` : '')}
      </div>
      <div class="qh-mix"><span class="ok">${ico('check', 12)} ${s.correct}</span><span class="bad">${ico('x', 12)} ${s.incorrect}</span><span class="skip">${ico('skip', 11)} ${s.skipped}</span>
        <button type="button" class="qh-toggle" aria-expanded="${open}" onclick="QTT.toggleCard('${t.id}')">${open ? 'Hide' : 'Show'} questions ${ico('chevron', 14)}</button></div>
      ${open ? `<div class="qh-qs">${qs.map(q => qRowHtml(q, t.id)).join('')}</div>` : ''}
    </article>`;
  }

  function render(){
    const p = $('page-qtt'); if(!p) return;
    const list = hist().slice().sort((a, b) => (b.endedAt || b.startedAt) - (a.endedAt || a.startedAt));
    const hasCont = !!sess || list.length;
    p.innerHTML = `
      <div class="head-row"><div><h1>Question <span class="accent">Timer</span></h1>
        <div class="date-line"><span class="t">Know exactly where your time goes, question by question</span></div></div></div>
      <section class="panel qd-hero">
        <div class="qd-timer ${sess && !isRunning() ? 'paused' : ''}" id="qdTimer" role="timer" aria-live="off">00:00</div>
        <div class="qd-sub" id="qdSub">${sess ? '' : 'No test running'}</div>
        <div class="qd-actions">
          <button type="button" class="qd-btn start" onclick="QTT.openStart()">${ico('play', 22)}<span>Start New Test</span></button>
          <button type="button" class="qd-btn cont" onclick="QTT.continueTest()" ${hasCont ? '' : 'disabled'}>${ico('clock', 22)}<span>Continue Test</span></button>
        </div>
      </section>
      ${logHtml()}
      ${analyticsHtml()}
      <div class="qd-hist-head"><h2>Previous Tests</h2><span>${plural(list.length, 'test')}</span></div>
      <div class="qh-list">${list.length ? list.map(cardHtml).join('') : `<div class="tx-empty"><div class="tx-empty-ico">${ico('timer', 28)}</div><h3>No tests yet</h3><p>Start a test, time every question, and your results will be saved here.</p></div>`}</div>`;
    updateTimers();
  }

  function toggleLog(){ logOpen = !logOpen; render(); }
  function toggleCard(id){ if(openCards.has(id)) openCards.delete(id); else openCards.add(id); render(); }
  function setTrend(v){ trendView = v; render(); }

  /* ---------------- history actions ---------------- */
  async function rename(id){
    const t = hist().find(x => x.id === id); if(!t) return;
    const name = await askText('Rename test', t.name, 'Test name'); if(!name) return;
    const list = hist(); const x = list.find(y => y.id === id); x.name = name; x.updatedAt = now(); saveHist(list); render();
    Utils.toast('Renamed', 'success');
  }
  async function remove(id){
    const t = hist().find(x => x.id === id); if(!t) return;
    const ok = await Tests.confirmDialog({ title:`Delete “${t.name}”?`, message:`This permanently removes the test and its ${plural(t.questions.length, 'recorded question')}.`, confirmText:'Delete test', danger:true });
    if(!ok) return;
    saveHist(hist().filter(x => x.id !== id)); openCards.delete(id); render();
    Utils.toast('Test deleted', 'success');
  }
  function csvCell(v){
    let s = String(v == null ? '' : v);
    if(/^[=+\-@\t\r]/.test(s)) s = "'" + s;          // neutralise spreadsheet formulas
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCsv(id){
    const t = hist().find(x => x.id === id); if(!t) return;
    const rows = [['Test', 'Date', 'Question', 'Status', 'Time (seconds)', 'Time (mm:ss)', 'Subject', 'Chapter', 'Topic', 'Difficulty', 'Target (seconds)']];
    t.questions.slice().sort((a, b) => a.n - b.n).forEach(q => rows.push([t.name, localDay(t.startedAt), q.n, (STATUS[q.status] || ['?'])[0], Math.round(q.ms / 1000), fmtMS(q.ms), q.subject, q.chapter, q.topic, q.difficulty, t.targetSec || DEFAULT_TARGET]));
    const blob = new Blob(['\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n')], { type:'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'question-timer-' + t.name.replace(/[^\w\-]+/g, '_').slice(0, 40) + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    Utils.toast('CSV downloaded', 'success');
  }

  /* ---------------- edit one recorded question ---------------- */
  function editQ(owner, qid){
    const test = owner === 'active' ? sess : hist().find(x => x.id === owner); if(!test) return;
    const q = test.questions.find(x => x.id === qid); if(!q) return;
    let o = $('qttEdit');
    if(!o){ o = document.createElement('div'); o.id = 'qttEdit'; o.className = 'modal-overlay qtt-overlay'; o.innerHTML = '<div class="modal tx-modal qtt-start" role="dialog" aria-modal="true"></div>'; document.body.appendChild(o); }
    const box = o.firstElementChild;
    box.innerHTML = `<h3>Edit question ${q.n}</h3><p>Recorded time: <b>${fmtMS(q.ms)}</b></p>
      <div class="tx-form">
        <div class="field"><label>Result</label><div class="qtt-chips" id="qeStatus">${Object.keys(STATUS).map(k => `<button type="button" class="qtt-chip ${q.status === k ? 'active' : ''}" data-s="${k}">${STATUS[k][0]}</button>`).join('')}</div></div>
        <div class="field-row"><div class="field"><label for="qeNum">Question number</label><input id="qeNum" type="number" min="1" max="9999" value="${q.n}"></div>
          <div class="field"><label for="qeSubj">Subject</label><select id="qeSubj"><option value="">—</option>${SUBJECTS.map(s => `<option ${q.subject === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div>
        <div class="field-row"><div class="field"><label for="qeChap">Chapter</label><input id="qeChap" type="text" maxlength="120" list="qttChapList2" value="${esc(q.chapter)}"></div>
          <div class="field"><label for="qeTopic">Topic</label><input id="qeTopic" type="text" maxlength="120" value="${esc(q.topic)}"></div></div>
        <datalist id="qttChapList2">${chapterNames().map(n => `<option value="${esc(n)}">`).join('')}</datalist>
        <div class="field"><label>Difficulty</label><div class="qtt-chips" id="qeDiff">${DIFFS.map(d => `<button type="button" class="qtt-chip ${q.difficulty === d ? 'active' : ''}" data-d="${d}">${d}</button>`).join('')}</div></div>
        <div class="modal-actions"><button type="button" class="pill-btn" id="qeCancel">Cancel</button><button type="button" class="pill-btn primary" id="qeSave">Save changes</button></div></div>`;
    let status = q.status, diff = q.difficulty;
    const close = () => { o.classList.remove('open'); document.removeEventListener('keydown', onKey, true); };
    const onKey = e => { if(e.key === 'Escape'){ e.stopImmediatePropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    box.querySelectorAll('#qeStatus .qtt-chip').forEach(b => b.onclick = () => { status = b.dataset.s; box.querySelectorAll('#qeStatus .qtt-chip').forEach(x => x.classList.toggle('active', x === b)); });
    box.querySelectorAll('#qeDiff .qtt-chip').forEach(b => b.onclick = () => { diff = (diff === b.dataset.d) ? '' : b.dataset.d; box.querySelectorAll('#qeDiff .qtt-chip').forEach(x => x.classList.toggle('active', x.dataset.d === diff)); });
    $('qeCancel').onclick = close; o.onclick = e => { if(e.target === o) close(); };
    $('qeSave').onclick = () => {
      const n = parseInt($('qeNum').value, 10);
      const patch = { status, n:n >= 1 ? n : q.n, subject:$('qeSubj').value, chapter:$('qeChap').value.trim(), topic:$('qeTopic').value.trim(), difficulty:diff };
      if(owner === 'active'){ Object.assign(q, patch); saveActive(); refreshScreen(); }
      else { const list = hist(), t = list.find(x => x.id === owner), qq = t && t.questions.find(x => x.id === qid); if(qq){ Object.assign(qq, patch); t.updatedAt = now(); saveHist(list); } }
      close(); render(); Utils.toast('Question updated', 'success');
    };
    o.classList.add('open');
  }

  /* =========================================================
     Init, keyboard, safety nets
     ========================================================= */
  function typing(e){ const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  function modalOpen(){ return !!document.querySelector('.modal-overlay.open'); }
  document.addEventListener('keydown', e => {
    if(!screenOpen || !sess || typing(e) || modalOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if(k === 'c'){ e.preventDefault(); mark('correct'); }
    else if(k === 'x'){ e.preventDefault(); mark('incorrect'); }
    else if(k === 's'){ e.preventDefault(); mark('unattempted'); }
    else if(k === 'r'){ e.preventDefault(); resetCurrent(); }
    else if(k === 'u'){ e.preventDefault(); undo(); }
    else if(k === ' '){ e.preventDefault(); togglePause(); }
  });
  window.addEventListener('beforeunload', e => { if(sess && sess.cur.runStart){ e.preventDefault(); e.returnValue = ''; } });

  function init(){
    loadActive();
    setInterval(() => { if(sess) updateTimers(); }, 250);
    setInterval(() => { if(sess && sess.cur.runStart){ sess.lastSeen = now(); saveActive(); } }, 5000);   // heartbeat for refresh/close recovery
    document.addEventListener('visibilitychange', () => { if(!document.hidden){ updateTimers(); if(screenOpen) requestWake(); } });
    if(sess){
      render();
      if(restoredPaused){ restoredPaused = false; Utils.toast('Unfinished test restored — paused where you left off. Open Question Timer to continue.', 'info'); }
    }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  return {
    render, reload, openStart, continueTest, minimize, mark, undo, resetCurrent, togglePause, pause, resume, endTest,
    toggleLog, toggleCard, setTrend, rename, remove, exportCsv, editQ,
    _state: () => sess, _stats: testStats
  };
})();
