/* =========================================================
   TaskxNova — syllabus.js
   Chapter checklist per subject: Lecture / Module / DPP / PYQ
   Drag & drop reorder, inline rename, search, auto progress.
   ========================================================= */

const Syllabus = (function(){

  const DEFAULT_SYLLABUS = {
    "Physics": ["Ch 1"],
    "Chemistry": ["Ch 1"],
    "Maths": ["Ch 1"]
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

  let sylSubject = 'Physics';
  let searchTerm = '';
  let dragId = null;

  function save(){ Storage.set('chapters', data); }
  function reload(){ data = Storage.get('chapters', data); }

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

  function deleteChapter(subject, chapterId){
    data[subject] = data[subject].filter(c => c.id !== chapterId);
    save(); render();
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
      return `
      <div class="chapter-row ${done ? 'done' : ''}" draggable="true" data-id="${ch.id}"
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
    setSubject, setSearch, toggleBox, addChapter, renameChapter, focusRename, deleteChapter, render, reload, overallPct,
    _onDragStart, _onDragOver, _onDrop, _onDragEnd,
    get subject(){ return sylSubject; }
  };
})();
