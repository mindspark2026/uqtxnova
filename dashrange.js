/* =========================================================
   UQTxNova — dashrange.js
   CUSTOM DATE range for the Mission Dashboard (From / To / Apply / Clear).

   It plugs into the existing dashboard: App keeps TODAY / WEEK / MONTH /
   YEAR exactly as before and asks this module whenever range === 'custom'
   which timestamps / tasks / revision topics fall inside the period.

   Task semantics (works with the pending-task rollover in app.js):
     • a task belongs to the period by the date it was ORIGINALLY scheduled
       (t.originalDate || t.date) — so a carried-over task is counted once;
     • "completed" uses the real completion date (t.completedAt / completedOn),
       which can be later than the scheduled date and is shown alongside it;
     • study hours / problems come from logged entries, i.e. the day the work
       was actually done.
   ========================================================= */

const DashRange = (function(){
  'use strict';
  const KEY = 'uqx_custom_range';          // device-local UI preference (not synced)
  let from = null, to = null;              // 'YYYY-MM-DD' strings
  let panelOpen = false;
  const $ = id => document.getElementById(id);
  const esc = s => Utils.escapeHtml(s);

  function parse(s){
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if(!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return (d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3]) ? d : null;
  }
  const ymd = d => d.getFullYear() + '-' + Utils.pad2(d.getMonth() + 1) + '-' + Utils.pad2(d.getDate());
  const fmt = s => parse(s).toLocaleDateString(undefined, { day:'numeric', month:'short', year:'numeric' });
  const fmtShort = v => { const d = new Date(v); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day:'numeric', month:'short' }); };

  function active(){ return !!(from && to && parse(from) && parse(to)); }
  function startTs(){ return parse(from).getTime(); }
  function endTs(){ const d = parse(to); d.setHours(23, 59, 59, 999); return d.getTime(); }
  function inRangeTs(ts){ return active() && ts >= startTs() && ts <= endTs(); }
  function inRangeDate(v){ const d = new Date(v); return !isNaN(d) && inRangeTs(d.getTime()); }
  function dayCount(){ return Math.round((parse(to) - parse(from)) / 86400000) + 1; }
  function get(){ return active() ? { from, to, days:dayCount() } : null; }

  function load(){
    try{
      const o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if(o && parse(o.from) && parse(o.to) && o.to >= o.from){ from = o.from; to = o.to; }
    }catch(e){}
  }
  function persist(){
    try{
      if(active()) localStorage.setItem(KEY, JSON.stringify({ from, to }));
      else localStorage.removeItem(KEY);
    }catch(e){}
  }

  /* ---------------- tasks ---------------- */
  const origDate = t => t.originalDate || t.date;
  function completionDate(t){
    if(t.completedAt) return new Date(t.completedAt);
    if(t.completedOn) return new Date(t.completedOn);
    if(t.entryTs) return new Date(t.entryTs);          // older tasks: the logged session's time
    return t.date ? new Date(t.date) : null;
  }
  function tasksInRange(){
    const all = (typeof App !== 'undefined' && App.getTasks) ? App.getTasks() : [];
    return all.filter(t => inRangeDate(origDate(t)));
  }
  function statusOf(t){
    if(t.done) return 'completed';
    const d = new Date(t.date), today = new Date(); today.setHours(0, 0, 0, 0);
    if(t.rescheduled && (isNaN(d) || d >= today)) return 'rescheduled';
    if(!isNaN(d) && d > today) return 'planned';
    return 'pending';
  }
  function sameDay(a, b){ return a && b && a.toDateString() === b.toDateString(); }
  function taskStats(){
    const list = tasksInRange();
    const rows = list.map(t => {
      const done = completionDate(t), sched = new Date(origDate(t));
      return { t, status:statusOf(t), sched, done:t.done ? done : null, late:!!(t.done && done && !sameDay(done, sched) && done > sched) };
    });
    return {
      total:rows.length,
      done:rows.filter(r => r.status === 'completed').length,
      pending:rows.filter(r => r.status === 'pending').length,
      rescheduled:rows.filter(r => r.status === 'rescheduled').length,
      planned:rows.filter(r => r.status === 'planned').length,
      late:rows.filter(r => r.late).length,
      rows
    };
  }
  function revisionDue(){
    const topics = (typeof Revision !== 'undefined' && Revision.topics) ? Revision.topics : [];
    return topics.filter(t => !t.completed && t.nextDue && inRangeTs(t.nextDue)).length;
  }

  /* ---------------- chart options (used by charts.js) ---------------- */
  function chartOpts(){ return active() ? { from:startTs(), to:endTs(), days:dayCount() } : null; }

  /* ---------------- UI ---------------- */
  function setErr(msg){ const e = $('crErr'); if(e){ e.textContent = msg || ''; e.hidden = !msg; } }
  function syncMinMax(){
    const f = $('crFrom'), t = $('crTo'); if(!f || !t) return;
    t.min = f.value || ''; f.max = t.value || '';
  }
  function openPanel(force){
    const p = $('customRangePanel'); if(!p) return;
    if(active() && App.getRange() !== 'custom') App.setRange('custom');   // show the saved period right away
    panelOpen = force === true ? true : !panelOpen;
    p.hidden = !panelOpen;
    const f = $('crFrom'), t = $('crTo');
    if(panelOpen){
      if(active()){ f.value = from; t.value = to; }
      else if(!f.value || !t.value){ const n = new Date(), s = new Date(); s.setDate(n.getDate() - 6); f.value = ymd(s); t.value = ymd(n); }
      syncMinMax(); setErr('');
      p.classList.remove('anim-in'); void p.offsetWidth; p.classList.add('anim-in');
    }
    const tab = document.querySelector('#rangeTabs [data-range="custom"]');
    if(tab) tab.classList.toggle('open', panelOpen);
  }
  function apply(){
    const f = $('crFrom').value, t = $('crTo').value;
    if(!f || !t){ setErr('Please choose both a From date and a To date.'); return; }
    if(!parse(f) || !parse(t)){ setErr('One of the dates is not valid.'); return; }
    if(t < f){ setErr('The To date can\'t be earlier than the From date.'); Utils.shakeElement($('crTo')); return; }
    from = f; to = t; persist(); setErr('');
    panelOpen = false; $('customRangePanel').hidden = true;
    const tab = document.querySelector('#rangeTabs [data-range="custom"]'); if(tab) tab.classList.remove('open');
    App.setRange('custom');
    Utils.toast(`Showing ${fmt(from)} – ${fmt(to)}`, 'success');
  }
  function clear(){
    from = to = null; persist(); setErr('');
    const f = $('crFrom'), t = $('crTo'); if(f){ f.value = ''; f.max = ''; } if(t){ t.value = ''; t.min = ''; }
    panelOpen = false;
    const p = $('customRangePanel'); if(p) p.hidden = true;
    const tab = document.querySelector('#rangeTabs [data-range="custom"]'); if(tab) tab.classList.remove('open');
    if(App.getRange() === 'custom') App.setRange('today'); else afterRender();
  }
  /* App calls this whenever the range tab changes */
  function onRangeChange(r){
    if(r !== 'custom'){
      panelOpen = false;
      const p = $('customRangePanel'); if(p) p.hidden = true;
      const tab = document.querySelector('#rangeTabs [data-range="custom"]'); if(tab) tab.classList.remove('open');
    }
  }

  const STATUS = {
    completed:['Completed', 'ok'], pending:['Pending', 'warn'], rescheduled:['Rescheduled', 'info'], planned:['Planned', 'mute']
  };
  function rowHtml(r){
    const t = r.t, [label, cls] = STATUS[r.status];
    const bits = [`${esc(t.subject || 'General')}`];
    if(t.type) bits.push(esc(Utils.formatTaskTypes ? Utils.formatTaskTypes(t.type) : t.type));
    if(t.duration) bits.push(Utils.formatDuration(t.duration));
    let dates = `Scheduled ${esc(fmtShort(r.sched))}`;
    if(r.status === 'completed' && r.done) dates += ` · Completed ${esc(fmtShort(r.done))}${r.late ? ' <em>(late)</em>' : ''}`;
    else if(r.status === 'pending' && (t.carried || 0) > 0) dates += ` · carried ${t.carried} day${t.carried > 1 ? 's' : ''}`;
    else if(r.status === 'rescheduled') dates += ` · moved to ${esc(fmtShort(t.date))}`;
    if(t.rescheduled && r.status === 'completed') dates += ' · rescheduled earlier';
    return `<div class="dr-task ${r.status}">
      <span class="dr-dot"></span>
      <div class="dr-task-main"><div class="dr-task-title">${esc(t.title)}</div><div class="dr-task-meta">${bits.join(' · ')}</div><div class="dr-task-dates">${dates}</div></div>
      <span class="dr-badge ${cls}">${label}</span></div>`;
  }
  function renderSchedule(){
    const panel = $('rangeSchedulePanel'); if(!panel) return;
    if(!active()){ panel.hidden = true; return; }
    const st = taskStats();
    panel.hidden = false;
    const groups = {};
    st.rows.sort((a, b) => a.sched - b.sched).forEach(r => { const k = r.sched.toDateString(); (groups[k] = groups[k] || []).push(r); });
    panel.innerHTML = `
      <div class="panel-head"><div><p class="panel-title">Schedule · ${esc(fmt(from))} – ${esc(fmt(to))}</p>
        <p class="panel-sub">Tasks originally scheduled in this period</p></div></div>
      <div class="dr-summary">
        <span class="dr-badge ok">${st.done} completed</span><span class="dr-badge warn">${st.pending} pending</span>
        <span class="dr-badge info">${st.rescheduled} rescheduled</span>${st.planned ? `<span class="dr-badge mute">${st.planned} planned</span>` : ''}
        ${st.late ? `<span class="dr-badge mute">${st.late} done late</span>` : ''}</div>
      ${st.rows.length ? Object.keys(groups).map(k => `<div class="queue-date-heading">${esc(Utils.fmtDateLong(new Date(k)))}</div>${groups[k].map(rowHtml).join('')}`).join('')
        : '<div class="queue-empty"><div class="msg">No tasks were scheduled in this period</div></div>'}`;
  }
  function renderBanner(){
    const b = $('rangeBanner'); if(!b) return;
    const on = active() && typeof App !== 'undefined' && App.getRange() === 'custom';
    b.hidden = !on;
    if(on) b.innerHTML = `<span class="rb-ico">📅</span><span class="rb-text">Showing <b>${esc(fmt(from))}</b> – <b>${esc(fmt(to))}</b> <em>· ${dayCount()} day${dayCount() > 1 ? 's' : ''}</em></span>
      <button type="button" class="rb-btn" onclick="DashRange.openPanel(true)">Change</button><button type="button" class="rb-btn" onclick="DashRange.clear()">Clear</button>`;
  }
  function afterRender(){
    const custom = active() && App.getRange() === 'custom';
    renderBanner();
    if(custom) renderSchedule(); else { const p = $('rangeSchedulePanel'); if(p) p.hidden = true; }
    const sub = $('statTasksSub');
    if(sub){
      if(custom){
        const s = taskStats();
        sub.hidden = false;
        sub.textContent = s.total ? [s.pending && `${s.pending} pending`, s.rescheduled && `${s.rescheduled} rescheduled`, s.late && `${s.late} done late`].filter(Boolean).join(' · ') || 'all completed' : 'none scheduled';
      } else sub.hidden = true;
    }
    const rv = $('statRevSub');
    if(rv){ rv.hidden = !custom; if(custom) rv.textContent = 'due in this period'; }
    const set = (id, txt) => { const e = $(id); if(e) e.textContent = txt; };
    set('waveTitle', custom ? 'Daily Performance' : 'Weekly Performance');
    set('monthTitle', custom ? (dayCount() > 31 ? 'Monthly Totals' : 'Weekly Totals') : 'Monthly Performance');
  }

  function init(){
    load();
    const f = $('crFrom'), t = $('crTo');
    if(!f) return;
    f.addEventListener('change', () => { syncMinMax(); setErr(''); });
    t.addEventListener('change', () => { syncMinMax(); setErr(''); });
    $('crApply').addEventListener('click', apply);
    $('crClear').addEventListener('click', clear);
    $('customRangePanel').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); apply(); } });
  }

  return { init, active, get, inRangeTs, inRangeDate, taskStats, revisionDue, chartOpts, openPanel, apply, clear, onRangeChange, afterRender };
})();
