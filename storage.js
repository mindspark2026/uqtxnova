/* =========================================================
   TaskxNova — storage.js
   localStorage-first persistence with optional Firestore sync.
   Every collection is auto-saved locally instantly; when a user
   is signed in, changes are queued and pushed to Firestore too.

   ---------------------------------------------------------
   Account isolation (namespaced local storage)
   ---------------------------------------------------------
   All local reads/writes go through an "active namespace":
     - No signed-in account (or an anonymous/guest session) →
       the original, unscoped keys (`taskxnova_tasks`, etc.) —
       exactly the same keys this app has always used.
     - A real signed-in account (email/password or Google) →
       its own isolated keys (`taskxnova_user_{uid}_tasks`, etc.),
       switched in the instant that account signs in, so one
       account can never read or write another account's local
       cache. auth.js calls Storage.setActiveNamespace(uid) at
       the very top of onSignedIn()/onSignedOut(), before any
       other Storage call runs.

   The pre-existing unscoped keys are never deleted or modified
   by any of this — they remain exactly where they were. If they
   hold real data from before this isolation existed, an
   authenticated account can explicitly *adopt* a copy of it into
   its own namespace via adoptLegacyData() (merged in, never a
   blind overwrite) — a one-time, opt-in action, gated so the
   same legacy data can only ever be claimed by one account.

   ---------------------------------------------------------
   Merge engine (for account-based cloud sync)
   ---------------------------------------------------------
   Every write also updates a small metadata record — per
   top-level key we keep a `top` (last-modified) timestamp, and
   for list-type keys a per-record `updatedAt` timestamp plus a
   tombstone map for deletions. None of this changes the shape
   of what Storage.get()/KEYS callers already read — it lives in
   its own localStorage entry (namespace prefix + '__meta') so
   every existing call site in app.js/*.js keeps working
   untouched.

   CloudSync (auth.js) uses Storage.mergeIncoming() to reconcile
   whatever is in the ACTIVE namespace with whatever is in
   Firestore for that same account: records are unioned by id (or
   ts for id-less logs), and any record that exists on both sides
   is resolved by whichever side has the newer updatedAt — never
   a blind replace. This makes migration/merge idempotent and
   safe to re-run (signing in again, opening a second tab, etc.
   can never duplicate or drop a record).
   ========================================================= */

