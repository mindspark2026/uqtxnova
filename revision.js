/* =========================================================
   TaskxNova — revision.js
   Automatic spaced repetition: Day 1 → 3 → 7 → 15 → 30 → History
   ========================================================= */

const Revision = (function(){
  const REV_INTERVALS = [1, 3, 7, 15, 30];
  let topics = Storage.get('topics', []);

  function save(){ Storage.set('topics', topics); }

  function reload(){ topics = Storage.get('topics', []); }

  function addTopic(subject, name){
    const now = Date.now();
    topics.push({
      id: Utils.uid(),
      subject, name,
      stage: 0,
      studiedAt: now,
      lastRevisedAt: null,
      nextDue: now + REV_INTERVALS[0]*86400000,
      revisionCount: 0,
      completed: false
    });
    save();
    Gamification.onRevisionAdded();
    render();
    App.checkReminder();
  }

  function markRevised(id){
    const t = topics.find(x => x.id === id);
    if(!t) return;
    if(t.stage >= REV_INTERVALS.length - 1){
      t.completed = true;
      t.lastRevisedAt = Date.now();
      t.revisionCount += 1;
      Utils.toast(`"${t.name}" moved to completed revision history`, 'success');
    } else {
      t.stage += 1;
      t.lastRevisedAt = Date.now();
      t.revisionCount += 1;
      t.nextDue = Date.now() + REV_INTERVALS[t.stage]*86400000;
      Utils.toast(`Next revision in ${REV_INTERVALS[t.stage]} day(s)`, 'success');
    }
    save();
    Gamification.onRevisionCompleted();
    render();
    App.checkReminder();
  }

  function deleteTopic(id){
    topics = topics.filter(t => t.id !== id);
    save();
    render();
    App.checkReminder();
  }

  function getDueCounts(){
    const now = Date.now();
    const active = topics.filter(t => !t.completed);
    const overdue = active.filter(t => Utils.daysBetween(now, t.nextDue) < 0);
    const dueToday = active.filter(t => Utils.daysBetween(now, t.nextDue) === 0);
    return { overdue: overdue.length, dueToday: dueToday.length, total: overdue.length + dueToday.length };
  }

  function render(){
    const now = Date.now();
    const active = topics.filter(t => !t.completed);
    const completed = topics.filter(t => t.completed);
    const overdue = active.filter(t => Utils.daysBetween(now, t.nextDue) < 0).sort((a,b)=>a.nextDue-b.nextDue);
    const dueToday = active.filter(t => Utils.daysBetween(now, t.nextDue) === 0).sort((a,b)=>a.nextDue-b.nextDue);
    const upcoming = active.filter(t => Utils.daysBetween(now, t.nextDue) > 0).sort((a,b)=>a.nextDue-b.nextDue).slice(0,30);
    const revisedThisWeek = topics.filter(t => t.lastRevisedAt && Utils.daysBetween(t.lastRevisedAt, now) <= 7).length;

    setText('revStatTotal', active.length);
    setText('revStatOverdue', overdue.length);
    setText('revStatDueToday', dueToday.length);
    setText('revStatWeek', revisedThisWeek);
    setText('revStatCompleted', completed.length);

    const dueList = document.getElementById('dueList');
    const dueCombined = [...overdue, ...dueToday];
    if(dueCombined.length === 0){
      dueList.innerHTML = emptyState('Nothing due — you\'re all caught up');
    } else {
      dueList.innerHTML = dueCombined.map(t => {
        const overdueDays = -Utils.daysBetween(now, t.nextDue);
        const cls = overdueDays > 0 ? 'overdue' : 'today';
        const tag = overdueDays > 0 ? `${overdueDays}D OVERDUE` : 'DUE TODAY';
        return `
        <div class="rev-item ${cls}">
          <span class="q-dot" style="background:${App.CATS[t.subject]}"></span>
          <div class="rev-main">
            <div class="rev-desc">${Utils.escapeHtml(t.name)}</div>
            <div class="rev-meta">${t.subject} · ${t.lastRevisedAt ? 'Last revised ' + Utils.fmtDate(t.lastRevisedAt) : 'Never revised'} · Round ${t.revisionCount}</div>
          </div>
          <span class="rev-stage">STAGE ${t.stage+1}/${REV_INTERVALS.length}</span>
          <span class="rev-due-tag ${cls}">${tag}</span>
          <button class="rev-btn" onclick="Revision.markRevised('${t.id}')">Mark Revised</button>
          <button class="rev-del" onclick="Revision.deleteTopic('${t.id}')">&times;</button>
        </div>`;
      }).join('');
    }

    const upList = document.getElementById('upcomingList');
    if(upcoming.length === 0){
      upList.innerHTML = emptyState('No upcoming revisions scheduled');
    } else {
      upList.innerHTML = upcoming.map(t => `
        <div class="rev-item">
          <span class="q-dot" style="background:${App.CATS[t.subject]}"></span>
          <div class="rev-main">
            <div class="rev-desc">${Utils.escapeHtml(t.name)}</div>
            <div class="rev-meta">${t.subject} · Due ${Utils.fmtDate(t.nextDue)} · Round ${t.revisionCount}</div>
          </div>
          <span class="rev-stage">STAGE ${t.stage+1}/${REV_INTERVALS.length}</span>
          <span class="rev-due-tag future">IN ${Utils.daysBetween(now,t.nextDue)}D</span>
          <button class="rev-del" onclick="Revision.deleteTopic('${t.id}')">&times;</button>
        </div>
      `).join('');
    }

    const histList = document.getElementById('historyList');
    if(histList){
      if(completed.length === 0){
        histList.innerHTML = emptyState('No completed revisions yet');
      } else {
        histList.innerHTML = completed.sort((a,b)=>b.lastRevisedAt-a.lastRevisedAt).slice(0,30).map(t => `
          <div class="rev-item">
            <span class="q-dot" style="background:${App.CATS[t.subject]}"></span>
            <div class="rev-main">
              <div class="rev-desc">${Utils.escapeHtml(t.name)}</div>
              <div class="rev-meta">${t.subject} · Completed ${Utils.fmtDate(t.lastRevisedAt)} · ${t.revisionCount} rounds</div>
            </div>
            <span class="rev-due-tag future" style="background:rgba(52,211,153,0.14);color:var(--green);">MASTERED</span>
            <button class="rev-del" onclick="Revision.deleteTopic('${t.id}')">&times;</button>
          </div>
        `).join('');
      }
    }

    const prog = document.getElementById('subjectProgress');
    if(prog){
      prog.innerHTML = Object.keys(App.CATS).map(subj => {
        const subjTopics = topics.filter(t => t.subject === subj);
        const maxStage = REV_INTERVALS.length - 1;
        const avgStage = subjTopics.length ? subjTopics.reduce((s,t)=>s+(t.completed?maxStage:t.stage),0) / subjTopics.length : 0;
        const pct = subjTopics.length ? Math.round((avgStage / maxStage) * 100) : 0;
        return `
          <div>
            <div class="subj-row">
              <span class="sname"><span class="sdot" style="background:${App.CATS[subj]}"></span>${subj}</span>
              <span class="scount">${subjTopics.length} topics · ${pct}% mastery</span>
            </div>
            <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:${App.CATS[subj]};"></div></div>
          </div>`;
      }).join('');
    }
  }

  function setText(id, val){ const el = document.getElementById(id); if(el) el.textContent = val; }
  function emptyState(msg){
    return `<div class="queue-empty">
      <div class="ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5D5D80" stroke-width="1.8"><path d="M20 6L9 17l-5-5"/></svg></div>
      <div class="msg">${msg}</div>
    </div>`;
  }

  return { REV_INTERVALS, addTopic, markRevised, deleteTopic, render, reload, getDueCounts, get topics(){ return topics; } };
})();
