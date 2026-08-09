/* =========================================================
   TaskxNova — calendar.js
   Modern monthly calendar. Click a date to see topics,
   revisions, and tasks scheduled or logged that day.
   ========================================================= */

const Calendar = (function(){
  let viewDate = new Date();
  let selectedDate = new Date();

  function prevMonth(){ viewDate.setMonth(viewDate.getMonth()-1); render(); }
  function nextMonth(){ viewDate.setMonth(viewDate.getMonth()+1); render(); }
  function goToday(){ viewDate = new Date(); selectedDate = new Date(); render(); }

  function selectDate(y,m,d){
    selectedDate = new Date(y,m,d);
    render();
  }

  function dayEvents(date){
    const entries = (Storage.get('entries', [])||[]).filter(e => Utils.sameDay(e.ts, date));
    const revisions = (Revision.topics||[]).filter(t => Utils.sameDay(t.nextDue, date) && !t.completed);
    const tasks = (Storage.get('tasks', [])||[]).filter(t => t.date && Utils.sameDay(new Date(t.date), date));
    return { entries, revisions, tasks };
  }

  /* Generalized version of dayEvents for an arbitrary [from, to] range (inclusive).
     Capped at 62 days so a bad AI-supplied range can't loop forever. */
  function getEventsInRange(from, to){
    const start = new Date(from); start.setHours(0,0,0,0);
    const end = new Date(to); end.setHours(0,0,0,0);
    const out = [];
    let cursor = new Date(start);
    let guard = 0;
    while(cursor <= end && guard < 62){
      out.push({ date: cursor.toDateString(), ...dayEvents(cursor) });
      cursor.setDate(cursor.getDate()+1);
      guard++;
    }
    return out;
  }

  function render(){
    const titleEl = document.getElementById('calTitle');
    if(!titleEl) return;
    titleEl.textContent = viewDate.toLocaleDateString(undefined,{month:'long', year:'numeric'});

    const grid = document.getElementById('calGrid');
    const y = viewDate.getFullYear(), m = viewDate.getMonth();
    const firstDow = new Date(y,m,1).getDay();
    const daysInMonth = new Date(y,m+1,0).getDate();
    const today = new Date();

    let html = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="cal-dow">${d}</div>`).join('');
    for(let i=0;i<firstDow;i++) html += `<div class="cal-cell empty"></div>`;

    for(let d=1; d<=daysInMonth; d++){
      const dateObj = new Date(y,m,d);
      const isToday = dateObj.toDateString() === today.toDateString();
      const isSelected = dateObj.toDateString() === selectedDate.toDateString();
      const ev = dayEvents(dateObj);
      const dots = [];
      if(ev.entries.length) dots.push(`<span style="background:var(--primary-2)"></span>`);
      if(ev.revisions.length) dots.push(`<span style="background:var(--amber)"></span>`);
      if(ev.tasks.length) dots.push(`<span style="background:var(--green)"></span>`);
      const typeSet = [];
      [...ev.entries, ...ev.tasks].forEach(x => Utils.parseTaskTypes(x.type).forEach(ty => { if(!typeSet.includes(ty)) typeSet.push(ty); }));
      const dayTip = typeSet.length ? ` title="${Utils.escapeHtml(typeSet.join(' • '))}"` : '';
      html += `<div class="cal-cell ${isToday?'today':''} ${isSelected?'selected':''}" onclick="Calendar.selectDate(${y},${m},${d})"${dayTip}>
        <span class="cal-daynum">${d}</span>
        <div class="cal-dots">${dots.join('')}</div>
      </div>`;
    }
    grid.innerHTML = html;
    renderDetail();
  }

  function renderDetail(){
    const box = document.getElementById('calDetail');
    if(!box) return;
    const ev = dayEvents(selectedDate);
    const heading = Utils.fmtDateLong(selectedDate);
    let body = '';

    if(ev.entries.length){
      body += `<div class="panel-sub" style="margin:14px 0 8px;">STUDY LOGGED</div>` + ev.entries.map(e => `
        <div class="queue-item"><span class="q-dot" style="background:${App.CATS[e.cat]}"></span>
          <div class="q-main"><div class="q-desc">${Utils.escapeHtml(e.desc)}</div>
          <div class="q-meta">${e.cat}${e.type?' · '+Utils.formatTaskTypes(e.type):''} · ${Utils.formatDuration(e.dur)} · ${e.prob||0} problems</div></div></div>`).join('');
    }
    if(ev.revisions.length){
      body += `<div class="panel-sub" style="margin:14px 0 8px;">REVISIONS DUE</div>` + ev.revisions.map(t => `
        <div class="queue-item"><span class="q-dot" style="background:${App.CATS[t.subject]}"></span>
          <div class="q-main"><div class="q-desc">${Utils.escapeHtml(t.name)}</div>
          <div class="q-meta">${t.subject} · Stage ${t.stage+1}/${Revision.REV_INTERVALS.length}</div></div></div>`).join('');
    }
    if(ev.tasks.length){
      body += `<div class="panel-sub" style="margin:14px 0 8px;">TASKS</div>` + ev.tasks.map(t => `
        <div class="queue-item"><span class="q-dot" style="background:${t.done?'var(--green)':'var(--text-faint)'}"></span>
          <div class="q-main"><div class="q-desc">${Utils.escapeHtml(t.title)}</div>
          <div class="q-meta">${t.subject||''}${t.type?' · '+Utils.formatTaskTypes(t.type):''}${t.duration?' · '+Utils.formatDuration(t.duration):''}</div></div></div>`).join('');
    }
    if(!body){
      body = `<div class="queue-empty"><div class="msg">Nothing scheduled or logged this day</div></div>`;
    }
    box.innerHTML = `<div class="panel-title" style="margin-bottom:0;">${heading}</div>` + body;
  }

  return { prevMonth, nextMonth, goToday, selectDate, render, getEventsInRange };
})();
