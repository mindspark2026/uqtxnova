/* =========================================================
   TaskxNova — auth.js
   Guest mode by default. Email/Password + Google sign-in via
   Firebase Auth. CloudSync pushes/pulls the same collections
   storage.js manages, keyed under users/{uid}/data/{key}.

   Account isolation: the FIRST thing onSignedIn()/onSignedOut()
   do is call Storage.setActiveNamespace(...), switching every
   subsequent local read/write to that account's own isolated
   keys (or back to the shared guest keys on sign-out). This
   guarantees one signed-in account can never read, merge, or
   push another account's local data — see storage.js for the
   namespace implementation. Only a real (non-anonymous) account
   gets its own namespace; anonymous/guest sessions keep using
   the shared local keys they always have, since an anonymous
   Firebase identity isn't a portable "account" a person can
   deliberately sign back into elsewhere.

   Sync model: within one account's own namespace, local device
   data is never the "loser" by default. On sign-in (this device,
   or first load with a persisted session) that account's local
   data and its own cloud data are merged record-by-record using
   Storage.mergeIncoming() — the merged result is written back
   locally AND pushed back to Firestore, so both sides converge
   instead of one overwriting the other. This is safe to run
   unconditionally now (no "does local have data?" gate needed)
   precisely because namespace isolation already guarantees the
   local side genuinely belongs to this account.

   Legacy data: any local data saved before account isolation
   existed still lives in the original unscoped keys, untouched.
   That is handled separately and explicitly — see
   Storage.adoptLegacyData() / confirmLegacyAdoption() below —
   never automatically merged into any account.
   ========================================================= */

