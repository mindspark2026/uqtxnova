/* =========================================================
   TaskxNova — reminders.js
   Lightweight reminders: { id, text, remindAt (ts), taskId?, fired }
   Checked every 60s. When due: toast + (if permitted) a native
   browser Notification. No new page/layout — this plugs into
   the existing reminder bar pattern and the AI assistant.
   ========================================================= */

const Reminders = (function(){
  let reminders = Storage.get('reminders', []) || [];
  let checkTimer = null;

  function save(){ Storage.set('reminders', reminders); }
  function reload(){ reminders = Storage.get('reminders', []) || []; }

  function add(text, remindAt, taskId){
    const r = { id: Utils.uid(), text, remindAt: Number(remindAt), taskId: taskId || null, fired:false };
    reminders.push(r);
    save();
    return r;
  }

  function remove(id){
    reminders = reminders.filter(r => r.id !== id);
    save();
  }

  function list(){
    return reminders.slice().sort((a,b) => a.remindAt - b.remindAt);
  }

  function checkDue(){
    const now = Date.now();
    let changed = false;
    reminders.forEach(r => {
      if(!r.fired && r.remindAt <= now){
        r.fired = true;
        changed = true;
        Utils.toast(`⏰ ${r.text}`, 'info');
        try{
          if(AppSettings.settings.notifications && 'Notification' in window && Notification.permission === 'granted'){
            new Notification('UQTxNova reminder', { body: r.text });
          } else if(AppSettings.settings.notifications && 'Notification' in window && Notification.permission === 'default'){
            Notification.requestPermission();
          }
        }catch(e){ /* notifications unavailable — toast already shown */ }
      }
    });
    if(changed) save();
  }

  function init(){
    checkDue();
    checkTimer = setInterval(checkDue, 60000);
  }

  return { add, remove, list, checkDue, reload, init };
})();
