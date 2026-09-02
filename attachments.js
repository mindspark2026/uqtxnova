/* =========================================================
   TaskxNova — attachments.js
   IndexedDB-backed binary storage for Notes file/image
   attachments. Keeps large blobs out of localStorage — only
   small metadata (name, size, type, thumbnail) is kept on the
   note object itself, so the existing localStorage/Firestore
   note sync flow (Storage.set('notes', ...)) needs no changes.
   ========================================================= */

/* ---------------- AttachmentDB (IndexedDB blob store) ---------------- */
const AttachmentDB = (function(){
  const DB_NAME = 'taskxnova_attachments';
  const STORE = 'files';
  let dbPromise = null;

  function open(){
    if(dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if(!('indexedDB' in window)){ reject(new Error('IndexedDB not supported in this browser')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function put(id, blob){
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ id, blob });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function get(id){
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => reject(req.error);
    });
  }

  async function remove(id){
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  return { put, get, remove };
})();

/* ---------------- AttachmentUtils (validation, compression, icons) ---------------- */
const AttachmentUtils = (function(){

  const IMAGE_EXT = ['jpg','jpeg','png'];
  const DOC_EXT = ['pdf'];
  const ALLOWED_EXT = [...IMAGE_EXT, ...DOC_EXT];
  const MAX_SIZE = 25 * 1024 * 1024;      // 25MB per attachment
  const COMPRESS_THRESHOLD = 500 * 1024;  // recompress images larger than this
  const THUMB_MAX_DIM = 320;
  const FULL_MAX_DIM = 1600;

  function extOf(name){
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  function isImageExt(ext){ return IMAGE_EXT.includes(ext); }

  function formatBytes(bytes){
    if(!bytes) return '0 B';
    const k = 1024, sizes = ['B','KB','MB','GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const val = bytes / Math.pow(k, i);
    return (i === 0 ? val : val.toFixed(1)) + ' ' + sizes[i];
  }

  function validate(file){
    const ext = extOf(file.name);
    if(!ALLOWED_EXT.includes(ext)) return { ok:false, reason: `"${file.name}" isn't supported — only JPG, PNG, and PDF files can be attached.` };
    if(file.size === 0) return { ok:false, reason: `"${file.name}" appears to be empty.` };
    if(file.size > MAX_SIZE) return { ok:false, reason: `"${file.name}" is too large — max ${formatBytes(MAX_SIZE)}.` };
    return { ok:true };
  }

  function readAsDataURL(blob){
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function loadImage(src){
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode image'));
      img.src = src;
    });
  }

  function canvasFrom(img, maxDim){
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function canvasToBlob(canvas, mime, quality){
    return new Promise(resolve => canvas.toBlob(b => resolve(b), mime, quality));
  }

  /**
   * Processes an image file before storage: downscales + recompresses
   * JPEG/PNG images above COMPRESS_THRESHOLD, and always returns a small
   * thumbnail dataURL for instant, lazy-loadable grid rendering.
   */
  async function processImage(file, ext){
    const dataUrl = await readAsDataURL(file);

    let img;
    try{ img = await loadImage(dataUrl); }
    catch(e){ return { blob: file, thumb: dataUrl }; }

    const thumbCanvas = canvasFrom(img, THUMB_MAX_DIM);
    const thumb = thumbCanvas.toDataURL(ext === 'png' ? 'image/png' : 'image/jpeg', 0.72);

    let blob = file;
    if(file.size > COMPRESS_THRESHOLD){
      const fullCanvas = canvasFrom(img, FULL_MAX_DIM);
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      const compressed = await canvasToBlob(fullCanvas, mime, 0.82);
      if(compressed && compressed.size < file.size) blob = compressed;
    }
    return { blob, thumb };
  }

  function iconSvg(ext){
    const colors = { pdf:'#F87171' };
    const color = colors[ext] || '#7C5CFF';
    const label = (ext || 'file').slice(0, 4).toUpperCase();
    return `<svg width="28" height="32" viewBox="0 0 28 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 2h13l8 8v18a2 2 0 01-2 2H3a2 2 0 01-2-2V4a2 2 0 012-2z" fill="${color}" fill-opacity="0.16" stroke="${color}" stroke-width="1.4"/>
      <path d="M16 2v8h8" stroke="${color}" stroke-width="1.4"/>
      <text x="13" y="23" font-size="6.4" font-weight="700" text-anchor="middle" fill="${color}" font-family="Space Grotesk, sans-serif">${label}</text>
    </svg>`;
  }

  return { extOf, isImageExt, IMAGE_EXT, DOC_EXT, formatBytes, validate, MAX_SIZE, readAsDataURL, processImage, iconSvg };
})();
