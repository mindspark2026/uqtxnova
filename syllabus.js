/* =========================================================
   TaskxNova — syllabus.js
   Chapter checklist per subject: Lecture / Module / DPP / PYQ
   Drag & drop reorder, inline rename, search, auto progress.
   ========================================================= */

const Syllabus = (function(){

  // Default curriculum used only to seed a brand-new account's syllabus
  // (i.e. when `chapters` doesn't exist yet). Chemistry is intentionally
  // ONE flat, continuous chapter list — never split into Physical /
  // Inorganic / Organic sub-lists — matching the existing subject
  // structure (Physics / Chemistry / Maths), unchanged.
  const DEFAULT_SYLLABUS = {
    "Physics": [
      "Units and Measurement",
      "Mathematical Tools",
      "Motion in a Straight Line",
      "Motion in a Plane",
      "Laws of Motion",
      "Circular Motion",
      "Work, Energy and Power",
      "Centre of Mass & System of Particles",
      "Rotational Motion",
      "Gravitation",
      "Kinetic Theory & Thermodynamics",
      "Mechanical Properties of Solids",
      "Mechanical Properties of Fluids",
      "Thermal Properties of Matter",
      "Simple Harmonic Motion",
      "Waves"
    ],
    "Chemistry": [
      "Mole Concept",
      "Structure of Atom",
      "State of Matter",
      "Thermodynamics",
      "Redox Reaction",
      "Chemical Equilibrium",
      "Ionic Equilibrium",
      "Periodic Table",
      "Chemical Bonding",
      "P-block Elements",
      "S-block Element",
      "Hydrogen and its Compound",
      "Some Basic Principles and Techniques",
      "Some Basic Principles and Techniques IUPAC Naming",
      "Some Basic Principles and Techniques GOC",
      "Some Basic Principles and Techniques Isomerism",
      "Hydrocarbon",
      "Purification and Analysis of Organic Compounds",
      "Environmental Chemistry"
    ],
    "Maths": [
      "Set Theory",
      "Basic Mathematics",
      "Quadratic Equations",
      "Sequence and Series",
      "Trigonometric Functions",
      "Trigonometric Equation",
      "Relations and Functions",
      "Permutations and Combinations",
      "Binomial Theorem",
      "Straight Lines",
      "Circles",
      "Conic Sections: Parabola",
      "Conic Sections: Ellipse",
      "Conic Sections: Hyperbola",
      "Complex Number",
      "Limits and Derivatives",
      "Statistics",
      "Probability",
      "Introduction to Three Dimensional Geometry",
      "Linear Inequalities",
      "Solution of Triangle"
    ]
  };

  let data = Storage.get('chapters', null);
  if(!data || !data.Physics || !Array.isArray(data.Physics)){
    // migrate from legacy {subject:{chapterName:bool}} or seed fresh
    const legacy = Storage.get('chapters', {});
    data = {};
    Object.keys(DEFAULT_SYLLABUS).forEach(subj => {
      data[subj] = DEFAULT_SYLLABUS[subj].map(name => {
        const wasDone = legacy[subj] && legacy[subj][name];
        return { id: Utils.uid(), name, L: !!wasDone, M: !!wasDone, D: !!wasDone, P: !!wasDone };
      });
    });
    Storage.set('chapters', data);
  }

  /* ---------------- one-time, additive curriculum seeding ----------------
     For accounts that already had syllabus data before this chapter list
     was added: this only ever APPENDS a chapter whose name doesn't
     already exist (case/whitespace-insensitive match) for that subject.
     It never renames, reorders, deletes, or touches the L/M/D/P progress
     of any existing chapter — including a plain "Ch 1" placeholder from
     before, which is left exactly as it was. Guarded by a small local
     flag (scoped to the active account namespace via Storage.activePrefix(),
     same isolation the rest of the app uses) so it runs at most once per
     account per device and can never re-add something the user later
     deletes on purpose. If another device already pushed these chapters
     up via cloud sync, the name-check here naturally finds nothing left
     to add — safe either way, never creates a duplicate. */
  function normChapterName(s){ return String(s || '').trim().toLowerCase(); }

  function ensureCurriculumChapters(){
    let flagKey;
    try{ flagKey = Storage.activePrefix() + '__syllabus_curriculum_seeded'; }catch(e){ return; }
    try{ if(localStorage.getItem(flagKey)) return; }catch(e){ return; }

    let changed = false;
    Object.keys(DEFAULT_SYLLABUS).forEach(subj => {
      if(!Array.isArray(data[subj])) return; // don't invent a subject structure that isn't already there
      const existingNames = new Set(data[subj].map(c => normChapterName(c.name)));
      DEFAULT_SYLLABUS[subj].forEach(name => {
        const key = normChapterName(name);
        if(!existingNames.has(key)){
          data[subj].push({ id: Utils.uid(), name, L:false, M:false, D:false, P:false });
          existingNames.add(key);
          changed = true;
        }
      });
    });

    if(changed) save();
    try{ localStorage.setItem(flagKey, '1'); }catch(e){}
  }
  ensureCurriculumChapters();

  // Add these Chemistry subtopics to existing accounts without resetting or
  // changing any chapter progress. A separate versioned flag ensures users
  // who already completed the original syllabus seed still receive them.
  function ensureChemistrySubtopics(){
    let flagKey;
    try{ flagKey = Storage.activePrefix() + '__chemistry_subtopics_seeded_v1'; }catch(e){ return; }
    try{ if(localStorage.getItem(flagKey)) return; }catch(e){ return; }
    if(!Array.isArray(data.Chemistry)) return;
    const additions = [
      'Some Basic Principles and Techniques IUPAC Naming',
      'Some Basic Principles and Techniques GOC',
      'Some Basic Principles and Techniques Isomerism'
    ];
    const existing = new Set(data.Chemistry.map(c => normChapterName(c.name)));
    let changed = false;
    additions.forEach(name => {
      const key = normChapterName(name);
      if(!existing.has(key)){
        data.Chemistry.push({ id: Utils.uid(), name, L:false, M:false, D:false, P:false });
        existing.add(key);
        changed = true;
      }
    });
    if(changed) save();
    try{ localStorage.setItem(flagKey, '1'); }catch(e){}
  }
  ensureChemistrySubtopics();

  let sylSubject = 'Physics';
  let searchTerm = '';
  let dragId = null;

  function save(){ Storage.set('chapters', data); }
  function reload(){ data = Storage.get('chapters', data); ensureCurriculumChapters(); ensureChemistrySubtopics(); }

  function setSubject(subj){ sylSubject = subj; render(); }
  function setSearch(term){ searchTerm = term.toLowerCase(); render(); }

  function toggleBox(subject, chapterId, key){
    const ch = data[subject].find(c => c.id === chapterId);
    if(!ch) return;
    ch[key] = !ch[key];
    save();
    if(ch.L && ch.M && ch.D && ch.P){
      Gamification.onChapterCompleted();
      Utils.toast(`${ch.name} fully completed 🎉`, 'success');
    }
    render();
  }

  function addChapter(subject){
    const name = 'Ch ' + (data[subject].length + 1);
    data[subject].push({ id: Utils.uid(), name, L:false, M:false, D:false, P:false });
    save(); render();
  }

  function renameChapter(subject, chapterId, name){
    const ch = data[subject].find(c => c.id === chapterId);
    if(ch) { ch.name = name || ch.name; save(); }
  }

  function focusRename(chapterId){
    const input = document.getElementById('chName-' + chapterId);
    if(!input) return;
    input.focus();
    input.select();
  }

  const deleting = new Set();
  function askDeleteConfirmation(title, message){
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay open';
      overlay.style.zIndex = '10050';
      overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="chapterDeleteTitle"><h3 id="chapterDeleteTitle">${Utils.escapeHtml(title)}</h3><p style="color:var(--text-dim);line-height:1.6;margin:12px 0 20px;">${Utils.escapeHtml(message)}</p><div class="modal-actions"><button type="button" class="pill-btn" data-choice="cancel">Cancel</button><button type="button" class="pill-btn danger" data-choice="delete">Delete Chapter</button></div></div>`;
      const finish = value => { overlay.remove(); resolve(value); };
      overlay.addEventListener('click', e => { if(e.target === overlay) finish(false); });
      overlay.querySelector('[data-choice="cancel"]').addEventListener('click', () => finish(false));
      overlay.querySelector('[data-choice="delete"]').addEventListener('click', () => finish(true));
      document.body.appendChild(overlay);
      overlay.querySelector('[data-choice="cancel"]').focus();
    });
  }
  async function deleteChapter(subject, chapterId){
    const key = subject + '::' + chapterId;
    if(deleting.has(key)) return;
    const chapter = (data[subject] || []).find(c => c.id === chapterId);
    if(!chapter) return;
    deleting.add(key);
    try{
      const linkedErrors = window.Errors && Errors.getForChapter ? Errors.getForChapter(subject, chapterId) : [];
      const linkedLogs = Array.isArray(chapter.studyLogs) ? chapter.studyLogs.length : 0;
      const linkedProgress = [chapter.L, chapter.M, chapter.D, chapter.P].some(Boolean);
      let message = 'Are you sure you want to delete this chapter? This action cannot be undone.';
      if(linkedLogs || linkedProgress || linkedErrors.length){
        const details = [];
        if(linkedLogs) details.push(linkedLogs + ' study session record(s)');
        if(linkedProgress) details.push('chapter progress');
        if(linkedErrors.length) details.push(linkedErrors.length + ' linked error record(s)');
        message += ' This chapter contains ' + details.join(', ') + '. Study logs and progress stored inside this chapter will be removed. Linked errors will NOT be deleted; they will remain in Errors as Chapter Deleted and can be reassigned later.';
      }
      const confirmed = await askDeleteConfirmation('Delete Chapter?', message);
      if(!confirmed) return;
      if(linkedErrors.length){
        const all = Storage.get('errors', []) || [];
        all.forEach(err => { if(err.subject === subject && err.chapterId === chapterId){ err.chapterName = chapter.name; err.chapterDeleted = true; err.updatedAt = Date.now(); } });
        Storage.set('errors', all);
      }
      data[subject] = (data[subject] || []).filter(c => c.id !== chapterId);
      save(); render();
      if(window.Errors && Errors.reload) Errors.reload();
    } finally { deleting.delete(key); }
  }

  function reorder(subject, fromId, toId){
    const arr = data[subject];
    const fromIdx = arr.findIndex(c => c.id === fromId);
    const toIdx = arr.findIndex(c => c.id === toId);
    if(fromIdx < 0 || toIdx < 0) return;
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);
    save(); render();
  }


  function getChapters(subject){
    return (data[subject] || []).map(ch => ({ id: ch.id, name: ch.name }));
  }

  function getChapterById(subject, chapterId){ return (data[subject] || []).find(ch => ch.id === chapterId) || null; }

  function recordStudySession(subject, chapterId, session){
    const ch = (data[subject] || []).find(c => c.id === chapterId);
    if(!ch || !session) return;
    ch.studyLogs = Array.isArray(ch.studyLogs) ? ch.studyLogs : [];
    if(session.taskId) ch.studyLogs = ch.studyLogs.filter(x => x.taskId !== session.taskId);
    ch.studyLogs.push({ ...session, id: session.taskId || Utils.uid() });
    save();
    render();
  }

  function removeStudySession(taskId){
    if(!taskId) return;
    let changed = false;
    Object.keys(data).forEach(subject => (data[subject] || []).forEach(ch => {
      if(Array.isArray(ch.studyLogs)){
        const before = ch.studyLogs.length;
        ch.studyLogs = ch.studyLogs.filter(x => x.taskId !== taskId);
        if(ch.studyLogs.length !== before) changed = true;
      }
    }));
    if(changed){ save(); render(); }
  }

  function showChapterDetails(subject, chapterId){
    const ch = (data[subject] || []).find(c => c.id === chapterId);
    if(!ch) return;
    const logs = (ch.studyLogs || []).slice().sort((a,b) => new Date(b.date) - new Date(a.date));
    const totalMin = logs.reduce((sum, x) => sum + (Number(x.durationMin)||0), 0);
    const totalProblems = logs.reduce((sum, x) => sum + (Number(x.problems)||0), 0);
    const fmt = m => `${Math.floor(m/60)} hr ${m%60} min`;
    document.getElementById('chapterStudyTitle').textContent = `${ch.name} · ${subject}`;
    document.getElementById('chapterStudySummary').innerHTML = `
      <div class="stat-card"><p class="stat-label">Total Study Time</p><p class="stat-num">${fmt(totalMin)}</p></div>
      <div class="stat-card"><p class="stat-label">Classes / Sessions</p><p class="stat-num">${logs.length}</p></div>
      <div class="stat-card"><p class="stat-label">Problems Solved</p><p class="stat-num">${totalProblems}</p></div>`;
    const list = document.getElementById('chapterStudySessions');
    list.innerHTML = logs.length ? logs.map(x => {
      const d = new Date(x.date);
      const date = isNaN(d) ? 'Date unavailable' : d.toLocaleString();
      return `<div class="queue-item" style="margin-bottom:8px;"><div class="q-main"><div class="q-desc">${Utils.escapeHtml(x.type || 'Study session')} · ${fmt(Number(x.durationMin)||0)}</div><div class="q-meta">${Utils.escapeHtml(date)}${x.problems ? ` · ${x.problems} problems` : ''}</div>${x.description ? `<div class="q-notes">${Utils.escapeHtml(x.description)}</div>` : ''}</div></div>`;
    }).join('') : '<div class="queue-empty"><div class="msg">No completed study sessions logged for this chapter yet.</div></div>';
    const errorBox = document.getElementById('chapterStudyErrors');
    if(errorBox){
      const linked = window.Errors && Errors.getForChapter ? Errors.getForChapter(subject, chapterId) : [];
      errorBox.innerHTML = `<h4 style="margin:18px 0 10px;">Errors linked to this chapter (${linked.length})</h4>` + (linked.length ? linked.map(e => `<button type="button" class="queue-item" style="width:100%;text-align:left;margin-bottom:7px;" onclick="App.setPage('errors');Errors.openDetail('${String(e.id).replace(/'/g, '&#39;')}')"><span class="q-main"><span class="q-desc">${Utils.escapeHtml(e.title || 'Untitled error')}</span><span class="q-meta">${Utils.escapeHtml(e.date || '')}</span></span><span>Open →</span></button>`).join('') : '<div class="queue-empty"><div class="msg">No errors saved for this chapter yet.</div></div>');
    }
    document.getElementById('chapterStudyModal').classList.add('open');
  }

  function closeChapterDetails(){ document.getElementById('chapterStudyModal').classList.remove('open'); }

  function handleChapterRowClick(event, subject, chapterId){
    // Keep chapter editing, progress toggles, and delete controls independent.
    if(event.target.closest('input, button, .cbox, .chapter-drag')) return;
    showChapterDetails(subject, chapterId);
  }

  function chapterPct(ch){
    const done = [ch.L, ch.M, ch.D, ch.P].filter(Boolean).length;
    return Math.round((done / 4) * 100);
  }

  function subjectDoneCount(subject){
    const arr = data[subject] || [];
    const done = arr.filter(c => c.L && c.M && c.D && c.P).length;
    return [done, arr.length];
  }

  function overallPct(){
    let done = 0, total = 0;
    Object.keys(data).forEach(subj => {
      data[subj].forEach(c => { total += 4; done += [c.L,c.M,c.D,c.P].filter(Boolean).length; });
    });
    return total ? Math.round((done/total)*100) : 0;
  }

  function render(){
    Object.keys(DEFAULT_SYLLABUS).forEach(subj => {
      const [done, total] = subjectDoneCount(subj);
      const el = document.getElementById('sylStat' + subj);
      if(el) el.textContent = `${done}/${total}`;
    });

    document.querySelectorAll('#sylTabs button').forEach(b => b.classList.toggle('active', b.dataset.subject === sylSubject));

    const list = document.getElementById('chapterList');
    if(!list) return;
    let chapters = data[sylSubject] || [];
    if(searchTerm) chapters = chapters.filter(c => c.name.toLowerCase().includes(searchTerm));

    if(chapters.length === 0){
      list.innerHTML = `<div class="queue-empty"><div class="msg">No chapters found</div></div>`;
      return;
    }

    list.innerHTML = chapters.map((ch) => {
      const pct = chapterPct(ch);
      const done = pct === 100;
      const studyMin = (ch.studyLogs || []).reduce((sum, x) => sum + (Number(x.durationMin)||0), 0);
      const studyHours = `${Math.floor(studyMin/60)}h ${studyMin%60}m`;
      return `
      <div class="chapter-row ${done ? 'done' : ''}" draggable="true" data-id="${ch.id}"
           onclick="Syllabus.handleChapterRowClick(event,'${sylSubject}','${ch.id}')"
           ondragstart="Syllabus._onDragStart(event,'${ch.id}')" ondragover="Syllabus._onDragOver(event)"
           ondrop="Syllabus._onDrop(event,'${ch.id}')" ondragend="Syllabus._onDragEnd(event)">
        <span class="chapter-drag">⋮⋮</span>
        <input class="chapter-name" id="chName-${ch.id}" value="${Utils.escapeHtml(ch.name)}"
               onchange="Syllabus.renameChapter('${sylSubject}','${ch.id}', this.value)">
        <button class="chapter-edit" onclick="Syllabus.focusRename('${ch.id}')" data-tip="Edit name"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
        <div class="chapter-boxes">
          <div class="cbox ${ch.L?'on':''}" data-tip="Lecture" onclick="Syllabus.toggleBox('${sylSubject}','${ch.id}','L')">L</div>
          <div class="cbox ${ch.M?'on':''}" data-tip="Module" onclick="Syllabus.toggleBox('${sylSubject}','${ch.id}','M')">M</div>
          <div class="cbox ${ch.D?'on':''}" data-tip="DPP" onclick="Syllabus.toggleBox('${sylSubject}','${ch.id}','D')">D</div>
          <div class="cbox ${ch.P?'on':''}" data-tip="PYQ" onclick="Syllabus.toggleBox('${sylSubject}','${ch.id}','P')">P</div>
        </div>
        <div class="chapter-progress"><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${App.CATS[sylSubject]};"></div></div></div>
        <span class="chapter-pct">${pct}%</span>
        <span class="q-meta" title="Recorded study time">${studyHours}</span>
        <button class="chapter-del" onclick="Syllabus.deleteChapter('${sylSubject}','${ch.id}')">&times;</button>
      </div>`;
    }).join('');
  }

  function _onDragStart(e, id){ dragId = id; e.currentTarget.classList.add('dragging'); }
  function _onDragOver(e){ e.preventDefault(); }
  function _onDrop(e, targetId){
    e.preventDefault();
    if(dragId && dragId !== targetId) reorder(sylSubject, dragId, targetId);
    dragId = null;
  }
  function _onDragEnd(e){ e.currentTarget.classList.remove('dragging'); }

  return {
    setSubject, setSearch, toggleBox, addChapter, renameChapter, focusRename, deleteChapter, render, reload, overallPct, getChapters, getChapterById, recordStudySession, removeStudySession, showChapterDetails, closeChapterDetails,
    _onDragStart, _onDragOver, _onDrop, _onDragEnd, handleChapterRowClick,
    get subject(){ return sylSubject; }
  };
})();