const CloudSync = (function(){
  let currentUser = null;
  let syncInFlight = false; // re-entrancy guard: never run two merges at once

  function isSignedIn(){ return !!currentUser; }
  function getUser(){ return currentUser; }

  function setSyncStatus(state){
    const pill = document.getElementById('syncPill');
    if(!pill) return;
    pill.classList.remove('offline','syncing');
    const label = pill.querySelector('.label');
    if(state === 'offline'){ pill.classList.add('offline'); if(label) label.textContent = 'Guest — local only'; }
    else if(state === 'syncing'){ pill.classList.add('syncing'); if(label) label.textContent = 'Syncing…'; }
    else { if(label) label.textContent = 'Synced'; }
  }

  async function pushAll(payload, metaPayload){
    if(!currentUser) return { ok:false, code:'not-signed-in', message:'No signed-in user.' };
    if(!FirebaseService.isReady()) return { ok:false, code:'firebase-not-ready', message: FirebaseService.getFailureReason() || 'Firebase is not initialized.' };
    setSyncStatus('syncing');
    const db = FirebaseService.getDb();
    const keys = Object.keys(payload).filter(k => payload[k] !== null && payload[k] !== undefined);
    try{
      const batch = db.batch();
      keys.forEach(key => {
        const ref = db.collection('users').doc(currentUser.uid).collection('data').doc(key);
        const doc = { value: JSON.stringify(payload[key]), updatedAt: Date.now() };
        if(metaPayload && metaPayload[key]) doc.meta = JSON.stringify(metaPayload[key]);
        batch.set(ref, doc);
      });
      await batch.commit();

      // Cloud verification: don't just trust that commit() didn't throw —
      // read one of the just-written documents back so a confirmed success
      // means the data is actually retrievable server-side, not merely that
      // the request was sent. (Firestore batch.commit() already only
      // resolves on a durable server ack, but this closes the loop for
      // anything that could still be misleading — e.g. an emulator/proxy
      // returning a false-positive locally.)
      if(keys.length){
        const checkKey = keys[0];
        const checkRef = db.collection('users').doc(currentUser.uid).collection('data').doc(checkKey);
        const checkSnap = await checkRef.get();
        if(!checkSnap.exists){
          const err = { code:'verification-failed', message:'Write appeared to succeed but could not be read back.' };
          console.error('[UQTxNova] Firestore write verification failed for key:', checkKey);
          setSyncStatus('offline');
          return { ok:false, code: err.code, message: err.message };
        }
      }

      // Record that this account has synced at least once, and when —
      // this is the durable, cloud-side "sync succeeded" marker (kept in
      // Firestore, not localStorage, so it's correct no matter which
      // device/browser checks it next). migratedAt is set once and kept;
      // lastSyncAt is refreshed on every successful push.
      try{
        const userRef = db.collection('users').doc(currentUser.uid);
        const userSnap = await userRef.get();
        const already = userSnap.exists && userSnap.data() && userSnap.data().migratedAt;
        const markerUpdate = { lastSyncAt: Date.now() };
        if(!already) markerUpdate.migratedAt = Date.now();
        await userRef.set(markerUpdate, { merge:true });
      }catch(markerErr){
        // Non-fatal: the actual data already landed and verified above;
        // failing to write this bookkeeping marker doesn't mean sync failed.
        console.warn('[UQTxNova] Could not write sync marker (data itself was still written):', markerErr && markerErr.code);
      }

      setSyncStatus('online');
      return { ok:true };
    }catch(e){
      // Never swallow this: log the real Firestore error code so it's
      // diagnosable from DevTools, and hand a structured result back to
      // the caller so it can decide what to tell the user — no caller may
      // treat a failed push as a success.
      console.error('[UQTxNova] Firestore write failed:', e && e.code, e && e.message, e);
      const code = (e && e.code) || 'unknown-error';
      if(currentUser && !currentUser.isAnonymous){
        Utils.toast(`Cloud sync failed (${code}) — changes saved locally, will retry`, 'error');
      }
      setSyncStatus('offline');
      return { ok:false, code, message: (e && e.message) || String(e) };
    }
  }

  async function pullAll(){
    if(!currentUser) return { values:{}, meta:{}, ok:false, code:'not-signed-in' };
    if(!FirebaseService.isReady()) return { values:{}, meta:{}, ok:false, code:'firebase-not-ready' };
    const db = FirebaseService.getDb();
    try{
      const snap = await db.collection('users').doc(currentUser.uid).collection('data').get();
      const values = {}, meta = {};
      snap.forEach(doc => {
        const d = doc.data();
        try{
          const parsed = JSON.parse(d.value);
          if(parsed !== null && parsed !== undefined) values[doc.id] = parsed;
        }catch(e){ return; }
        try{
          meta[doc.id] = d.meta ? JSON.parse(d.meta) : { top: d.updatedAt || 0, records: {}, tombstones: {} };
        }catch(e){
          meta[doc.id] = { top: d.updatedAt || 0, records: {}, tombstones: {} };
        }
      });
      return { values, meta, ok:true };
    }catch(e){
      console.error('[UQTxNova] Firestore read failed:', e && e.code, e && e.message, e);
      const code = (e && e.code) || 'unknown-error';
      if(currentUser && !currentUser.isAnonymous){
        Utils.toast(`Could not reach your cloud data (${code}) — showing local data only`, 'error');
      }
      return { values:{}, meta:{}, ok:false, code, message: (e && e.message) || String(e) };
    }
  }

  /* Merge whatever's in the cloud into local storage (never overwrites,
     only unions + resolves conflicts by updatedAt — see storage.js),
     then pushes the converged result back up so both sides match.
     Idempotent: calling this again with nothing new to reconcile is a
     no-op push of the same data, so re-entering sign-in, refreshing the
     page, or opening a second tab can never create duplicate records.
     Returns the push result so callers can tell a real success from a
     silently-failed one — never assume "no exception" means "synced". */
  async function reconcile(cloud){
    const result = Storage.mergeIncoming(cloud ? cloud.values : {}, cloud ? cloud.meta : {});
    if(typeof App !== 'undefined' && typeof App.reloadAll === 'function') App.reloadAll();
    // Push the merged snapshot back so Firestore has the same picture
    // this device now does (covers: first migration, catching up a
    // stale cloud copy, and re-converging after an offline edit).
    const snap = Storage.snapshotAll();
    const pushResult = await pushAll(snap.values, snap.meta);
    return Object.assign({}, result, { push: pushResult });
  }

  async function onSignedIn(user){
    currentUser = user;
    // CRITICAL: this must run before ANY other Storage call — it switches
    // every subsequent local read/write to this account's own isolated
    // keys, so this account can never see or touch another account's (or
    // a stale prior account's) local data. Anonymous/guest sessions keep
    // using the shared local keys, since they aren't a portable account.
    Storage.setActiveNamespace(user.isAnonymous ? null : user.uid);
    updateProfileUI(user);
    if(syncInFlight) return; // a sync for this session is already running
    syncInFlight = true;
    setSyncStatus('syncing');
    try{
      const cloud = await pullAll(); // always users/{this account's uid}/data/* — never any other account's
      if(!cloud.ok){
        // Could not read the cloud — do NOT treat that as "cloud is
        // empty" (that would risk wiping out a real merge decision).
        // This account's own namespaced local cache, if any, is left
        // exactly as-is and rendered as-is; nothing is merged or pushed.
        if(!user.isAnonymous) setSyncStatus('offline');
        if(typeof App !== 'undefined' && typeof App.reloadAll === 'function') App.reloadAll();
        syncInFlight = false;
        return;
      }

      // Merge THIS account's own namespaced local data with THIS
      // account's own cloud data — safe to run unconditionally (no
      // "does local have data?" gate) because namespace isolation
      // already guarantees the local side genuinely belongs to this
      // account; there is nothing foreign it could be mixing in.
      const cloudHasData = Object.values(cloud.values).some(v =>
        Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : false)
      );
      const result = await reconcile(cloud);
      if(result.push.ok){
        if(cloudHasData) Utils.toast('Synced with your account', 'success');
        setSyncStatus('online');
      } else {
        // Merge happened locally (safe either way — this account's own
        // data only) but the push-back failed — pushAll() already
        // surfaced the real error. Don't claim success.
        setSyncStatus('offline');
      }

      // Legacy (pre-isolation) local data is a completely separate,
      // always-explicit, opt-in flow — never merged automatically, and
      // never offered to an anonymous session or to more than one
      // account once someone has actually adopted it.
      if(!user.isAnonymous && Storage.hasUnclaimedLegacyData()){
        openLegacyAdoptPrompt();
      }
    }catch(e){
      console.error('[UQTxNova] Sign-in sync failed:', e && e.code, e && e.message, e);
      // Cloud step failed — local data (still fully intact, in this
      // account's own namespace) remains the active copy; sync will
      // retry on the next change or next sign-in.
      setSyncStatus('offline');
      if(typeof App !== 'undefined' && typeof App.reloadAll === 'function') App.reloadAll();
    }finally{
      syncInFlight = false;
    }
  }

  function onSignedOut(){
    currentUser = null;
    // Switch back to the shared guest namespace. The account that just
    // signed out is NOT touched — its data stays exactly where it was,
    // under its own UID-scoped keys, ready the instant it signs back in.
    Storage.setActiveNamespace(null);
    setSyncStatus('offline');
    updateProfileUI(null);
    // Re-render from the (now-active) guest namespace — otherwise the
    // UI would keep showing the just-signed-out account's data from its
    // still-loaded in-memory state.
    if(typeof App !== 'undefined' && typeof App.reloadAll === 'function') App.reloadAll();
  }

  /* ---------------- legacy (pre-isolation) data adoption ----------------
     Separate from the normal cloud<->namespace sync above. Offered only
     while Storage.hasUnclaimedLegacyData() is true, and only ever acted
     on after explicit confirmation — see the CRITICAL DATA SAFETY
     requirements this satisfies: never automatic, never re-offered once
     any account has claimed it, and the original unscoped keys are never
     modified or deleted by any part of this. */

  function openLegacyAdoptPrompt(){
    const overlay = document.getElementById('migrateModal');
    if(!overlay) return;
    const h3 = overlay.querySelector('h3');
    const p = overlay.querySelector('p');
    if(h3) h3.textContent = 'Data from before you signed in';
    if(p) p.textContent = 'This browser has study data saved from a previous local session (from before account sign-in was set up, or from someone else\'s session on this device). Would you like to associate it with your current account? It will be merged with anything already in your account — nothing already in your account is deleted or replaced.';
    overlay.classList.add('open');
  }
  function closeMigratePrompt(keep){
    const overlay = document.getElementById('migrateModal');
    if(overlay) overlay.classList.remove('open');
    if(keep) confirmLegacyAdoption();
  }

  async function confirmLegacyAdoption(){
    if(!currentUser || currentUser.isAnonymous) return;
    setSyncStatus('syncing');
    // Local-only, synchronous, and safe: copies (never deletes) the
    // legacy unscoped data into this account's namespace, MERGING it
    // with whatever's already there. Permanently marks it claimed so it
    // can never be offered to (or absorbed by) a different account.
    const result = Storage.adoptLegacyData(currentUser.uid);
    if(!result.ok){
      Utils.toast(
        result.reason === 'already-claimed'
          ? 'That data has already been associated with another account.'
          : 'Nothing found to bring in.',
        'info'
      );
      setSyncStatus(isSignedIn() ? 'online' : 'offline');
      return;
    }
    if(typeof App !== 'undefined' && typeof App.reloadAll === 'function') App.reloadAll();
    // Push the now-updated namespace (adopted data merged with whatever
    // was already in the cloud) up to Firestore, through the same
    // verified push path used everywhere else.
    const snap = Storage.snapshotAll();
    const pushResult = await pushAll(snap.values, snap.meta);
    if(pushResult.ok){
      Utils.toast('Previous local data has been added to your account', 'success');
      setSyncStatus('online');
    } else {
      Utils.toast(`Added to your account locally, but cloud sync failed (${pushResult.code}) — it will retry`, 'error');
      setSyncStatus('offline');
    }
  }

  function updateProfileUI(user){
    const signinBtn = document.getElementById('signinBtn');
    const whoBox = document.getElementById('whoBox');
    if(!signinBtn || !whoBox) return;
    if(user){
      signinBtn.style.display = 'none';
      whoBox.style.display = 'flex';
      const name = user.isAnonymous ? 'Guest' : (user.displayName || user.email || 'Student');
      document.getElementById('whoName').textContent = name;
      const av = document.getElementById('whoAvatar');
      if(user.photoURL){
        av.innerHTML = `<img src="${user.photoURL}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
      } else {
        av.textContent = name.slice(0,1).toUpperCase();
      }
    } else {
      signinBtn.style.display = 'block';
      whoBox.style.display = 'none';
    }
  }

  return { isSignedIn, getUser, pushAll, pullAll, onSignedIn, onSignedOut, closeMigratePrompt, confirmLegacyAdoption, setSyncStatus };
})();

const Auth = (function(){

  function init(){
    FirebaseService.init();
    if(!FirebaseService.isReady()){
      CloudSync.setSyncStatus('offline');
      return;
    }
    const auth = FirebaseService.getAuth();
    auth.onAuthStateChanged(user => {
      if(user) CloudSync.onSignedIn(user);
      else CloudSync.onSignedOut();
    });
  }

  function requireFirebase(){
    if(!FirebaseService.isReady()){
      const reason = FirebaseService.getFailureReason();
      Utils.toast(reason ? ('Cloud sign-in unavailable — ' + reason) : 'Cloud sign-in isn\'t configured yet — add your Firebase config in firebase.js', 'error');
      return false;
    }
    return true;
  }

  /* Turn a Firebase Auth error into a message that actually tells you
     what to do next. Firebase's raw e.message is sometimes a generic
     SDK string (or, for config problems, doesn't mention the fix at
     all), so map the error codes we can act on. Falls back to the
     original message for anything not covered here. */
  function describeAuthError(e){
    const code = e && e.code;
    switch(code){
      case 'auth/operation-not-allowed':
        return 'Email/password sign-in isn\'t enabled for this project yet — in the Firebase Console, go to Authentication → Sign-in method and enable "Email/Password".';
      case 'auth/invalid-api-key':
      case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
        return 'This app\'s Firebase API key isn\'t valid for this project — double-check firebaseConfig in firebase.js against Firebase Console → Project settings.';
      case 'auth/unauthorized-domain':
        return 'This site\'s domain isn\'t authorized for sign-in yet — in the Firebase Console, go to Authentication → Settings → Authorized domains and add it (e.g. your GitHub Pages domain).';
      case 'auth/user-not-found':
        return 'No account exists for that email — check the address, or use Sign Up.';
      case 'auth/wrong-password':
        return 'Incorrect password — try again.';
      case 'auth/invalid-credential':
        return 'Incorrect email or password.';
      case 'auth/invalid-email':
        return 'That email address looks invalid — check for typos.';
      case 'auth/missing-password':
        return 'Enter a password.';
      case 'auth/user-disabled':
        return 'This account has been disabled.';
      case 'auth/email-already-in-use':
        return 'An account with that email already exists — try Sign In instead.';
      case 'auth/weak-password':
        return 'Password should be at least 6 characters.';
      case 'auth/too-many-requests':
        return 'Too many attempts — please wait a moment and try again.';
      case 'auth/network-request-failed':
        return 'Network error reaching Firebase — check your connection and try again.';
      default:
        return (e && e.message) || 'Something went wrong — please try again.';
    }
  }

  async function signInGoogle(){
    if(!requireFirebase()) return;
    const auth = FirebaseService.getAuth();
    const provider = new firebase.auth.GoogleAuthProvider();
    try{
      await auth.signInWithPopup(provider);
      closeAuthModal();
      Utils.toast('Signed in with Google', 'success');
    }catch(e){
      console.error('[UQTxNova] Google sign-in failed:', e && e.code, e);
      Utils.toast(describeAuthError(e), 'error');
    }
  }

  async function signInEmail(email, password){
    if(!requireFirebase()) return;
    email = (email || '').trim();
    if(!email || !password){
      Utils.toast('Enter both an email and a password', 'error');
      return;
    }
    const auth = FirebaseService.getAuth();
    try{
      await auth.signInWithEmailAndPassword(email, password);
      closeAuthModal();
      Utils.toast('Welcome back', 'success');
    }catch(e){
      console.error('[UQTxNova] Email sign-in failed:', e && e.code, e);
      Utils.toast(describeAuthError(e), 'error');
    }
  }

  async function signUpEmail(email, password){
    if(!requireFirebase()) return;
    email = (email || '').trim();
    if(!email || !password){
      Utils.toast('Enter both an email and a password', 'error');
      return;
    }
    const auth = FirebaseService.getAuth();
    try{
      await auth.createUserWithEmailAndPassword(email, password);
      closeAuthModal();
      Utils.toast('Account created', 'success');
    }catch(e){
      console.error('[UQTxNova] Email sign-up failed:', e && e.code, e);
      Utils.toast(describeAuthError(e), 'error');
    }
  }

  async function continueAsGuest(){
    closeAuthModal();
    Utils.toast('Continuing in guest mode — data stays on this device', 'info');
    if(!FirebaseService.isReady()) return;
    try{
      const auth = FirebaseService.getAuth();
      await auth.signInAnonymously();
    }catch(e){ /* silently stay local-only */ }
  }

  async function signOut(){
    if(FirebaseService.isReady()){
      try{ await FirebaseService.getAuth().signOut(); }catch(e){}
    }
    // Signing out never touches localStorage — the same device stays
    // usable in guest mode with everything that was already there,
    // and the account's cloud copy is untouched too.
    Utils.toast('Signed out', 'info');
  }

  function openAuthModal(){
    const m = document.getElementById('authModal');
    if(m) m.classList.add('open');
  }
  function closeAuthModal(){
    const m = document.getElementById('authModal');
    if(m) m.classList.remove('open');
  }

  return { init, signInGoogle, signInEmail, signUpEmail, continueAsGuest, signOut, openAuthModal, closeAuthModal };
})();
