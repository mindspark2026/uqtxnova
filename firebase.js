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

  function isConfigured(){
    return firebaseConfig.apiKey && firebaseConfig.apiKey.indexOf('YOUR_') !== 0;
  }

  function init(){
    configured = isConfigured();
    if(!configured){
      console.warn('[UQTxNova] Firebase config not set — running in local-only (guest) mode. Edit firebase.js to enable cloud sync & sign-in.');
      return false;
    }
    try{
      if(typeof firebase === 'undefined'){
        console.warn('[UQTxNova] Firebase SDK not loaded.');
        return false;
      }
      app = firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();
      try{ db.enablePersistence({ synchronizeTabs:true }).catch(()=>{}); }catch(e){}
      ready = true;
      return true;
    }catch(e){
      console.error('[UQTxNova] Firebase init failed', e);
      return false;
    }
  }

  return {
    init,
    isConfigured,
    isReady: () => ready,
    getAuth: () => auth,
    getDb: () => db
  };
})();
