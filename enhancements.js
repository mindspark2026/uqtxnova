/* =========================================================
   UQTxNova — enhancements.js
   1. ChapterAutocomplete — suggests chapters from the existing
      syllabus (Storage 'chapters') while typing in a Description
      field. "+ Custom" keeps the typed text as a one-off value;
      nothing is ever written back to the syllabus.
   2. Stopwatch — separate from Pomodoro, timestamp-based so it
      stays accurate even when the tab is throttled.
   3. Timer mode switch (Pomodoro / Stopwatch).
   ========================================================= */

const ChapterAutocomplete = (function(){
  const MAX_RESULTS = 8;
  // Description input -> its Subject <select>, so picking a chapter also sets the subject.
  const FIELDS = {
    todayTitle: 'todaySubject',
    editTitle: 'editSubject',
    editEntryDesc: 'editEntrySubject'
  };

  function allChapters(){
    const data = Storage.get('chapters', {}) || {};
    const out = [];
    Object.keys(data).forEach(subject => {
      (data[subject] || []).forEach(c => { if(c && c.name) out.push({ name: c.name, subject }); });
    });
    return out;
  }

  function search(query){
    const q = query.toLowerCase();
    const byName = [], bySubject = [];
    allChapters().forEach(c => {
      if(c.name.toLowerCase().includes(q)) byName.push(c);
      else if(c.subject.toLowerCase().includes(q)) bySubject.push(c);
    });
    return byName.concat(bySubject).slice(0, MAX_RESULTS);
  }

  function attach(inputId, subjectId){
    const input = document.getElementById(inputId);
    if(!input) return;
    const host = input.parentElement;
    host.classList.add('ac-host');

    const list = document.createElement('ul');
    list.className = 'ac-list';
    list.id = inputId + 'AcList';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    host.appendChild(list);

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', list.id);
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('autocomplete', 'off');

    let items = [], active = -1;

    function close(){
      list.hidden = true;
      active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function setActive(i){
      active = i;
      Array.from(list.children).forEach((li, idx) => {
        li.classList.toggle('active', idx === i);
        li.setAttribute('aria-selected', idx === i ? 'true' : 'false');
      });
      if(i >= 0){
        input.setAttribute('aria-activedescendant', list.children[i].id);
        list.children[i].scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function pick(i){
      const it = items[i];
      if(!it) return;
      if(!it.custom){
        input.value = it.name;
        const sel = document.getElementById(subjectId);
        if(sel && Array.from(sel.options).some(o => o.value === it.subject)) sel.value = it.subject;
      }
      // Custom: keep whatever was typed, only for this task.
      close();
      input.focus();
    }

    function render(){
      const raw = input.value.trim();
      if(!raw){ close(); return; }
      items = search(raw);
      items.push({ custom: true, text: raw });
      list.textContent = '';
      items.forEach((it, i) => {
        const li = document.createElement('li');
        li.id = list.id + '-' + i;
        li.className = 'ac-item' + (it.custom ? ' ac-custom' : '');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        const main = document.createElement('span');
        const sub = document.createElement('span');
        sub.className = 'ac-sub';
        if(it.custom){ main.textContent = '+ Custom'; sub.textContent = it.text; }
        else { main.textContent = it.name; sub.textContent = it.subject; }
        li.append(main, sub);
        // pointerdown + preventDefault: selects before the input blurs (works for touch too)
        li.addEventListener('pointerdown', ev => { ev.preventDefault(); pick(i); });
        list.appendChild(li);
      });
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      active = -1;
    }

    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('blur', close);
    input.addEventListener('keydown', ev => {
      if(list.hidden) return;
      if(ev.key === 'ArrowDown'){ ev.preventDefault(); setActive((active + 1) % items.length); }
      else if(ev.key === 'ArrowUp'){ ev.preventDefault(); setActive((active - 1 + items.length) % items.length); }
      else if(ev.key === 'Enter' && active >= 0){ ev.preventDefault(); pick(active); }
      else if(ev.key === 'Escape'){ ev.stopPropagation(); close(); }
    });
  }

  function init(){ Object.keys(FIELDS).forEach(id => attach(id, FIELDS[id])); }
  return { init };
})();

const Stopwatch = (function(){
  let elapsed = 0;     // ms accumulated while paused
  let startedAt = 0;   // Date.now() of the current run, 0 when paused
  let timer = null;

  const $ = id => document.getElementById(id);
  const PLAY = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  const PAUSE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';

  function total(){ return elapsed + (startedAt ? Date.now() - startedAt : 0); }

  function format(ms){
    const s = Math.floor(ms / 1000);
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(Utils.pad2).join(':');
  }

  function paint(){
    const t = $('swTime');
    if(t) t.textContent = format(total());
  }

  function paintControls(){
    const running = !!startedAt;
    const label = running ? 'Pause' : (elapsed > 0 ? 'Resume' : 'Start');
    const btn = $('swToggle');
    if(btn){ btn.setAttribute('aria-label', label + ' stopwatch'); btn.title = label; }
    if($('swIcon')) $('swIcon').innerHTML = running ? PAUSE : PLAY;
    if($('swState')) $('swState').textContent = running ? 'Running' : (elapsed > 0 ? 'Paused' : 'Ready');
    if($('swReset')) $('swReset').disabled = !running && elapsed === 0;
  }

  function toggle(){
    if(startedAt){
      elapsed += Date.now() - startedAt;
      startedAt = 0;
      clearInterval(timer);
    } else {
      startedAt = Date.now();
      timer = setInterval(paint, 200);
    }
    paint();
    paintControls();
  }

  function reset(){
    clearInterval(timer);
    startedAt = 0;
    elapsed = 0;
    paint();
    paintControls();
  }

  function init(){ paint(); paintControls(); }
  return { toggle, reset, init };
})();

const TimerMode = (function(){
  function set(mode){
    const isStopwatch = mode === 'stopwatch';
    document.getElementById('pomodoroPanel').hidden = isStopwatch;
    document.getElementById('stopwatchPanel').hidden = !isStopwatch;
    document.querySelectorAll('#timerModeTabs button').forEach(b => {
      const on = b.dataset.timer === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
  return { set };
})();

ChapterAutocomplete.init();
Stopwatch.init();
(function(){
  const y = document.getElementById('footYear');
  if(y) y.textContent = new Date().getFullYear();
})();

/* ---- Look: color set + layout, saved in this browser ---- */
const Look = (function(){
  const KEY = 'uqx_look';
  let st = { palette:'verdant', layout:'side' };
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch(e){}
  function apply(){
    const r = document.documentElement;
    r.setAttribute('data-palette', st.palette);
    r.setAttribute('data-layout', st.layout);
    document.querySelectorAll('[data-palette].look-card').forEach(b => b.classList.toggle('active', b.dataset.palette === st.palette));
    document.querySelectorAll('[data-layout].look-card').forEach(b => b.classList.toggle('active', b.dataset.layout === st.layout));
  }
  function save(){ try { localStorage.setItem(KEY, JSON.stringify(st)); } catch(e){} }
  function rerender(){ try { if(typeof App !== 'undefined' && App.render) App.render(); } catch(e){} }
  function setPalette(p){ st.palette = p; save(); apply(); rerender(); }
  function setLayout(l){ st.layout = l; save(); apply(); }
  document.addEventListener('DOMContentLoaded', apply);
  if(document.readyState !== 'loading') apply();
  return { setPalette, setLayout };
})();

/* ---- ShareProgress: card image + text for ANY day, built from real data ---- */
const ShareProgress = (function(){
  const MAX_ROWS = 8;
  function dayData(date){
    const day = date ? new Date(date) : new Date();
    const allEntries = Storage.get('entries', []) || [];
    const entries = allEntries.filter(e => e.completed !== false && Utils.sameDay(new Date(e.ts), day));
    const tasks = (Storage.get('tasks', []) || []).filter(t => t.date && Utils.sameDay(new Date(t.date), day));
    const done = tasks.filter(t => t.done);
    // Completed items: logged sessions + done tasks that have no logged session of their own.
    const items = entries.map(e => ({ title:e.desc || 'Untitled', subject:e.cat || '', type:e.type || '', hours:Number(e.dur) || 0, problems:Number(e.prob) || 0, ts:e.ts }));
    done.forEach(t => {
      const linked = allEntries.some(e => (e.taskId && e.taskId === t.id) || (t.entryTs && e.ts === t.entryTs));
      if(!linked) items.push({ title:t.title || 'Untitled', subject:t.subject || '', type:t.type || '', hours:Number(t.duration) || 0, problems:Number(t.problems) || 0, ts:new Date(t.date).getTime() });
    });
    items.sort((a,b) => a.ts - b.ts);
    const hours = items.reduce((s,it) => s + it.hours, 0);
    const problems = items.reduce((s,it) => s + it.problems, 0);
    const focus = hours > 0 ? Math.min(100, Math.round((problems / (hours * 4)) * 100)) : 0;
    const bySub = {};
    items.forEach(it => { const k = it.subject || 'Other'; bySub[k] = (bySub[k] || 0) + it.hours; });
    const subjects = Object.entries(bySub).sort((a,b) => b[1] - a[1]).slice(0, 3);
    let streak = 0;
    const isToday = Utils.sameDay(day, new Date());
    try { if(isToday) streak = (typeof Gamification !== 'undefined' && Gamification.state && Gamification.state.streak) || 0; } catch(e){}
    return { day, isToday, hours, problems, done:done.length, total:tasks.length, focus, subjects, streak, items, empty:!items.length };
  }
  const typeText = t => { try { return Utils.parseTaskTypes(t).join(', '); } catch(e){ return String(t || ''); } };
  function metaOf(it){
    return [it.subject, typeText(it.type), it.hours ? Utils.formatDuration(it.hours) : '', it.problems ? `${it.problems} problems` : ''].filter(Boolean).join(' • ');
  }
  function labelOf(d){
    const y = new Date(); y.setDate(y.getDate() - 1);
    return d.isToday ? "Today's" : (Utils.sameDay(d.day, y) ? "Yesterday's" : 'Daily');
  }
  function textOf(d){
    const date = d.day.toLocaleDateString(undefined, { weekday:'long', day:'numeric', month:'short', year:'numeric' });
    const lines = [`My UQTxNova progress — ${date}`, '',
      `Study time: ${Utils.formatDuration(d.hours)}`, `Problems solved: ${d.problems}`, `Tasks done: ${d.done}/${d.total}`];
    if(d.streak) lines.push(`Streak: ${d.streak} day${d.streak > 1 ? 's' : ''}`);
    if(d.items.length){
      lines.push('', 'Completed:');
      d.items.slice(0, 12).forEach(it => lines.push(`✓ ${it.title} (${metaOf(it)})`));
      if(d.items.length > 12) lines.push(`+${d.items.length - 12} more`);
    }
    lines.push('', 'Plan. Focus. Achieve.');
    return lines.join('\n');
  }
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function rr(c, x, y, w, h, r){ c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }
  function fit(c, str, maxW){ if(c.measureText(str).width <= maxW) return str; while(str.length > 1 && c.measureText(str + '…').width > maxW) str = str.slice(0, -1); return str + '…'; }
  function loadLogo(){ return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = 'logo-mark.png'; }); }

  async function draw(d){
    const W = 1080;
    const rows = Math.min(d.items.length, MAX_ROWS), more = d.items.length - rows;
    const subjY = 920, subjH = d.subjects.length ? 40 + d.subjects.length * 70 : 0;
    const listY = subjY + subjH + (d.subjects.length ? 20 : 0);
    const listH = rows ? 50 + rows * 96 + (more > 0 ? 50 : 0) : 0;
    const H = Math.max(1350, listY + listH + 140);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    const bg = css('--bg-0') || '#07100F', p1 = css('--primary') || '#14B8A6', p2 = css('--primary-2') || '#2DD4BF', p3 = css('--primary-3') || '#A3E635';
    const txt = css('--text') || '#ECF8F4', dim = css('--text-dim') || '#8FB0A8', onA = css('--on-accent') || '#06201B';
    const font = "'Sora','DM Sans',system-ui,sans-serif";
    c.fillStyle = bg; c.fillRect(0,0,W,H);
    const g = c.createRadialGradient(W, 0, 50, W, 0, 900); g.addColorStop(0, p3 + '55'); g.addColorStop(1, 'transparent');
    c.fillStyle = g; c.fillRect(0,0,W,H);
    c.strokeStyle = light ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.04)'; c.lineWidth = 1;
    for(let x = 0; x < W; x += 54){ c.beginPath(); c.moveTo(x,0); c.lineTo(x,H); c.stroke(); }
    for(let y = 0; y < H; y += 54){ c.beginPath(); c.moveTo(0,y); c.lineTo(W,y); c.stroke(); }
    const logo = await loadLogo();
    if(logo) c.drawImage(logo, 70, 70, 64, 64);
    c.fillStyle = txt; c.font = `700 40px ${font}`; c.textBaseline = 'middle'; c.fillText('UQTx', 150, 103);
    const w1 = c.measureText('UQTx').width; c.fillStyle = p2; c.fillText('Nova', 150 + w1, 103);
    c.textAlign = 'right'; c.fillStyle = dim; c.font = `500 28px ${font}`;
    c.fillText(d.day.toLocaleDateString(undefined, { weekday:'short', day:'numeric', month:'short', year:'numeric' }), W - 70, 103);
    c.textAlign = 'left';
    c.fillStyle = txt; c.font = `800 84px ${font}`; c.fillText(labelOf(d), 70, 260); c.fillStyle = p2; c.fillText('progress', 70, 355);
    const tiles = [['STUDY TIME', Utils.formatDuration(d.hours), p2], ['PROBLEMS', String(d.problems), '#38BDF8'], ['TASKS DONE', `${d.done}/${d.total}`, '#4ADE80'], ['FOCUS', `${d.focus}%`, '#FBBF24']];
    tiles.forEach((t, i) => {
      const x = 70 + (i % 2) * 485, y = 430 + Math.floor(i / 2) * 230, w = 455, h = 200;
      rr(c, x, y, w, h, 14); c.fillStyle = light ? 'rgba(255,255,255,.8)' : 'rgba(255,255,255,.06)'; c.fill();
      c.strokeStyle = light ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.12)'; c.stroke();
      c.fillStyle = t[2]; c.fillRect(x, y + 16, 7, h - 32);
      c.fillStyle = dim; c.font = `700 24px ${font}`; c.fillText(t[0], x + 36, y + 56);
      let fs = 72; c.font = `800 ${fs}px ${font}`; while(c.measureText(t[1]).width > w - 70 && fs > 30){ fs -= 2; c.font = `800 ${fs}px ${font}`; }
      c.fillStyle = txt; c.fillText(t[1], x + 36, y + 134);
    });
    let y = subjY;
    if(d.subjects.length){
      c.fillStyle = dim; c.font = `700 24px ${font}`; c.fillText('BY SUBJECT', 70, y); y += 40;
      const max = d.subjects[0][1] || 1;
      d.subjects.forEach(([name, hrs]) => {
        c.fillStyle = txt; c.font = `600 28px ${font}`; c.fillText(name, 70, y + 18);
        const bx = 300, bw = 470;
        rr(c, bx, y, bw, 36, 8); c.fillStyle = light ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.08)'; c.fill();
        const fw = Math.max(16, bw * (hrs / max)); rr(c, bx, y, fw, 36, 8);
        const lg = c.createLinearGradient(bx, 0, bx + bw, 0); lg.addColorStop(0, p1); lg.addColorStop(1, p3); c.fillStyle = lg; c.fill();
        c.fillStyle = dim; c.font = `600 26px ${font}`; c.textAlign = 'right'; c.fillText(Utils.formatDuration(hrs), W - 70, y + 18); c.textAlign = 'left';
        y += 70;
      });
    }
    if(rows){
      y = listY;
      c.fillStyle = dim; c.font = `700 24px ${font}`; c.fillText(`COMPLETED  (${d.items.length})`, 70, y); y += 34;
      d.items.slice(0, rows).forEach(it => {
        rr(c, 70, y, 940, 84, 10); c.fillStyle = light ? 'rgba(255,255,255,.8)' : 'rgba(255,255,255,.05)'; c.fill();
        c.beginPath(); c.arc(112, y + 42, 17, 0, Math.PI * 2); c.fillStyle = p3; c.fill();
        c.strokeStyle = onA; c.lineWidth = 4; c.lineCap = 'round'; c.lineJoin = 'round';
        c.beginPath(); c.moveTo(104, y + 42); c.lineTo(110, y + 49); c.lineTo(121, y + 35); c.stroke(); c.lineWidth = 1;
        c.fillStyle = txt; c.font = `700 29px ${font}`; c.fillText(fit(c, it.title, 850), 150, y + 31);
        c.fillStyle = dim; c.font = `500 23px ${font}`; c.fillText(fit(c, metaOf(it), 850), 150, y + 62);
        y += 96;
      });
      if(more > 0){ c.fillStyle = dim; c.font = `600 24px ${font}`; c.fillText(`+ ${more} more`, 70, y + 12); }
    }
    const fy = H - 70;
    if(d.streak){
      rr(c, 70, fy - 32, 330, 64, 32); c.fillStyle = p3; c.fill();
      c.fillStyle = onA; c.font = `700 28px ${font}`; c.fillText(`${d.streak}-day streak`, 100, fy);
    }
    c.fillStyle = dim; c.font = `500 28px ${font}`; c.textAlign = 'right'; c.fillText('Plan. Focus. Achieve.', W - 70, fy); c.textAlign = 'left';
    c.fillStyle = p1; c.fillRect(0, H - 14, W, 14);
    return cv;
  }

  const blobOf = cv => new Promise(res => cv.toBlob(res, 'image/png'));
  function download(blob, d){
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    const k = d.day; a.download = `uqtxnova-progress-${k.getFullYear()}-${Utils.pad2(k.getMonth()+1)}-${Utils.pad2(k.getDate())}.png`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  async function copy(text){
    try { await navigator.clipboard.writeText(text); Utils.toast('Copied to clipboard', 'success'); }
    catch(e){ const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try{ document.execCommand('copy'); Utils.toast('Copied to clipboard', 'success'); }catch(_){ Utils.toast('Could not copy', 'error'); } t.remove(); }
  }

  async function open(date){
    const d = dayData(date);
    if(d.empty){ Utils.toast(d.isToday ? 'Log a session or finish a task first — nothing to share yet' : 'Nothing completed on this day — nothing to share', 'info'); return; }
    const cv = await draw(d), blob = await blobOf(cv), text = textOf(d);
    const file = new File([blob], 'uqtxnova-progress.png', { type:'image/png' });
    const canShareFile = !!(navigator.canShare && navigator.canShare({ files:[file] }));
    const ov = document.createElement('div'); ov.className = 'modal-overlay open';
    ov.innerHTML = `<div class="modal share-modal" role="dialog" aria-modal="true" aria-label="Share progress">
      <h3>Share ${d.isToday ? "today's" : 'this day\'s'} progress</h3><img class="share-preview" alt="Progress card preview" src="${cv.toDataURL('image/png')}">
      <div class="share-actions">
        ${navigator.share ? '<button type="button" class="primary" data-a="share">Share…</button>' : ''}
        <button type="button" data-a="download">Download image</button>
        <button type="button" data-a="copy">Copy text</button>
        <a target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">WhatsApp</a>
        <a target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(location.origin && location.origin !== 'null' ? location.origin : 'https://uqtxnova.web.app')}&text=${encodeURIComponent(text)}">Telegram</a>
      </div><button type="button" class="share-close" data-a="close">Close</button></div>`;
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if(e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', async e => {
      if(e.target === ov) return close();
      const a = e.target.closest('[data-a]'); if(!a) return;
      const k = a.dataset.a;
      if(k === 'close') close();
      else if(k === 'download') download(blob, d);
      else if(k === 'copy') copy(text);
      else if(k === 'share'){
        try { await navigator.share(canShareFile ? { files:[file], text } : { text }); }
        catch(err){ if(err && err.name !== 'AbortError') Utils.toast('Sharing failed — try Download', 'error'); }
      }
    });
    document.body.appendChild(ov);
    const first = ov.querySelector('button'); if(first) first.focus();
  }
  return { open, dayData, textOf };
})();

/* ---- SubjectChips: P / C / M / G block that drives the existing Subject <select>s ---- */
const SubjectChips = (function(){
  const SUBJ = [['P','Physics','#FBBF24'],['C','Chemistry','#60A5FA'],['M','Maths','#A78BFA'],['G','General','#34D399']];
  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  function build(sel){
    if(!sel || sel.dataset.chips) return;
    sel.dataset.chips = '1';
    const row = document.createElement('div');
    row.className = 'subj-chips'; row.setAttribute('role', 'radiogroup'); row.setAttribute('aria-label', 'Subject');
    SUBJ.forEach(([k, name, col]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'subj-chip'; b.dataset.subject = name; b.style.setProperty('--chip', col);
      b.setAttribute('role', 'radio'); b.title = name; b.setAttribute('aria-label', name);
      b.innerHTML = `<b>${k}</b><span>${name}</span>`;
      b.addEventListener('click', () => { sel.value = name; sel.dispatchEvent(new Event('change', { bubbles:true })); });
      row.appendChild(b);
    });
    sel.style.display = 'none';
    const fld = sel.closest('.field'); if(fld){ fld.classList.add('has-chips'); if(fld.parentElement) fld.parentElement.classList.add('chips-row'); }
    sel.insertAdjacentElement('afterend', row);
    const sync = () => row.querySelectorAll('.subj-chip').forEach(b => {
      const on = b.dataset.subject === desc.get.call(sel); b.classList.toggle('active', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    // chips follow programmatic changes too (edit modals, autocomplete, form reset)
    Object.defineProperty(sel, 'value', { configurable:true, get(){ return desc.get.call(this); }, set(v){ desc.set.call(this, v); sync(); } });
    sel.addEventListener('change', sync);
    if(sel.form) sel.form.addEventListener('reset', () => setTimeout(sync, 0));
    sync();
  }
  function init(){ ['todaySubject','editSubject','editEntrySubject'].forEach(id => build(document.getElementById(id))); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  return { init };
})();

/* ---- Deep links: ./?page=calendar (used by the installed app's shortcuts) ---- */
(function(){
  const ok = ['dashboard','calendar','revision','syllabus','pomodoro','notes','goals','gamification','settings'];
  function go(){
    try {
      const p = new URLSearchParams(location.search).get('page');
      if(p && ok.includes(p) && typeof App !== 'undefined' && App.setPage) App.setPage(p);
    } catch(e){}
  }
  window.addEventListener('load', () => setTimeout(go, 400));
})();
