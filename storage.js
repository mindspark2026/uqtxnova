/* =========================================================
   TaskxNova — storage.js
   localStorage-first persistence with optional Firestore sync.
   Every collection is auto-saved locally instantly; when a user
   is signed in, changes are queued and pushed to Firestore too.
   ========================================================= */

const Storage = (function(){

  const PREFIX = 'taskxnova_';
  const OLD_PREFIX = 'tasknova_'; // pre-rebrand prefix — migrated once below
  const KEYS = [
    'entries','topics','chapters','tasks','notes','goals',
    'gamification','settings','pomodoroLog','reminders'
  ];

  (function migrateOldPrefix(){
    try{
      if(localStorage.getItem(PREFIX + '__migrated')) return;
      KEYS.forEach(k => {
        const old = localStorage.getItem(OLD_PREFIX + k);
        if(old !== null && localStorage.getItem(PREFIX + k) === null){
          localStorage.setItem(PREFIX + k, old);
        }
      });
      localStorage.setItem(PREFIX + '__migrated', '1');
    }catch(e){ /* ignore — nothing to migrate */ }
  })();

  let dirtyKeys = new Set();
  let syncTimer = null;

  function get(key, fallback){
    try{
      const raw = localStorage.getItem(PREFIX + key);
      if(raw === null) return fallback;
      const parsed = JSON.parse(raw);
      return (parsed === null || parsed === undefined) ? fallback : parsed;
    }catch(e){
      console.warn('Storage.get failed for', key, e);
      return fallback;
    }
  }

  function set(key, value){
    try{
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    }catch(e){
      console.warn('Storage.set failed for', key, e);
    }
    queueSync(key, value);
  }

  function queueSync(key, value){
    if(!KEYS.includes(key)) return;
    dirtyKeys.add(key);
    clearTimeout(syncTimer);
    syncTimer = setTimeout(flushSync, 900);
  }

  function flushSync(){
    if(typeof CloudSync === 'undefined' || !CloudSync.isSignedIn()) return;
    if(dirtyKeys.size === 0) return;
    const payload = {};
    dirtyKeys.forEach(k => { payload[k] = get(k, null); });
    dirtyKeys.clear();
    CloudSync.pushAll(payload);
  }

  function exportJSON(){
    const data = {};
    KEYS.forEach(k => data[k] = get(k, null));
    data.exportedAt = Date.now();
    data.app = 'UQTxNova';
    return JSON.stringify(data, null, 2);
  }

  function importJSON(jsonStr){
    let data;
    try{ data = JSON.parse(jsonStr); }
    catch(e){ throw new Error('Invalid JSON file'); }
    KEYS.forEach(k => {
      if(data[k] !== undefined && data[k] !== null){
        set(k, data[k]);
      }
    });
    return true;
  }

  function downloadBackup(){
    const blob = new Blob([exportJSON()], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `taskxnova-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function hasAnyGuestData(){
    return KEYS.some(k => {
      const v = get(k, null);
      if(Array.isArray(v)) return v.length > 0;
      if(v && typeof v === 'object') return Object.keys(v).length > 0;
      return false;
    });
  }

  function replaceAll(dataObj){
    KEYS.forEach(k => {
      if(dataObj[k] === undefined || dataObj[k] === null) return;
      try{ localStorage.setItem(PREFIX + k, JSON.stringify(dataObj[k])); }catch(e){}
    });
  }

  return { PREFIX, KEYS, get, set, exportJSON, importJSON, downloadBackup, hasAnyGuestData, replaceAll, flushSync };
})();
