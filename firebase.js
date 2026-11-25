/* =========================================================
   TaskxNova — firebase.js
   ---------------------------------------------------------
   >>> REPLACE THE CONFIG BELOW WITH YOUR OWN FIREBASE PROJECT <<<
   Firebase Console → Project Settings → General → Your apps → SDK setup
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyBcY_Yut-4CFDSTwx7wAfUzhl6xSBeTcrA",
  authDomain: "uqtxnova.firebaseapp.com",
  projectId: "uqtxnova",
  storageBucket: "uqtxnova.firebasestorage.app",
  messagingSenderId: "66618620778",
  appId: "1:66618620778:web:e7822177640fedadc78313",
  measurementId: "G-BYNCWTK449"
};

const FirebaseService = (function(){
  let app = null, auth = null, db = null, ready = false, configured = false;
  let failureReason = null; // set when init() can't reach a ready state, for clearer diagnostics

  function isConfigured(){
    return firebaseConfig.apiKey && firebaseConfig.apiKey.indexOf('YOUR_') !== 0;
  }

  function init(){
    configured = isConfigured();
    if(!configured){
      failureReason = 'Firebase config not set in firebase.js.';
      console.warn('[UQTxNova] ' + failureReason + ' Running in local-only (guest) mode.');
      return false;
    }
    try{
      if(typeof firebase === 'undefined'){
        failureReason = 'The Firebase SDK script didn\'t load (check your network connection, ad-blocker, or CSP settings — the app loads it from www.gstatic.com).';
        console.warn('[UQTxNova] ' + failureReason);
        return false;
      }
      app = firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();
      try{ db.enablePersistence({ synchronizeTabs:true }).catch(()=>{}); }catch(e){}
      ready = true;
      failureReason = null;
      return true;
    }catch(e){
      failureReason = 'Firebase failed to initialize: ' + (e && e.message ? e.message : e);
      console.error('[UQTxNova] ' + failureReason, e);
      return false;
    }
  }

  return {
    init,
    isConfigured,
    isReady: () => ready,
    getAuth: () => auth,
    getDb: () => db,
    getFailureReason: () => failureReason
  };
})();
