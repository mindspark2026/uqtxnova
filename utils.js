/* =========================================================
   TaskxNova — utils.js
   Shared helpers: formatting, ids, escaping, toasts
   ========================================================= */

const Utils = (function(){

  function uid(){
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(s){
    if(s == null) return '';
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  const TASK_TYPES = ['Lecture', 'DPP', 'Revision', 'PYQ', 'HW'];

  /* Parses a task/entry `type` string (which may hold a single legacy value
     or several combined types) into a clean, deduped array. Handles:
       - new multi-select strings joined with ' • ' (canonical) or '+', ',', '/'
       - old single lowercase values ('lecture','dpp','hw','revision','pyq') per backward-compat spec
       - the older dropdown's merged "Homework (HW)" label -> 'HW' (legacy continuity)
       - a standalone old "Homework" value -> 'Homework' preserved as-is (option removed
         from the picker, but existing data isn't silently dropped)
       - unrecognized legacy labels are preserved as-is so existing data is never silently broken */
  function parseTaskTypes(typeStr){
    if(!typeStr) return [];
    const synonyms = { 'lecture':'Lecture', 'dpp':'DPP', 'revision':'Revision', 'pyq':'PYQ', 'hw':'HW', 'homework (hw)':'HW' };
    const parts = String(typeStr).split(/[•+,/]/).map(s => s.trim()).filter(Boolean);
    const out = [];
    parts.forEach(p => {
      const canon = synonyms[p.toLowerCase()] || p;
      if(!out.includes(canon)) out.push(canon);
    });
    return out;
  }

  /* Joins a types array back into the single stored string, canonical order. */
  function typesToString(typesArr){
    return (typesArr || []).filter(Boolean).join(' • ');
  }

  /* Compact display string for a task/entry `type` field, e.g. "Lecture • DPP". */
  function formatTaskTypes(typeStr){
    return parseTaskTypes(typeStr).join(' • ');
  }

  function daysBetween(a, b){
    const A = new Date(a); A.setHours(0,0,0,0);
    const B = new Date(b); B.setHours(0,0,0,0);
    return Math.round((B - A) / 86400000);
  }

  function fmtDate(ts){
    return new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric'});
  }

  function fmtDateLong(ts){
    return new Date(ts).toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric',year:'numeric'});
  }

  function fmtTime(ts){
    return new Date(ts).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
  }

  function sameDay(a, b){
    return new Date(a).toDateString() === new Date(b).toDateString();
  }

  function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }

  function pad2(n){ return String(n).padStart(2,'0'); }

  /* ---------------- Duration helpers ----------------
     Minutes are the canonical internal unit (hmToMinutes/minutesToHM/formatMinutes
     do the real work, each rounding exactly once). Entries/tasks persist an integer
     `durMin`/`durationMin` going forward — see App.normalizeDurations() for the
     one-time backfill that safely converts any pre-existing decimal-hour-only data.
     The decimal-hours wrappers below (hmToHours/hoursToHM/formatDuration) stay in
     place only so already-working hour-based call sites keep working unchanged. */
  function hmToMinutes(h, m){
    h = parseInt(h, 10); if(!Number.isFinite(h) || h < 0) h = 0;
    m = parseInt(m, 10); if(!Number.isFinite(m) || m < 0) m = 0;
    return h * 60 + m;
  }

  function minutesToHM(totalMin){
    totalMin = Math.max(0, Math.round(Number(totalMin) || 0));
    return { h: Math.floor(totalMin / 60), m: totalMin % 60 };
  }

  function formatMinutes(totalMin){
    totalMin = Math.max(0, Math.round(Number(totalMin) || 0));
    if(totalMin <= 0) return '0 min';
    const { h, m } = minutesToHM(totalMin);
    if(h && m) return `${h} hr ${m} min`;
    if(h) return `${h} hr`;
    return `${m} min`;
  }

  function hmToHours(h, m){ return hmToMinutes(h, m) / 60; }

  function hoursToHM(hoursDecimal){ return minutesToHM((Number(hoursDecimal) || 0) * 60); }

  function formatDuration(hoursDecimal){ return formatMinutes((Number(hoursDecimal) || 0) * 60); }

  function greeting(){
    const h = new Date().getHours();
    if(h < 5) return 'Still up?';
    if(h < 12) return 'Good morning';
    if(h < 17) return 'Good afternoon';
    if(h < 21) return 'Good evening';
    return 'Working late';
  }

  const QUOTES = [
    "Discipline is choosing between what you want now and what you want most.",
    "Small daily improvements lead to staggering long-term results.",
    "The expert in anything was once a beginner.",
    "Consistency beats intensity over time.",
    "Focus on progress, not perfection.",
    "Revision today is the exam score tomorrow.",
    "You don't have to be great to start, but you have to start to be great.",
    "Hard work beats talent when talent doesn't work hard.",
    "One more chapter. One more revision. One step closer.",
    "Success is the sum of small efforts repeated daily."
  ];
  function dailyQuote(){
    const day = Math.floor(Date.now() / 86400000);
    return QUOTES[day % QUOTES.length];
  }

  function animateCounter(el, to, opts){
    opts = opts || {};
    const decimals = opts.decimals || 0;
    const suffix = opts.suffix || '';
    const format = opts.format; // optional (val) => string, overrides decimals/suffix
    const dur = opts.dur || 700;
    const from = 0;
    const start = performance.now();
    function step(now){
      const p = Utils.clamp((now - start) / dur, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = from + (to - from) * eased;
      el.textContent = format ? format(val) : (val.toFixed(decimals) + suffix);
      if(p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function toast(msg, type){
    type = type || 'info';
    const stack = document.getElementById('toastStack');
    if(!stack) return;
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    const icons = {
      success: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#34D399" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>',
      error: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#F87171" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
      info: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7C5CFF" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>'
    };
    el.innerHTML = (icons[type]||icons.info) + '<span>' + escapeHtml(msg) + '</span>';
    stack.appendChild(el);
    setTimeout(() => { el.style.transition='opacity .25s ease, transform .25s ease'; el.style.opacity='0'; el.style.transform='translateY(6px)'; setTimeout(()=>el.remove(), 260); }, 3400);
  }

  function debounce(fn, wait){
    let t;
    return function(...args){ clearTimeout(t); t = setTimeout(()=>fn.apply(this,args), wait); };
  }

  /* ---------------- Global click animation / light effect ---------------- */
  const CLICK_EFFECT_SELECTOR = [
    'button', '.pill-btn', '.btn-submit', '.icon-btn', '.stat-card', '.task-check',
    '.accent-dot', '.switch', '.page-tab', '.range-tabs button', '.fab', '.q-del',
    '.q-tab', '.who', '.signin-btn', '.badge', '.syl-subject-tabs button', '[onclick]'
  ].join(', ');

  function spawnClickRipple(x, y){
    const ripple = document.createElement('div');
    ripple.className = 'click-ripple';
    const size = 240;
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    ripple.style.width = size + 'px';
    ripple.style.height = size + 'px';
    document.body.appendChild(ripple);
    const cleanup = () => ripple.remove();
    ripple.addEventListener('animationend', cleanup);
    setTimeout(cleanup, 700);
  }

  function attachGlobalClickEffects(){
    document.addEventListener('click', function(e){
      const target = e.target.closest(CLICK_EFFECT_SELECTOR);
      if(!target || target.disabled) return;

      let x = e.clientX, y = e.clientY;
      if(!x && !y){
        const r = target.getBoundingClientRect();
        x = r.left + r.width / 2;
        y = r.top + r.height / 2;
      }
      spawnClickRipple(x, y);

      target.classList.remove('click-glow');
      void target.offsetWidth; // restart animation
      target.classList.add('click-glow');
      const clear = () => target.classList.remove('click-glow');
      target.addEventListener('animationend', clear, { once:true });
      setTimeout(clear, 700);
    }, true);
  }

  /* ---------------- Invalid-input shake ---------------- */
  function shakeElement(el){
    if(!el) return;
    el.classList.remove('shake-invalid');
    void el.offsetWidth; // restart animation
    el.classList.add('shake-invalid');
    setTimeout(() => el.classList.remove('shake-invalid'), 500);
  }

  /* ---------------- Button success flash ---------------- */
  function showButtonSuccess(btn, successHtml, duration){
    if(!btn) return;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('btn-flash-success');
    btn.innerHTML = successHtml;
    setTimeout(() => {
      btn.disabled = false;
      btn.classList.remove('btn-flash-success');
      btn.innerHTML = original;
    }, duration || 1100);
  }

  /* ---------------- Panel 3D tilt-on-hover ---------------- */
  function attachTiltEffect(){
    if(!window.matchMedia || !window.matchMedia('(hover: hover)').matches) return; // skip touch devices
    let activeEl = null;
    function reset(){ if(activeEl){ activeEl.style.transform=''; activeEl=null; } }
    document.addEventListener('mousemove', function(e){
      const panel = e.target.closest('.panel');
      if(!panel){ reset(); return; }
      if(panel !== activeEl){ reset(); activeEl = panel; }
      const r = panel.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width/2) / 60;
      const y = -(e.clientY - r.top - r.height/2) / 60;
      panel.style.transform = `perspective(1000px) rotateY(${x}deg) rotateX(${y}deg) translateY(-2px)`;
    });
    document.addEventListener('mouseleave', reset, true);
  }

  return { uid, escapeHtml, daysBetween, fmtDate, fmtDateLong, fmtTime, sameDay, clamp, pad2, greeting, dailyQuote, animateCounter, toast, debounce, attachGlobalClickEffects, shakeElement, showButtonSuccess, attachTiltEffect, hmToMinutes, minutesToHM, formatMinutes, hmToHours, hoursToHM, formatDuration, TASK_TYPES, parseTaskTypes, typesToString, formatTaskTypes };
})();