const Storage = (function(){

  const PREFIX = 'taskxnova_';           // unscoped / guest namespace (unchanged, original keys)
  const NS_PREFIX = 'taskxnova_user_';   // per-account namespace prefix
  const OLD_PREFIX = 'tasknova_';        // pre-rebrand prefix — migrated once below, into the unscoped namespace only
  const KEYS = [
    'entries','topics','chapters','tasks','notes','goals',
    'gamification','settings','pomodoroLog','reminders'
  ];
  const LEGACY_ADOPTED_KEY = PREFIX + '__legacy_adopted';

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

  /* ---------------- active namespace ---------------- */

  let activeNamespace = null; // null => unscoped/guest; otherwise a sanitized uid

  function sanitizeNs(uid){
    return String(uid).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);
  }

  function activePrefix(){
    return activeNamespace ? (NS_PREFIX + activeNamespace + '_') : PREFIX;
  }

  function metaKeyFor(prefix){ return prefix + '__meta'; }

  // Called by auth.js the instant auth state resolves — BEFORE any other
  // Storage call — so a signed-in account only ever touches its own keys.
  // Pass a real uid for an authenticated (non-anonymous) account, or
  // null/undefined to fall back to the shared unscoped/guest namespace.
  function setActiveNamespace(uid){
    activeNamespace = uid ? sanitizeNs(uid) : null;
    // Any sync queued under the previous namespace must not be flushed
    // against the new one — drop it; the new namespace's own data (once
    // written) will queue its own sync normally.
    dirtyKeys.clear();
    clearTimeout(syncTimer);
  }

  function getActiveNamespace(){ return activeNamespace; }

  /* ---------------- record-key resolvers ----------------
     How to identify "the same record" inside each array-typed
     key, so merges union by identity instead of duplicating. */
  const RECORD_RESOLVERS = {
    tasks:     item => item && item.id,
    notes:     item => item && item.id,
    topics:    item => item && item.id,
    reminders: item => item && item.id,
    entries:     item => item && (item.taskId ? ('e:' + item.ts + ':' + item.taskId) : ('e:' + item.ts)),
    pomodoroLog: item => item && ('p:' + item.ts)
  };
  const NESTED_ARRAY_KEYS = ['chapters']; // { subject: [ {id,...}, ... ] }
  const SINGLETON_KEYS = ['goals', 'gamification', 'settings']; // one plain object, whole-object LWW

  function fallbackKey(item){
    // Defensive: a record with no usable identity is still kept
    // (never silently dropped) using a stable hash of its content.
    try{ return 'h:' + btoa(unescape(encodeURIComponent(JSON.stringify(item)))).slice(0, 48); }
    catch(e){ return 'h:' + Math.random().toString(36).slice(2); }
  }

  function indexBy(arr, resolver){
    const map = {};
    (arr || []).forEach(item => {
      const rk = resolver(item) || fallbackKey(item);
      map[rk] = item;
    });
    return map;
  }

  /* ---------------- meta store (scoped to the active namespace) ---------------- */

  function loadMeta(){
    try{
      const raw = localStorage.getItem(metaKeyFor(activePrefix()));
      return raw ? JSON.parse(raw) : {};
    }catch(e){ return {}; }
  }

  function saveMeta(meta){
    try{ localStorage.setItem(metaKeyFor(activePrefix()), JSON.stringify(meta)); }catch(e){}
  }

  function emptyKeyMeta(){ return { top: 0, records: {}, tombstones: {} }; }

  function getMeta(key){
    const meta = loadMeta();
    return meta[key] ? meta[key] : emptyKeyMeta();
  }

  function setMeta(key, keyMeta){
    const meta = loadMeta();
    meta[key] = keyMeta;
    saveMeta(meta);
  }

  /* Recompute the record/tombstone map for one key after a write,
     diffing against what was there a moment ago. Called from set(). */
  function touchMeta(key, oldValue, newValue){
    const now = Date.now();
    const keyMeta = getMeta(key);
    keyMeta.top = now;

    if(RECORD_RESOLVERS[key]){
      const resolver = RECORD_RESOLVERS[key];
      const oldById = indexBy(oldValue, resolver);
      const newIds = new Set();
      (newValue || []).forEach(item => {
        const rk = resolver(item) || fallbackKey(item);
        newIds.add(rk);
        const prev = oldById[rk];
        if(prev === undefined || JSON.stringify(prev) !== JSON.stringify(item)){
          keyMeta.records[rk] = now;
        } else if(keyMeta.records[rk] === undefined){
          keyMeta.records[rk] = now;
        }
        delete keyMeta.tombstones[rk];
      });
      Object.keys(oldById).forEach(rk => {
        if(!newIds.has(rk)){
          keyMeta.tombstones[rk] = now;
          delete keyMeta.records[rk];
        }
      });
    } else if(NESTED_ARRAY_KEYS.includes(key)){
      const oldObj = oldValue || {};
      const newObj = newValue || {};
      const subjects = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
      subjects.forEach(subj => {
        const oldById = indexBy(oldObj[subj], c => c && c.id);
        const newIds = new Set();
        (newObj[subj] || []).forEach(item => {
          const rk = subj + '::' + (item && item.id ? item.id : fallbackKey(item));
          newIds.add(rk);
          const prev = oldById[item && item.id];
          if(prev === undefined || JSON.stringify(prev) !== JSON.stringify(item)){
            keyMeta.records[rk] = now;
          } else if(keyMeta.records[rk] === undefined){
            keyMeta.records[rk] = now;
          }
          delete keyMeta.tombstones[rk];
        });
        Object.keys(oldById).forEach(id => {
          const rk = subj + '::' + id;
          if(!newIds.has(rk)){
            keyMeta.tombstones[rk] = now;
            delete keyMeta.records[rk];
          }
        });
      });
    }
    // singleton keys: only `top` matters, already stamped above.

    setMeta(key, keyMeta);
    return keyMeta;
  }

  /* ---------------- core get/set (scoped to the active namespace) ---------------- */

  function get(key, fallback){
    try{
      const raw = localStorage.getItem(activePrefix() + key);
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
      const oldValue = get(key, undefined);
      localStorage.setItem(activePrefix() + key, JSON.stringify(value));
      if(KEYS.includes(key)) touchMeta(key, oldValue, value);
    }catch(e){
      console.warn('Storage.set failed for', key, e);
    }
    queueSync(key, value);
  }

  let dirtyKeys = new Set();
  let syncTimer = null;

  function queueSync(key, value){
    if(!KEYS.includes(key)) return;
    dirtyKeys.add(key);
    clearTimeout(syncTimer);
    syncTimer = setTimeout(flushSync, 900);
  }

  function flushSync(){
    if(typeof CloudSync === 'undefined' || !CloudSync.isSignedIn()) return;
    if(dirtyKeys.size === 0) return;
    const payload = {}, metaPayload = {};
    dirtyKeys.forEach(k => { payload[k] = get(k, null); metaPayload[k] = getMeta(k); });
    dirtyKeys.clear();
    CloudSync.pushAll(payload, metaPayload);
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

  // Does the ACTIVE namespace currently hold any data? (Works for both the
  // guest namespace and any signed-in account's own namespace — whichever
  // is active right now. Kept for backward compatibility; nothing in the
  // sign-in flow uses this to decide what to migrate/push anymore — see
  // the namespace-isolation note at the top of this file.)
  function hasAnyGuestData(){
    return KEYS.some(k => {
      const v = get(k, null);
      if(Array.isArray(v)) return v.length > 0;
      if(v && typeof v === 'object') return Object.keys(v).length > 0;
      return false;
    });
  }

  // Kept for backward compatibility (e.g. restoring a downloaded backup);
  // scoped to the active namespace, same as get()/set().
  function replaceAll(dataObj){
    KEYS.forEach(k => {
      if(dataObj[k] === undefined || dataObj[k] === null) return;
      try{ localStorage.setItem(activePrefix() + k, JSON.stringify(dataObj[k])); }catch(e){}
    });
  }

  /* ---------------- snapshot (for pushing local state to the cloud) ---------------- */

  function snapshotAll(){
    const values = {}, meta = {};
    KEYS.forEach(k => { values[k] = get(k, null); meta[k] = getMeta(k); });
    return { values, meta };
  }

  /* ---------------- merge engine ---------------- */

  function mergeFlatArrayGeneric(localArr, localMeta, cloudArr, cloudMeta, resolver){
    const localById = indexBy(localArr, resolver);
    const cloudById = indexBy(cloudArr, resolver);
    const allKeys = new Set([...Object.keys(localById), ...Object.keys(cloudById)]);
    const resultById = {}, records = {}, tombstones = {};

    allKeys.forEach(rk => {
      const lItem = localById[rk], cItem = cloudById[rk];
      const lTs = (localMeta.records || {})[rk] || 0;
      const cTs = (cloudMeta.records || {})[rk] || 0;
      const lDel = (localMeta.tombstones || {})[rk];
      const cDel = (cloudMeta.tombstones || {})[rk];

      const events = [];
      if(lItem !== undefined) events.push({ t: lTs, type: 'keep', item: lItem });
      if(lDel !== undefined) events.push({ t: lDel, type: 'del' });
      if(cItem !== undefined) events.push({ t: cTs, type: 'keep', item: cItem });
      if(cDel !== undefined) events.push({ t: cDel, type: 'del' });
      if(!events.length) return;

      // Newest timestamp wins (deterministic conflict resolution).
      // Stable sort: on an exact tie, local wins (defensive default —
      // never favors silently dropping what's already on this device).
      events.sort((a, b) => b.t - a.t);
      const winner = events[0];
      if(winner.type === 'del'){
        tombstones[rk] = winner.t;
      } else {
        resultById[rk] = winner.item;
        records[rk] = winner.t;
      }
    });

    const seen = new Set();
    const value = [];
    (localArr || []).forEach(item => {
      const rk = resolver(item) || fallbackKey(item);
      if(resultById[rk] !== undefined && !seen.has(rk)){ value.push(resultById[rk]); seen.add(rk); }
    });
    (cloudArr || []).forEach(item => {
      const rk = resolver(item) || fallbackKey(item);
      if(resultById[rk] !== undefined && !seen.has(rk)){ value.push(resultById[rk]); seen.add(rk); }
    });

    const top = Math.max(localMeta.top || 0, cloudMeta.top || 0);
    return { value, meta: { top, records, tombstones } };
  }

  function mergeChapters(localObj, localMeta, cloudObj, cloudMeta){
    localObj = localObj || {}; cloudObj = cloudObj || {};
    const subjects = new Set([...Object.keys(localObj), ...Object.keys(cloudObj)]);
    const value = {}, records = {}, tombstones = {};
    subjects.forEach(subj => {
      const lArr = (localObj[subj] || []).map(c => Object.assign({}, c, { __rk: subj + '::' + c.id }));
      const cArr = (cloudObj[subj] || []).map(c => Object.assign({}, c, { __rk: subj + '::' + c.id }));
      const merged = mergeFlatArrayGeneric(lArr, localMeta, cArr, cloudMeta, item => item.__rk);
      value[subj] = merged.value.map(item => { const copy = Object.assign({}, item); delete copy.__rk; return copy; });
      Object.assign(records, merged.meta.records);
      Object.assign(tombstones, merged.meta.tombstones);
    });
    const top = Math.max(localMeta.top || 0, cloudMeta.top || 0);
    return { value, meta: { top, records, tombstones } };
  }

  function mergeSingleton(localVal, localMeta, cloudVal, cloudMeta){
    if(cloudVal === undefined || cloudVal === null) return { value: localVal, meta: localMeta };
    if(localVal === undefined || localVal === null) return { value: cloudVal, meta: cloudMeta };
    // Field-level union: the newer whole-object wins per field, the
    // older one fills in any field the newer object doesn't have.
    if((cloudMeta.top || 0) > (localMeta.top || 0)){
      return { value: Object.assign({}, localVal, cloudVal), meta: cloudMeta };
    }
    return { value: Object.assign({}, cloudVal, localVal), meta: localMeta };
  }

  function mergeKey(key, localVal, localMeta, cloudVal, cloudMeta){
    localMeta = localMeta || emptyKeyMeta();
    cloudMeta = cloudMeta || emptyKeyMeta();
    if(RECORD_RESOLVERS[key]){
      return mergeFlatArrayGeneric(localVal || [], localMeta, cloudVal || [], cloudMeta, RECORD_RESOLVERS[key]);
    }
    if(NESTED_ARRAY_KEYS.includes(key)){
      return mergeChapters(localVal, localMeta, cloudVal, cloudMeta);
    }
    return mergeSingleton(localVal, localMeta, cloudVal, cloudMeta);
  }

  /* Reconcile the ACTIVE namespace's local storage with a cloud snapshot
     ({values, meta} per key, as returned by CloudSync.pullAll() for the
     currently signed-in account). Writes the merged result back to that
     same namespace (never a raw overwrite — every record from both sides
     is preserved or resolved by timestamp) and returns the merged
     snapshot so the caller can push it back up to Firestore, keeping
     both sides converged. Safe to call repeatedly. */
  function mergeIncoming(cloudValues, cloudMetaMap){
    cloudValues = cloudValues || {};
    cloudMetaMap = cloudMetaMap || {};
    const prefix = activePrefix();
    const mergedValues = {}, mergedMeta = {};
    let anyChange = false;

    KEYS.forEach(key => {
      const localVal = get(key, null);
      const localMeta = getMeta(key);
      const cloudVal = cloudValues[key];
      const cloudMeta = cloudMetaMap[key];

      if(cloudVal === undefined){
        // Nothing on the cloud side yet for this key — keep local as-is.
        mergedValues[key] = localVal;
        mergedMeta[key] = localMeta;
        return;
      }

      const { value, meta } = mergeKey(key, localVal, localMeta, cloudVal, cloudMeta);
      mergedValues[key] = value;
      mergedMeta[key] = meta;

      if(JSON.stringify(value) !== JSON.stringify(localVal)) anyChange = true;

      // Write straight to localStorage (bypassing set()/touchMeta —
      // the merge already computed the correct meta for this result,
      // re-diffing it here would just re-stamp everything as "now").
      try{ localStorage.setItem(prefix + key, JSON.stringify(value)); }catch(e){}
    });

    saveMeta(Object.assign(loadMeta(), mergedMeta));
    return { values: mergedValues, meta: mergedMeta, changed: anyChange };
  }

  /* ---------------- legacy (pre-namespace) data adoption ----------------
     Before account isolation existed, ALL local data — guest or signed-in
     — lived in the unscoped `taskxnova_*` keys. That data is never
     touched automatically. An authenticated (non-anonymous) account can
     explicitly opt in to adopting a COPY of it into its own namespace;
     once any account has done so, it's marked claimed and never offered
     again — this is what stops it from silently attaching itself to
     every account that ever signs in on this browser. */

  function legacyHasData(){
    return KEYS.some(k => {
      try{
        const raw = localStorage.getItem(PREFIX + k);
        if(raw === null) return false;
        const v = JSON.parse(raw);
        if(Array.isArray(v)) return v.length > 0;
        if(v && typeof v === 'object') return Object.keys(v).length > 0;
        return false;
      }catch(e){ return false; }
    });
  }

  function getLegacyAdopter(){
    try{ return localStorage.getItem(LEGACY_ADOPTED_KEY); }catch(e){ return null; }
  }

  function hasUnclaimedLegacyData(){
    if(getLegacyAdopter()) return false; // already claimed by some account
    return legacyHasData();
  }

  // Explicit, user-confirmed only (never called automatically): copies
  // (never moves/deletes) the unscoped legacy data into `uid`'s own
  // namespace, MERGING it with whatever's already there — never a blind
  // overwrite — then permanently marks the legacy data as claimed. The
  // original unscoped keys are left completely untouched either way.
  function adoptLegacyData(uid){
    if(!uid) return { ok:false, reason:'no-uid' };
    if(!hasUnclaimedLegacyData()){
      return { ok:false, reason: getLegacyAdopter() ? 'already-claimed' : 'nothing-to-adopt' };
    }
    const targetPrefix = NS_PREFIX + sanitizeNs(uid) + '_';

    let existingMetaAll = {};
    try{
      const rm = localStorage.getItem(metaKeyFor(targetPrefix));
      existingMetaAll = rm ? JSON.parse(rm) : {};
    }catch(e){ existingMetaAll = {}; }

    let legacyMetaAll = {};
    try{
      const rm = localStorage.getItem(metaKeyFor(PREFIX));
      legacyMetaAll = rm ? JSON.parse(rm) : {};
    }catch(e){ legacyMetaAll = {}; }

    KEYS.forEach(k => {
      let legacyVal = null;
      try{
        const raw = localStorage.getItem(PREFIX + k);
        legacyVal = raw !== null ? JSON.parse(raw) : null;
      }catch(e){ legacyVal = null; }
      const legacyMeta = legacyMetaAll[k] || emptyKeyMeta();

      let existingVal = null;
      try{
        const raw = localStorage.getItem(targetPrefix + k);
        existingVal = raw !== null ? JSON.parse(raw) : null;
      }catch(e){ existingVal = null; }
      const existingMeta = existingMetaAll[k] || emptyKeyMeta();

      const { value, meta } = mergeKey(k, existingVal, existingMeta, legacyVal, legacyMeta);
      try{ localStorage.setItem(targetPrefix + k, JSON.stringify(value)); }catch(e){}
      existingMetaAll[k] = meta;
    });

    try{ localStorage.setItem(metaKeyFor(targetPrefix), JSON.stringify(existingMetaAll)); }catch(e){}

    // Permanently claim it. This — not deletion — is what prevents the
    // same legacy data from ever being offered to (or absorbed by)
    // another account. The unscoped keys above are never removed.
    try{ localStorage.setItem(LEGACY_ADOPTED_KEY, sanitizeNs(uid)); }catch(e){}

    return { ok:true };
  }

  return {
    PREFIX, KEYS, get, set, exportJSON, importJSON, downloadBackup,
    hasAnyGuestData, replaceAll, flushSync,
    getMeta, snapshotAll, mergeIncoming,
    setActiveNamespace, getActiveNamespace, activePrefix,
    hasUnclaimedLegacyData, getLegacyAdopter, adoptLegacyData
  };
})();

