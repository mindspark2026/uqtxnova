/* =========================================================
   TaskxNova — auth.js
   Guest mode by default. Email/Password + Google sign-in via
   Firebase Auth. CloudSync pushes/pulls the same collections
   storage.js manages, keyed under users/{uid}/data/{key}.
   ========================================================= */

const CloudSync = (function(){
  let currentUser = null;
  let pulling = false;

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

  async function pushAll(payload){
    if(!currentUser || !FirebaseService.isReady()) return;
    setSyncStatus('syncing');
    const db = FirebaseService.getDb();
    try{
      const batch = db.batch();
      Object.keys(payload).forEach(key => {
        if(payload[key] === null || payload[key] === undefined) return;
        const ref = db.collection('users').doc(currentUser.uid).collection('data').doc(key);
        batch.set(ref, { value: JSON.stringify(payload[key]), updatedAt: Date.now() });
      });
      await batch.commit();
      setSyncStatus('online');
    }catch(e){
      console.error('Cloud push failed', e);
      // Data is always saved locally first (storage.js) regardless of this
      // push's outcome, so this failure is only worth surfacing to someone
      // who actually opted into cloud sync with a real account. Anonymous/
      // guest sessions (and the no-account/local-only case, already filtered
      // above) run in Local Storage Mode — silent by design, no error toast.
      if(currentUser && !currentUser.isAnonymous){
        Utils.toast('Cloud sync failed — changes saved locally', 'error');
      }
      setSyncStatus('offline');
    }
  }

  async function pullAll(){
    if(!currentUser || !FirebaseService.isReady()) return null;
    const db = FirebaseService.getDb();
    const snap = await db.collection('users').doc(currentUser.uid).collection('data').get();
    const data = {};
    snap.forEach(doc => {
      try{
        const parsed = JSON.parse(doc.data().value);
        if(parsed !== null && parsed !== undefined) data[doc.id] = parsed;
      }catch(e){}
    });
    return data;
  }

  async function migrateGuestData(){
    const local = {};
    Storage.KEYS.forEach(k => {
      const v = Storage.get(k, null);
      if(v !== null && v !== undefined) local[k] = v;
    });
    await pushAll(local);
    Utils.toast('Your local data has been synced to your account', 'success');
  }

  async function onSignedIn(user){
    currentUser = user;
    updateProfileUI(user);
    setSyncStatus('syncing');
    const hasGuestData = Storage.hasAnyGuestData();
    try{
      const cloud = await pullAll();
      const cloudHasData = cloud && Object.values(cloud).some(v => Array.isArray(v) ? v.length : (v && typeof v==='object' ? Object.keys(v).length : false));
      if(hasGuestData && !cloudHasData){
        openMigratePrompt();
      } else if(cloudHasData){
        Storage.replaceAll(cloud);
        if(window.App) App.reloadAll();
        Utils.toast('Synced from the cloud', 'success');
      }
      setSyncStatus('online');
    }catch(e){
      console.error(e);
      setSyncStatus('offline');
    }
  }

  function onSignedOut(){
    currentUser = null;
    setSyncStatus('offline');
    updateProfileUI(null);
  }

  function openMigratePrompt(){
    const overlay = document.getElementById('migrateModal');
    if(overlay) overlay.classList.add('open');
  }
  function closeMigratePrompt(keep){
    const overlay = document.getElementById('migrateModal');
    if(overlay) overlay.classList.remove('open');
    if(keep) migrateGuestData();
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

  return { isSignedIn, getUser, pushAll, pullAll, migrateGuestData, onSignedIn, onSignedOut, closeMigratePrompt, setSyncStatus };
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
      Utils.toast('Cloud sign-in isn\'t configured yet — add your Firebase config in firebase.js', 'error');
      return false;
    }
    return true;
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
      console.error(e);
      Utils.toast(e.message || 'Google sign-in failed', 'error');
    }
  }

  async function signInEmail(email, password){
    if(!requireFirebase()) return;
    const auth = FirebaseService.getAuth();
    try{
      await auth.signInWithEmailAndPassword(email, password);
      closeAuthModal();
      Utils.toast('Welcome back', 'success');
    }catch(e){
      Utils.toast(e.message || 'Sign in failed', 'error');
    }
  }

  async function signUpEmail(email, password){
    if(!requireFirebase()) return;
    const auth = FirebaseService.getAuth();
    try{
      await auth.createUserWithEmailAndPassword(email, password);
      closeAuthModal();
      Utils.toast('Account created', 'success');
    }catch(e){
      Utils.toast(e.message || 'Sign up failed', 'error');
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
