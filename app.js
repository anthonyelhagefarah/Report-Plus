// Report Plus: reportes de inspección por cliente con fotos, videos, medidas y PDF.
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const urls = [];
const objUrl = blob => { const u = URL.createObjectURL(blob); urls.push(u); return u; };
const fmtDate = t => new Date(t).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtDur = s => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '';

const SECTION_TEMPLATES = {
  'Vivienda': ['Fachada', 'Sala', 'Comedor', 'Cocina', 'Habitaciones', 'Baños', 'Techo', 'Exteriores'],
  'Obra / construcción': ['Avance general', 'Estructura', 'Instalaciones eléctricas', 'Instalaciones sanitarias', 'Acabados', 'Pendientes'],
  'Daños / seguro': ['Vista general', 'Daños detectados', 'Detalle de daños', 'Medidas', 'Causa probable'],
  'Mantenimiento': ['Antes', 'Durante', 'Después'],
};
const LAYOUTS = [
  ['portrait', 1, 1, 'Vertical · 1 por página'], ['portrait', 1, 2, 'Vertical · 1×2'], ['portrait', 2, 2, 'Vertical · 2×2'],
  ['portrait', 2, 3, 'Vertical · 2×3'], ['portrait', 3, 3, 'Vertical · 3×3'], ['portrait', 3, 4, 'Vertical · 3×4'],
  ['landscape', 1, 1, 'Horizontal · 1 por página'], ['landscape', 2, 1, 'Horizontal · 2×1'], ['landscape', 2, 2, 'Horizontal · 2×2'],
  ['landscape', 3, 2, 'Horizontal · 3×2'],
];

function toast(msg, ms = 2500) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, ms);
}

function setHeader(title, back) {
  $('#title').textContent = title;
  $('#backBtn').hidden = !back;
  $('#backBtn').onclick = () => { location.hash = back; };
}

// Formulario modal genérico. fields: [{name,label,type,value,options}]
function form(title, fields, okText = 'Guardar') {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'sheet';
    d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2>
      ${fields.map(f => `<label>${esc(f.label)}
        ${f.type === 'textarea' ? `<textarea name="${f.name}" rows="4">${esc(f.value)}</textarea>`
        : f.type === 'select' ? `<select name="${f.name}">${f.options.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(f.value) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`
        : f.type === 'checkbox' ? `<input type="checkbox" name="${f.name}" ${f.value ? 'checked' : ''}>`
        : `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value)}" ${f.required ? 'required' : ''}>`}
      </label>`).join('')}
      <div class="row end"><button value="cancel" formnovalidate>Cancelar</button><button value="ok" class="primary">${esc(okText)}</button></div>
    </form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => {
      const ok = d.returnValue === 'ok';
      const out = {};
      if (ok) fields.forEach(f => {
        const el = d.querySelector(`[name="${f.name}"]`);
        out[f.name] = f.type === 'checkbox' ? el.checked : el.value.trim();
      });
      d.remove();
      resolve(ok ? out : null);
    });
    d.showModal();
  });
}

function pickFiles(accept, { capture, multiple } = {}) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    if (capture) inp.setAttribute('capture', 'environment');
    if (multiple) inp.multiple = true;
    inp.onchange = () => resolve([...inp.files]);
    inp.click();
  });
}

function videoThumb(blob) {
  return new Promise(resolve => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    const url = URL.createObjectURL(blob);
    let done = false;
    const finish = (thumb, duration) => { if (done) return; done = true; URL.revokeObjectURL(url); resolve({ thumb, duration }); };
    v.onloadedmetadata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); };
    v.onseeked = () => {
      const c = document.createElement('canvas');
      const k = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
      c.width = v.videoWidth * k; c.height = v.videoHeight * k;
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      c.toBlob(b => finish(b, isFinite(v.duration) ? v.duration : 0), 'image/jpeg', 0.85);
    };
    v.onerror = () => finish(null, 0);
    setTimeout(() => finish(null, 0), 8000);
    v.src = url;
  });
}

async function addMedia(report, sectionId, files, extra = {}) {
  const existing = await DB.byIndex('items', 'reportId', report.id);
  let order = existing.length;
  for (const f of files) {
    const isVideo = f.type.startsWith('video');
    const item = { id: DB.uid(), reportId: report.id, sectionId, type: isVideo ? 'video' : 'photo', blob: f, caption: '', measure: '', shapes: [], order: order++, createdAt: Date.now(), ...extra };
    if (isVideo) Object.assign(item, await videoThumb(f));
    await DB.put('items', item);
  }
  toast(`${files.length} elemento(s) agregado(s)`);
}

// Ubicación GPS actual + dirección aproximada (OpenStreetMap).
function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Este teléfono no permite obtener la ubicación'));
    // Solo coordenadas: la dirección y el residencial los escribe el usuario.
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      resolve({ lat: +lat.toFixed(6), lng: +lng.toFixed(6), accuracy: Math.round(accuracy), at: Date.now() });
    }, err => reject(new Error(err.code === 1 ? 'Permiso de ubicación denegado. Actívalo en los ajustes del navegador.' : 'No se pudo obtener la ubicación')), { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
  });
}
const mapEmbed = g => { const k = 0.0025; return `<iframe class="map" loading="lazy" title="Mapa" src="https://www.openstreetmap.org/export/embed.html?bbox=${g.lng - k},${g.lat - k},${g.lng + k},${g.lat + k}&layer=mapnik&marker=${g.lat},${g.lng}"></iframe>`; };
const mapUrl = g => `https://www.google.com/maps?q=${g.lat},${g.lng}`;
const geoLine = g => g ? `<div>🛰 <a href="${mapUrl(g)}" target="_blank" rel="noopener">${g.lat}, ${g.lng}</a> <small class="muted">(±${g.accuracy} m · ver en mapa)</small></div>` : '';

async function withLocation(btn) {
  const t = btn.textContent; btn.disabled = true; btn.textContent = 'Buscando ubicación…';
  try { return await getLocation(); } catch (e) { toast(e.message, 5000); return null; } finally { btn.disabled = false; btn.textContent = t; }
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function shareOrDownload(blob, name, title) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  download(blob, name);
}

// ---------- Cámara integrada: fotos en ráfaga y grabación de video ----------
function openCamera(onCapture) {
  return new Promise(async resolve => {
    const ov = document.createElement('div');
    ov.className = 'camera';
    ov.innerHTML = `<video playsinline muted autoplay></video>
      <div class="cam-top"><button data-a="close">Listo</button><span class="cam-count">0</span><button data-a="flip">⟲</button></div>
      <div class="cam-rec" hidden>● <span>0:00</span></div>
      <div class="cam-bottom">
        <div class="cam-modes"><button data-m="photo" class="on">FOTO</button><button data-m="video">VIDEO</button></div>
        <button class="shutter" data-a="shoot" aria-label="Capturar"></button>
      </div>`;
    document.body.appendChild(ov); document.body.classList.add('noscroll');
    const video = $('video', ov);
    let stream, facing = 'environment', mode = 'photo', rec, chunks, t0, timer, count = 0;

    async function start() {
      stream?.getTracks().forEach(t => t.stop());
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: mode === 'video' });
        video.srcObject = stream;
      } catch (e) {
        toast('No se pudo abrir la cámara. Usa los botones Foto/Video del sistema.', 4000);
        close();
      }
    }
    function close() {
      if (rec && rec.state === 'recording') rec.stop();
      stream?.getTracks().forEach(t => t.stop());
      clearInterval(timer);
      ov.remove(); document.body.classList.remove('noscroll');
      resolve(count);
    }
    const bump = () => { count++; $('.cam-count', ov).textContent = count; };

    ov.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.a === 'close') return close();
      if (b.dataset.a === 'flip') { facing = facing === 'environment' ? 'user' : 'environment'; return start(); }
      if (b.dataset.m && !(rec && rec.state === 'recording')) {
        mode = b.dataset.m;
        ov.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === b));
        ov.classList.toggle('video-mode', mode === 'video');
        return start();
      }
      if (b.dataset.a === 'shoot') {
        if (mode === 'photo') {
          const c = document.createElement('canvas');
          c.width = video.videoWidth; c.height = video.videoHeight;
          c.getContext('2d').drawImage(video, 0, 0);
          ov.classList.add('flash'); setTimeout(() => ov.classList.remove('flash'), 150);
          const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
          await onCapture(new File([blob], `foto_${Date.now()}.jpg`, { type: 'image/jpeg' }));
          bump();
        } else if (!rec || rec.state !== 'recording') {
          const type = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
          rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
          chunks = [];
          rec.ondataavailable = ev => ev.data.size && chunks.push(ev.data);
          rec.onstop = async () => {
            const mime = (rec.mimeType || 'video/webm').split(';')[0];
            const blob = new Blob(chunks, { type: mime });
            await onCapture(new File([blob], `video_${Date.now()}.${mime.includes('mp4') ? 'mp4' : 'webm'}`, { type: mime }));
            bump();
          };
          rec.start(1000); t0 = Date.now();
          ov.classList.add('recording'); $('.cam-rec', ov).hidden = false;
          timer = setInterval(() => { $('.cam-rec span', ov).textContent = fmtDur((Date.now() - t0) / 1000) || '0:00'; }, 500);
        } else {
          rec.stop(); clearInterval(timer);
          ov.classList.remove('recording'); $('.cam-rec', ov).hidden = true;
        }
      }
    });
    start();
  });
}

// ---------- Visor de foto a pantalla completa (pellizcar para ampliar, arrastrar para mover) ----------
function openViewer(blob) {
  const ov = document.createElement('div');
  ov.className = 'viewer';
  const url = URL.createObjectURL(blob);
  ov.innerHTML = `<img src="${url}" alt="" draggable="false"><button class="viewer-close" aria-label="Cerrar">✕</button><div class="viewer-hint">Pellizca para ampliar · doble toque para acercar</div>`;
  document.body.appendChild(ov); document.body.classList.add('noscroll');
  const img = $('img', ov);
  let scale = 1, tx = 0, ty = 0, lastTap = 0;
  const pts = new Map();
  let start = null;
  const apply = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
  const clamp = () => {
    scale = Math.min(8, Math.max(1, scale));
    if (scale === 1) { tx = 0; ty = 0; }
  };
  const close = () => { ov.remove(); document.body.classList.remove('noscroll'); URL.revokeObjectURL(url); };
  $('.viewer-close', ov).onclick = close;
  const snapshot = () => {
    const [a, b] = [...pts.values()];
    start = { scale, tx, ty, a: { ...a }, d: b ? Math.hypot(b.x - a.x, b.y - a.y) : 0, mid: b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { ...a } };
  };
  ov.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    ov.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    snapshot();
    if (pts.size === 1) {
      const now = Date.now();
      if (now - lastTap < 300) {
        const r = ov.getBoundingClientRect();
        if (scale > 1) { scale = 1; tx = ty = 0; }
        else { scale = 2.5; tx = -(e.clientX - r.width / 2) * 1.5; ty = -(e.clientY - r.height / 2) * 1.5; }
        img.style.transition = 'transform .2s'; apply(); setTimeout(() => { img.style.transition = ''; }, 220);
        lastTap = 0; return;
      }
      lastTap = now;
    }
  });
  ov.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || !start) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...pts.values()];
    if (b && start.d) {
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const r = ov.getBoundingClientRect();
      const ns = Math.min(8, Math.max(1, start.scale * d / start.d));
      const cx = start.mid.x - r.width / 2, cy = start.mid.y - r.height / 2;
      tx = mid.x - r.width / 2 - (cx - start.tx) * ns / start.scale;
      ty = mid.y - r.height / 2 - (cy - start.ty) * ns / start.scale;
      scale = ns;
    } else if (scale > 1) {
      tx = start.tx + (a.x - start.a.x); ty = start.ty + (a.y - start.a.y);
    }
    apply();
  });
  const up = e => { pts.delete(e.pointerId); clamp(); apply(); if (pts.size) snapshot(); else start = null; };
  ov.addEventListener('pointerup', up);
  ov.addEventListener('pointercancel', up);
  ov.addEventListener('wheel', e => { e.preventDefault(); scale *= e.deltaY < 0 ? 1.15 : 1 / 1.15; clamp(); apply(); }, { passive: false });
}

// ---------- Vistas ----------
// Una sola forma de trabajar: inicio con buscador, carpetas y reportes; cada reporte con sus áreas.
const getMode = () => 'simple';
const modeSwitch = () => '';
const bindModeSwitch = () => {};

function newReport(clientId, fields) {
  return {
    id: DB.uid(), clientId, date: Date.now(), notes: '',
    sections: [{ id: DB.uid(), title: 'General', text: '' }],
    layout: { orientation: 'portrait', cols: 2, rows: 3 }, cover: true, coverImage: true, ...fields,
  };
}

// Formulario de creación rápida con botón de ubicación en el mismo formulario.
function quickCreateForm() {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'sheet';
    d.innerHTML = `<form method="dialog"><h2>Nuevo cliente</h2>
      <label>Nombre del cliente<input name="name" required></label>
      <label>Dirección<input name="address"></label>
      <label>Nombre del residencial<input name="residential"></label>
      <label>Ubicación en el mapa</label>
      <button type="button" id="qgps" class="wide">📍 Guardar mi ubicación actual</button>
      <div id="qgeo" class="muted small"></div>
      <div id="qmap"></div>
      <label>Foto de portada <small>(opcional)</small></label>
      <div class="row cover-pick"><button type="button" data-cv="take">📷 Tomar foto</button><button type="button" data-cv="pick">🖼 Galería</button></div>
      <div id="qcover"></div>
      <label>Teléfono<input name="phone" type="tel"></label>
      <label>Correo<input name="email" type="email"></label>
      <label>Notas<textarea name="notes" rows="2"></textarea></label>
      <div class="row end"><button value="cancel" formnovalidate>Cancelar</button><button value="ok" class="primary">Crear</button></div>
    </form>`;
    document.body.appendChild(d);
    let geo = null, cover = null;
    d.querySelectorAll('[data-cv]').forEach(b => b.onclick = async () => {
      const [f] = await pickFiles('image/*', { capture: b.dataset.cv === 'take' });
      if (!f) return;
      cover = f;
      $('#qcover', d).innerHTML = `<div class="cover-prev"><img src="${URL.createObjectURL(f)}" alt=""><button type="button" class="kebab" id="qcoverdel" aria-label="Quitar">✕</button></div>`;
      $('#qcoverdel', d).onclick = () => { cover = null; $('#qcover', d).innerHTML = ''; };
    });
    $('#qgps', d).onclick = async e => {
      const g = await withLocation(e.currentTarget); if (!g) return;
      geo = g;
      $('#qgeo', d).innerHTML = `🛰 GPS guardado: ${g.lat}, ${g.lng} (±${g.accuracy} m) · <a href="${mapUrl(g)}" target="_blank" rel="noopener">Abrir en Google Maps</a>`;
      $('#qmap', d).innerHTML = mapEmbed(g);
    };
    d.addEventListener('close', () => {
      const ok = d.returnValue === 'ok';
      const out = {};
      if (ok) ['name', 'address', 'residential', 'phone', 'email', 'notes'].forEach(k => { out[k] = d.querySelector(`[name=${k}]`).value.trim(); });
      d.remove();
      resolve(ok ? { ...out, geo, cover } : null);
    });
    d.showModal();
  });
}

// Menú de opciones (hoja inferior). options: [[clave, texto, clase?]]
function actionSheet(title, options) {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'sheet actions';
    d.innerHTML = `<form method="dialog">${title ? `<h2>${esc(title)}</h2>` : ''}
      ${options.map(([k, t, cls]) => `<button value="${esc(k)}" class="wide ${cls || ''}">${esc(t)}</button>`).join('')}
      <button value="" class="wide ghost">Cancelar</button></form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => { const v = d.returnValue; d.remove(); resolve(v || null); });
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    d.showModal();
  });
}
const getFolders = async () => (await DB.get('settings', 'folders')) || [];
const saveFolders = f => DB.put('settings', f, 'folders');
const fmtWhen = t => new Date(t).toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

async function viewHome(folderId) {
  const folders = await getFolders();
  const folder = folderId && folders.find(f => f.id === folderId);
  if (folderId && !folder) return (location.hash = '#/');
  setHeader(folder ? folder.name : 'Report Plus', folder ? '#/' : null);
  const all = (await DB.all('reports')).sort((a, b) => b.date - a.date);
  const clients = Object.fromEntries((await DB.all('clients')).map(c => [c.id, c]));
  const label = r => {
    const c = clients[r.clientId] || {};
    const name = c.name || r.title;
    return { name, text: name, search: [name, r.title, r.location, c.address, c.residential, c.phone].filter(Boolean).join(' ').toLowerCase() };
  };
  const reports = all.filter(r => folder ? r.folderId === folder.id : !r.folderId);
  const reportRow = (r, hidden) => {
    const l = label(r);
    return `<li data-name="${esc(l.search)}" data-report="${r.id}" ${hidden ? 'hidden' : ''}><a href="#/r/${r.id}"><span class="ico">📋</span><div class="grow"><b>${esc(l.text)}</b></div></a><button class="kebab" data-menu="${r.id}" aria-label="Opciones">⋮</button></li>`;
  };
  view.innerHTML = `
    ${folder ? '' : modeSwitch()}
    <div class="toolbar"><input type="search" id="q" placeholder="Buscar cliente o dirección…"></div>
    <ul class="list" id="list">
      ${folder ? '' : folders.map(f => `<li data-name="${esc(f.name.toLowerCase())}" data-folder-row><a href="#/f/${f.id}"><span class="ico">📁</span><div class="grow"><b>${esc(f.name)}</b> <small class="inline-count">${all.filter(r => r.folderId === f.id).length}</small></div></a><button class="kebab" data-fmenu="${f.id}" aria-label="Opciones">⋮</button></li>`).join('')}
      ${reports.map(r => reportRow(r)).join('')}
      ${folder ? '' : all.filter(r => r.folderId).map(r => reportRow(r, true).replace('<li ', '<li data-infolder ')).join('')}
    </ul>
    ${reports.length || (!folder && folders.length) ? '' : `<div class="empty"><p>${folder ? 'Carpeta vacía.' : 'Aún no tienes clientes.'}</p><p>Pulsa <b>+</b> para crear uno y empezar a tomar fotos.</p></div>`}
    ${folder ? '' : '<button class="ghost wide" id="newfolder">📁 Nueva carpeta</button>'}
    <button class="fab" id="add" aria-label="Crear cliente">+</button>`;
  if (!folder) bindModeSwitch();
  $('#q').oninput = e => {
    const q = e.target.value.trim().toLowerCase();
    view.querySelectorAll('#list li').forEach(li => {
      // Al buscar se muestran también los reportes que están dentro de carpetas.
      li.hidden = q ? !li.dataset.name.includes(q) : li.hasAttribute('data-infolder');
    });
  };
  const createReport = async () => {
    const v = await quickCreateForm();
    if (!v || !v.name) return;
    const c = { id: DB.uid(), name: v.name, address: v.address, residential: v.residential, phone: v.phone, email: v.email, notes: v.notes, geo: v.geo || undefined, createdAt: Date.now(), updatedAt: Date.now() };
    await DB.put('clients', c);
    const r = newReport(c.id, { title: v.name, location: v.address, geo: v.geo || undefined, folderId: folder ? folder.id : undefined, coverPhoto: v.cover || undefined });
    if (SECTION_TEMPLATES[v.tpl]) r.sections = SECTION_TEMPLATES[v.tpl].map(t => ({ id: DB.uid(), title: t, text: '' }));
    await DB.put('reports', r);
    location.hash = `#/r/${r.id}`;
  };
  $('#add').onclick = createReport;
  if ($('#newfolder')) $('#newfolder').onclick = async () => {
    const v = await form('Nueva carpeta', [{ name: 'name', label: 'Nombre', value: '', required: true }], 'Crear');
    if (!v || !v.name) return;
    folders.push({ id: DB.uid(), name: v.name }); await saveFolders(folders); route();
  };
  view.querySelectorAll('[data-menu]').forEach(b => b.onclick = async () => {
    const r = all.find(x => x.id === b.dataset.menu);
    const opts = [['open', 'Abrir']];
    if (folders.length) opts.push(['move', '📁 Mover a carpeta']);
    if (r.folderId) opts.push(['out', 'Sacar de la carpeta']);
    opts.push(['del', '🗑 Eliminar reporte', 'danger']);
    const a = await actionSheet(label(r).text, opts);
    if (a === 'open') location.hash = `#/r/${r.id}`;
    if (a === 'move') {
      const v = await form('Mover a carpeta', [{ name: 'f', label: 'Carpeta', type: 'select', value: r.folderId || folders[0].id, options: folders.map(f => [f.id, f.name]) }], 'Mover');
      if (v) { r.folderId = v.f; await DB.put('reports', r); route(); }
    }
    if (a === 'out') { delete r.folderId; await DB.put('reports', r); route(); }
    if (a === 'del' && confirm('¿Eliminar este reporte con todas sus fotos y videos?')) { await DB.deleteReport(r.id); route(); }
  });
  view.querySelectorAll('[data-fmenu]').forEach(b => b.onclick = async () => {
    const f = folders.find(x => x.id === b.dataset.fmenu);
    const a = await actionSheet(f.name, [['rename', 'Cambiar nombre'], ['del', '🗑 Eliminar carpeta (los reportes se conservan)', 'danger']]);
    if (a === 'rename') {
      const v = await form('Cambiar nombre', [{ name: 'name', label: 'Nombre', value: f.name, required: true }]);
      if (v && v.name) { f.name = v.name; await saveFolders(folders); route(); }
    }
    if (a === 'del' && confirm(`¿Eliminar la carpeta "${f.name}"? Los reportes quedan en el inicio.`)) {
      for (const r of all.filter(x => x.folderId === f.id)) { delete r.folderId; await DB.put('reports', r); }
      await saveFolders(folders.filter(x => x !== f)); route();
    }
  });
}

async function viewClients() {
  setHeader('Clientes');
  const clients = (await DB.all('clients')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const reports = await DB.all('reports');
  view.innerHTML = `
    ${modeSwitch()}
    <div class="toolbar"><input type="search" id="q" placeholder="Buscar cliente…"><button class="primary" id="add">+ Cliente</button></div>
    <ul class="list" id="list">
      ${clients.map(c => `<li data-name="${esc(c.name.toLowerCase())}"><a href="#/c/${c.id}">
        <div class="avatar">${esc(c.name.slice(0, 1).toUpperCase())}</div>
        <div class="grow"><b>${esc(c.name)}</b><small>${esc([c.address, c.residential].filter(Boolean).join(' · ') || c.phone || '')}</small></div>
        <span class="badge">${reports.filter(r => r.clientId === c.id).length}</span></a></li>`).join('')}
    </ul>
    ${clients.length ? '' : `<div class="empty"><p>Aún no tienes clientes.</p><p>Crea uno para empezar tu primer reporte con fotos y videos.</p></div>`}`;
  bindModeSwitch();
  $('#q').oninput = e => {
    const q = e.target.value.toLowerCase();
    view.querySelectorAll('#list li').forEach(li => { li.hidden = !li.dataset.name.includes(q); });
  };
  $('#add').onclick = async () => {
    const v = await form('Nuevo cliente', clientFields({}));
    if (!v || !v.name) return;
    const c = { id: DB.uid(), ...v, createdAt: Date.now(), updatedAt: Date.now() };
    await DB.put('clients', c);
    location.hash = `#/c/${c.id}`;
  };
}

const clientFields = c => [
  { name: 'name', label: 'Nombre', value: c.name, required: true },
  { name: 'address', label: 'Dirección', value: c.address },
  { name: 'residential', label: 'Nombre del residencial', value: c.residential },
  { name: 'phone', label: 'Teléfono', value: c.phone, type: 'tel' },
  { name: 'email', label: 'Correo', value: c.email, type: 'email' },
  { name: 'notes', label: 'Notas', value: c.notes, type: 'textarea' },
];

async function viewClient(id) {
  const c = await DB.get('clients', id);
  if (!c) return (location.hash = '#/');
  setHeader(c.name, '#/');
  const reports = (await DB.byIndex('reports', 'clientId', id)).sort((a, b) => b.date - a.date);
  view.innerHTML = `
    <section class="card">
      <div class="row"><div class="grow">
        ${c.address ? `<div>📍 ${esc(c.address)}</div>` : ''}${c.residential ? `<div>🏘 ${esc(c.residential)}</div>` : ''}${geoLine(c.geo)}${c.phone ? `<div>📞 <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></div>` : ''}
        ${c.email ? `<div>✉️ <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>` : ''}${c.notes ? `<p class="muted">${esc(c.notes)}</p>` : ''}
      </div><div class="col"><button id="here">📍 Estoy aquí</button><button id="edit">Editar</button><button id="del" class="danger">Eliminar</button></div></div>
    </section>
    <div class="toolbar"><h2 class="grow">Reportes</h2><button class="primary" id="add">+ Reporte</button></div>
    <ul class="list">
      ${reports.map(r => `<li><a href="#/r/${r.id}"><div class="grow"><b>${esc(r.title)}</b><small>${fmtDate(r.date)}${r.location ? ' · ' + esc(r.location) : ''}</small></div><span class="chev">›</span></a></li>`).join('')}
    </ul>
    ${reports.length ? '' : '<div class="empty"><p>Sin reportes todavía.</p></div>'}`;
  $('#edit').onclick = async () => {
    const v = await form('Editar cliente', clientFields(c)); if (!v) return;
    await DB.put('clients', { ...c, ...v, updatedAt: Date.now() }); route();
  };
  $('#here').onclick = async e => {
    const g = await withLocation(e.target); if (!g) return;
    c.geo = g;
    await DB.put('clients', { ...c, updatedAt: Date.now() }); toast('Ubicación guardada'); route();
  };
  $('#del').onclick = async () => {
    if (!confirm(`¿Eliminar a ${c.name} y todos sus reportes, fotos y videos?`)) return;
    await DB.deleteClient(id); location.hash = '#/';
  };
  $('#add').onclick = async () => {
    const v = await form('Nuevo reporte', [
      { name: 'title', label: 'Título', value: `Inspección ${new Date().toLocaleDateString('es')}`, required: true },
      { name: 'location', label: 'Ubicación', value: c.address },
      { name: 'gps', label: '📍 Guardar mi ubicación GPS actual', type: 'checkbox', value: true },
      { name: 'tpl', label: 'Plantilla de secciones', type: 'select', value: '', options: [['', 'Una sola sección (General)'], ...Object.keys(SECTION_TEMPLATES).map(k => [k, k])] },
    ], 'Crear');
    if (!v) return;
    const names = SECTION_TEMPLATES[v.tpl] || ['General'];
    const r = {
      id: DB.uid(), clientId: id, title: v.title, location: v.location, date: Date.now(), notes: '',
      sections: names.map(t => ({ id: DB.uid(), title: t, text: '' })),
      layout: { orientation: 'portrait', cols: 2, rows: 3 }, cover: true, coverImage: true,
    };
    if (v.gps) {
      toast('Obteniendo ubicación…');
      try {
        r.geo = await getLocation();
        if (!c.geo) c.geo = r.geo;
      } catch (e) { toast(e.message, 5000); }
    }
    await DB.put('reports', r);
    await DB.put('clients', { ...c, updatedAt: Date.now() });
    location.hash = `#/r/${r.id}`;
  };
}

async function viewReport(id) {
  const r = await DB.get('reports', id);
  if (!r) return (location.hash = '#/');
  const c = await DB.get('clients', r.clientId);
  const simple = getMode() === 'simple';
  setHeader(r.title, simple ? '#/' : `#/c/${r.clientId}`);
  const items = (await DB.byIndex('items', 'reportId', id)).sort((a, b) => a.order - b.order);
  const nPhotos = items.filter(i => i.type === 'photo').length, nVideos = items.length - nPhotos;
  const L = r.layout;
  view.innerHTML = `
    <section class="card summary">
      <div><b>${esc(c?.name)}</b> · ${fmtDate(r.date)}${r.location ? ' · ' + esc(r.location) : ''}</div>
      ${c?.residential ? `<div>🏘 ${esc(c.residential)}</div>` : ''}
      ${geoLine(r.geo)}
      ${simple && r.geo ? mapEmbed(r.geo) : ''}
      <div class="muted">${nPhotos} fotos · ${nVideos} videos${r.coverPhoto ? ' · con foto de portada' : ''}</div>
      <div class="row wrap">
        <button class="primary" id="pdf">📄 PDF</button>
        ${nVideos ? '<button class="primary alt" id="send">📤 PDF + videos</button>' : ''}
        <button id="coverbtn">🖼 Portada</button>
        <button id="here">📍 Ubicación</button>
        <button id="settings">⚙️ Ajustes</button>
        <button id="more">⋯</button>
      </div>
    </section>
    ${simple ? simpleReportBody(r, items) : r.sections.map(s => {
      const its = items.filter(i => i.sectionId === s.id);
      return `<section class="section" data-sec="${s.id}">
        <div class="sec-head"><h2 class="grow">${esc(s.title)} <small>(${its.length})</small></h2><button data-a="secedit" title="Editar sección">✎</button></div>
        ${s.text ? `<p class="muted">${esc(s.text)}</p>` : ''}
        <div class="grid">${its.map(it => `
          <a class="thumb" href="#/i/${it.id}">
            ${(it.type === 'video' ? it.thumb : (it.annotated || it.blob)) ? `<img loading="lazy" src="${objUrl(it.type === 'video' ? it.thumb : (it.annotated || it.blob))}" alt="">` : '<div class="noimg">🎥</div>'}
            ${it.type === 'video' ? `<span class="vbadge">▶ ${fmtDur(it.duration)}</span>` : ''}
            ${it.shapes?.length ? '<span class="abadge">✎</span>' : ''}
            ${(it.caption || it.measure) ? `<span class="cap">${esc([it.caption, it.measure].filter(Boolean).join(' · ').replace(/\n+/g, ' · '))}</span>` : ''}
          </a>`).join('')}</div>
        <div class="row add-row">
          <button data-a="cam">📸 Ráfaga</button>
          <button data-a="photo">📷 Foto</button>
          <button data-a="video">🎥 Video</button>
          <button data-a="gallery">🖼 Galería</button>
        </div>
      </section>`;
    }).join('')}
    ${simple ? '' : '<button class="ghost wide" id="addsec">+ Agregar sección</button>'}`;
  if (simple) bindSimpleReport(r, items);

  view.querySelectorAll('.section').forEach(el => {
    const sid = el.dataset.sec;
    el.addEventListener('click', async e => {
      const b = e.target.closest('button[data-a]'); if (!b) return;
      const a = b.dataset.a;
      if (a === 'cam') { await openCamera(f => addMedia(r, sid, [f])); return route(); }
      if (a === 'photo') { const f = await pickFiles('image/*', { capture: true }); if (f.length) { await addMedia(r, sid, f); route(); } }
      if (a === 'video') { const f = await pickFiles('video/*', { capture: true }); if (f.length) { await addMedia(r, sid, f); route(); } }
      if (a === 'gallery') { const f = await pickFiles('image/*,video/*', { multiple: true }); if (f.length) { toast('Importando…'); await addMedia(r, sid, f); route(); } }
      if (a === 'secedit') {
        const s = r.sections.find(x => x.id === sid);
        const v = await form('Sección', [
          { name: 'title', label: 'Título', value: s.title, required: true },
          { name: 'text', label: 'Texto / párrafo (aparece en el PDF)', value: s.text, type: 'textarea' },
          { name: 'pos', label: 'Posición', type: 'select', value: 'same', options: [['same', 'Sin cambio'], ['up', 'Subir'], ['down', 'Bajar']] },
          { name: 'del', label: 'Eliminar sección (y sus elementos)', type: 'checkbox', value: false },
        ]);
        if (!v) return;
        const idx = r.sections.indexOf(s);
        if (v.del) {
          if (!confirm('¿Eliminar la sección y todo su contenido?')) return;
          for (const it of items.filter(i => i.sectionId === sid)) await DB.del('items', it.id);
          r.sections.splice(idx, 1);
          if (!r.sections.length) r.sections.push({ id: DB.uid(), title: 'General', text: '' });
        } else {
          Object.assign(s, { title: v.title, text: v.text });
          const to = v.pos === 'up' ? idx - 1 : v.pos === 'down' ? idx + 1 : idx;
          if (to >= 0 && to < r.sections.length && to !== idx) { r.sections.splice(idx, 1); r.sections.splice(to, 0, s); }
        }
        await DB.put('reports', r); route();
      }
    });
  });

  if ($('#addsec')) $('#addsec').onclick = async () => {
    const v = await form('Agregar secciones', [
      { name: 'title', label: 'Título de la nueva sección', value: '' },
      { name: 'tpl', label: 'o agregar desde plantilla', type: 'select', value: '', options: [['', '—'], ...Object.keys(SECTION_TEMPLATES).map(k => [k, k])] },
    ], 'Agregar');
    if (!v) return;
    const names = v.tpl ? SECTION_TEMPLATES[v.tpl] : v.title ? [v.title] : [];
    names.forEach(t => r.sections.push({ id: DB.uid(), title: t, text: '' }));
    await DB.put('reports', r); route();
  };

  $('#here').onclick = async e => {
    const g = await withLocation(e.target); if (!g) return;
    r.geo = g;
    await DB.put('reports', r); toast('Ubicación guardada en el reporte'); route();
  };
  $('#settings').onclick = async () => {
    const clientPart = simple && c ? [
      { name: 'cname', label: 'Nombre del cliente', value: c.name, required: true },
      { name: 'caddress', label: 'Dirección', value: c.address },
      { name: 'cresidential', label: 'Nombre del residencial', value: c.residential },
      { name: 'cphone', label: 'Teléfono', value: c.phone, type: 'tel' },
    ] : [];
    const v = await form('Ajustes del reporte', [
      ...clientPart,
      { name: 'title', label: 'Título', value: r.title, required: true },
      { name: 'location', label: 'Ubicación', value: r.location },
      { name: 'date', label: 'Fecha', type: 'date', value: new Date(r.date).toISOString().slice(0, 10) },
      { name: 'cover', label: 'Incluir portada', type: 'checkbox', value: r.cover !== false },
      { name: 'notes', label: 'Observaciones generales', value: r.notes, type: 'textarea' },
    ]);
    if (!v) return;
    Object.assign(r, {
      title: v.title, location: v.location, notes: v.notes, cover: v.cover,
      date: v.date ? new Date(v.date + 'T12:00').getTime() : r.date,
    });
    if (clientPart.length) {
      const oldName = c.name;
      Object.assign(c, { name: v.cname, address: v.caddress, residential: v.cresidential, phone: v.cphone, updatedAt: Date.now() });
      if (r.title === oldName) r.title = c.name;
      await DB.put('clients', c);
    }
    await DB.put('reports', r); route();
  };

  const entryCap = Object.fromEntries((r.entries || []).map(e => [e.id, e.caption]));
  const exportData = async () => ({ company: await DB.getSettings(), client: c || {}, report: r, sections: r.sections,
    items: [...items].sort((a, b) => a.order - b.order).map(i => (i.entryId in entryCap ? { ...i, caption: entryCap[i.entryId] } : i)) });
  const busy = async (btn, fn) => { btn.disabled = true; const t = btn.textContent; btn.textContent = 'Generando…'; try { await fn(); } catch (e) { console.error(e); toast('Error: ' + e.message, 5000); } btn.disabled = false; btn.textContent = t; };
  const base = Exporter.slug(r.title) || 'reporte';
  $('#pdf').onclick = e => busy(e.target, async () => {
    const { pdf } = await Exporter.buildPdf(await exportData());
    await shareOrDownload(pdf, `${base}.pdf`, r.title);
  });
  // PDF con las fotos + los videos como archivos aparte, enviados juntos (WhatsApp, correo…).
  if ($('#send')) $('#send').onclick = e => busy(e.target, async () => {
    const data = await exportData();
    const { pdf } = await Exporter.buildPdf(data);
    const files = [new File([pdf], `${base}.pdf`, { type: 'application/pdf' }), ...Exporter.videoFilesFor(data.items)];
    if (navigator.canShare && navigator.canShare({ files })) {
      try { await navigator.share({ files, title: r.title }); return; } catch (err) { if (err.name === 'AbortError') return; }
    }
    files.forEach(f => download(f, f.name));
  });
  $('#coverbtn').onclick = async () => {
    const opts = [['take', '📷 Tomar foto'], ['pick', '🖼 Elegir de galería']];
    if (r.coverPhoto) opts.push(['see', '👁 Ver portada actual'], ['del', 'Quitar foto de portada', 'danger']);
    const a = await actionSheet('Foto de portada', opts);
    if (a === 'take' || a === 'pick') {
      const [f] = await pickFiles('image/*', { capture: a === 'take' });
      if (f) { r.coverPhoto = f; await DB.put('reports', r); toast('Foto de portada guardada'); route(); }
    }
    if (a === 'see') openViewer(r.coverPhoto);
    if (a === 'del') { delete r.coverPhoto; await DB.put('reports', r); route(); }
  };
  $('#more').onclick = async () => {
    const v = await form('Más opciones', [{ name: 'act', label: 'Acción', type: 'select', value: 'share', options: [
      ['share', 'Compartir reporte editable (.rplus)'], ['dup', 'Duplicar reporte'], ['del', 'Eliminar reporte'],
    ] }], 'Aceptar');
    if (!v) return;
    if (v.act === 'share') {
      const blob = await Backup.exportBundle([c], [r], items);
      await shareOrDownload(blob, `${base}.rplus`, r.title);
    }
    if (v.act === 'dup') {
      const map = {};
      const copy = { ...r, id: DB.uid(), title: r.title + ' (copia)', date: Date.now(), sections: r.sections.map(s => { const n = { ...s, id: DB.uid() }; map[s.id] = n.id; return n; }) };
      await DB.put('reports', copy);
      for (const it of items) await DB.put('items', { ...it, id: DB.uid(), reportId: copy.id, sectionId: map[it.sectionId] });
      location.hash = `#/r/${copy.id}`;
    }
    if (v.act === 'del' && confirm('¿Eliminar este reporte con todas sus fotos y videos?')) {
      await DB.deleteReport(id); location.hash = simple ? '#/' : `#/c/${r.clientId}`;
    }
  };
}

// ---------- Reporte en modo simple: lista de fotos/videos con su texto al lado ----------
let currentArea = {};
function simpleReportBody(r, items) {
  const area = currentArea[r.id] && r.sections.some(s => s.id === currentArea[r.id]) ? currentArea[r.id] : r.sections[0].id;
  currentArea[r.id] = area;
  const entries = r.entries || [];
  const rows = [
    ...items.filter(i => !i.entryId || !entries.some(e => e.id === i.entryId)).map(i => ({ t: i.createdAt, html: row(i) })),
    ...entries.map(e => ({ t: e.createdAt, html: entryRow(e, items.filter(i => i.entryId === e.id).sort((a, b) => a.order - b.order)) })),
  ].sort((a, b) => a.t - b.t);
  function entryRow(e, its) {
    const thumbs = its.slice(0, 4).map(it => { const src = it.type === 'video' ? it.thumb : (it.annotated || it.blob); return `<span class="ithumb sm">${src ? `<img loading="lazy" src="${objUrl(src)}" alt="">` : '🎥'}</span>`; }).join('');
    return `<li class="irow"><div class="when">${fmtWhen(e.createdAt)} · 📸 Ráfaga</div>
      <a href="#/e/${r.id}/${e.id}" class="irow-main col-main">
        <span class="itext"><b>${esc(e.caption || 'Ráfaga')}</b> <span class="muted">(${its.length} ${its.length === 1 ? 'foto' : 'fotos'})</span></span>
        <span class="strip">${thumbs}${its.length > 4 ? `<span class="more">+${its.length - 4}</span>` : ''}</span>
      </a><button class="kebab" data-emenu="${e.id}" aria-label="Opciones">⋮</button></li>`;
  }
  function row(it) {
    const src = it.type === 'video' ? it.thumb : (it.annotated || it.blob);
    const text = [it.caption, it.measure].filter(Boolean).join('\n');
    return `<li class="irow"><div class="when">${fmtWhen(it.createdAt)}</div>
      <a href="#/i/${it.id}" class="irow-main">
        <span class="ithumb">${src ? `<img loading="lazy" src="${objUrl(src)}" alt="">` : '🎥'}${it.type === 'video' ? `<span class="vbadge">▶ ${fmtDur(it.duration)}</span>` : ''}</span>
        <span class="itext">${text ? esc(text) : '<span class="muted">Toca para agregar descripción y medidas</span>'}</span>
      </a><button class="kebab" data-imenu="${it.id}" aria-label="Opciones">⋮</button></li>`;
  }
  return `
    ${rows.length ? `<ul class="ilist">${rows.map(x => x.html).join('')}</ul>`
    : '<div class="empty"><p>Todavía no hay fotos ni videos.</p><p>Pulsa <b>+</b> para agregar fotos o videos.</p></div>'}
    <button class="fab" id="newItem" aria-label="Agregar foto o video">+</button>`;
}

// Ventana del botón +: área, descripción, medida y cómo capturar.
function newItemSheet(r) {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'sheet';
    const area = currentArea[r.id];
    d.innerHTML = `<form method="dialog"><h2>Agregar</h2>
      <label>Descripción<textarea name="caption" class="autogrow" rows="1" placeholder="Ej. Oficina"></textarea></label>
      <label>Nota / Medida <small>(en Ráfaga cada foto lleva la suya)</small><textarea name="measure" class="autogrow" rows="3" placeholder="Ej. 36 x 48&#10;Ventana 24 x 36"></textarea></label>
      <div class="cap-btns">
        <button type="button" data-a="cam">📸<small>Ráfaga</small></button>
        <button type="button" data-a="photo">📷<small>Foto</small></button>
        <button type="button" data-a="video">🎥<small>Video</small></button>
        <button type="button" data-a="gallery">🖼<small>Galería</small></button>
      </div>
      <div class="row end"><button value="cancel" formnovalidate>Cancelar</button></div>
    </form>`;
    document.body.appendChild(d);
    d.querySelectorAll('textarea.autogrow').forEach(el => el.addEventListener('input', () => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; }));
    let result = null;
    d.querySelector('.cap-btns').addEventListener('click', e => {
      const b = e.target.closest('button[data-a]'); if (!b) return;
      const action = b.dataset.a;
      // El selector de archivos se abre aquí mismo, dentro del toque, para que iPhone lo permita.
      const files = action === 'photo' ? pickFiles('image/*', { capture: true })
        : action === 'video' ? pickFiles('video/*', { capture: true })
        : action === 'gallery' ? pickFiles('image/*,video/*', { multiple: true }) : null;
      result = { action, files, sectionId: area, caption: d.querySelector('[name=caption]').value.trim(), measure: d.querySelector('[name=measure]').value.trim() };
      d.close();
    });
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    d.showModal();
  });
}

function bindSimpleReport(r, items) {
  $('#newItem').onclick = async () => {
    const v = await newItemSheet(r);
    if (!v) return;
    currentArea[r.id] = v.sectionId;
    const extra = { caption: v.caption, measure: v.measure };
    const sid = v.sectionId;
    if (v.action === 'cam') {
      const e = { id: DB.uid(), caption: v.caption, createdAt: Date.now() };
      let first = true;
      const n = await openCamera(f => {
        const m = first ? v.measure : ''; first = false;
        return addMedia(r, sid, [f], { entryId: e.id, measure: m });
      });
      if (!n) return route();
      r.entries = [...(r.entries || []), e];
      await DB.put('reports', r);
      location.hash = `#/e/${r.id}/${e.id}`;
      return;
    }
    const f = await v.files;
    if (f.length) { if (v.action === 'gallery') toast('Importando…'); await addMedia(r, sid, f, extra); route(); }
  };
  view.querySelectorAll('[data-emenu]').forEach(b => b.onclick = async () => {
    const e = r.entries.find(x => x.id === b.dataset.emenu);
    const a = await actionSheet(e.caption || 'Ráfaga', [['open', 'Abrir'], ['del', '🗑 Eliminar ráfaga completa', 'danger']]);
    if (a === 'open') location.hash = `#/e/${r.id}/${e.id}`;
    if (a === 'del' && confirm('¿Eliminar esta ráfaga con todas sus fotos?')) {
      for (const it of items.filter(i => i.entryId === e.id)) await DB.del('items', it.id);
      r.entries = r.entries.filter(x => x !== e); await DB.put('reports', r); route();
    }
  });
  view.querySelectorAll('[data-imenu]').forEach(b => b.onclick = async () => {
    const it = items.find(x => x.id === b.dataset.imenu);
    const opts = [['open', 'Abrir'], ['del', '🗑 Eliminar', 'danger']];
    const a = await actionSheet(it.type === 'video' ? 'Video' : 'Foto', opts);
    if (a === 'open') location.hash = `#/i/${it.id}`;
    if (a === 'area') {
      const v = await form('Cambiar de área', [{ name: 's', label: 'Área', type: 'select', value: it.sectionId, options: r.sections.map(s => [s.id, s.title]) }]);
      if (v) { it.sectionId = v.s; await DB.put('items', it); route(); }
    }
    if (a === 'del' && confirm('¿Eliminar este elemento?')) { await DB.del('items', it.id); route(); }
  });
}

// Ráfaga: una descripción (ej. "Cocina") y cada foto con su propia medida.
async function viewEntry(rid, eid) {
  const r = await DB.get('reports', rid);
  const e = r && (r.entries || []).find(x => x.id === eid);
  if (!e) return (location.hash = r ? `#/r/${rid}` : '#/');
  setHeader(e.caption || 'Ráfaga', `#/r/${rid}`);
  const its = (await DB.byIndex('items', 'reportId', rid)).filter(i => i.entryId === eid).sort((a, b) => a.order - b.order);
  view.innerHTML = `
    <section class="card">
      <label>Descripción<textarea id="ecap" class="autogrow" rows="1" placeholder="Ej. Cocina">${esc(e.caption)}</textarea></label>
    </section>
    <ul class="blist">${its.map((it, n) => {
      const src = it.type === 'video' ? it.thumb : (it.annotated || it.blob);
      return `<li class="card bitem" data-id="${it.id}">
        <div class="bhead"><b>${it.type === 'video' ? 'Video' : 'Foto'} ${n + 1}</b><button class="kebab" data-bdel="${it.id}" aria-label="Eliminar">🗑</button></div>
        <a href="#/i/${it.id}" class="bmedia">${src ? `<img loading="lazy" src="${objUrl(src)}" alt="">` : '🎥'}${it.type === 'video' ? `<span class="vbadge">▶ ${fmtDur(it.duration)}</span>` : ''}</a>
        <label>Nota / Medida<textarea class="autogrow bmeasure" rows="1" placeholder="Ej. 36 x 48">${esc(it.measure)}</textarea></label>
      </li>`;
    }).join('')}</ul>
    ${its.length ? '' : '<div class="empty"><p>Sin fotos todavía.</p></div>'}
    <div class="cap-btns entry-add">
      <button data-a="cam">📸<small>Más ráfaga</small></button>
      <button data-a="photo">📷<small>Foto</small></button>
      <button data-a="video">🎥<small>Video</small></button>
      <button data-a="gallery">🖼<small>Galería</small></button>
    </div>`;
  const grow = el => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; };
  const ecap = $('#ecap');
  grow(ecap);
  ecap.addEventListener('input', () => { grow(ecap); setHeader(ecap.value.trim() || 'Ráfaga', `#/r/${rid}`); clearTimeout(ecap.t); ecap.t = setTimeout(async () => { e.caption = ecap.value.trim(); await DB.put('reports', r); }, 400); });
  view.querySelectorAll('.bitem').forEach(li => {
    const it = its.find(x => x.id === li.dataset.id);
    const ta = $('.bmeasure', li);
    grow(ta);
    ta.addEventListener('input', () => { grow(ta); clearTimeout(ta.t); ta.t = setTimeout(() => { it.measure = ta.value.trim(); DB.put('items', it); }, 400); });
  });
  view.querySelectorAll('[data-bdel]').forEach(b => b.onclick = async () => {
    if (!confirm('¿Eliminar esta foto?')) return;
    await DB.del('items', b.dataset.bdel); route();
  });
  const sid = r.sections[0].id;
  $('.entry-add').addEventListener('click', async ev => {
    const b = ev.target.closest('button[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'cam') { await openCamera(f => addMedia(r, sid, [f], { entryId: eid })); return route(); }
    const f = await (a === 'photo' ? pickFiles('image/*', { capture: true })
      : a === 'video' ? pickFiles('video/*', { capture: true })
      : pickFiles('image/*,video/*', { multiple: true }));
    if (f.length) { await addMedia(r, sid, f, { entryId: eid }); route(); }
  });
}

async function viewItem(id) {
  const it = await DB.get('items', id);
  if (!it) return history.back();
  const r = await DB.get('reports', it.reportId);
  const siblings = (await DB.byIndex('items', 'reportId', r.id)).sort((a, b) => a.order - b.order);
  const idx = siblings.findIndex(s => s.id === id);
  const inEntry = it.entryId && (r.entries || []).some(e => e.id === it.entryId);
  setHeader(it.type === 'video' ? 'Video' : 'Foto', inEntry ? `#/e/${r.id}/${it.entryId}` : `#/r/${r.id}`);
  const media = it.type === 'video'
    ? `<video controls playsinline src="${objUrl(it.blob)}" ${it.thumb ? `poster="${objUrl(it.thumb)}"` : ''}></video>`
    : `<img src="${objUrl(it.annotated || it.blob)}" alt="">`;
  view.innerHTML = `
    <div class="media">${media}</div>
    <div class="row wrap">
      ${it.type === 'photo' ? '<button class="primary" id="annot">✎ Anotar / medir</button>' : '<button id="rethumb">🖼 Cambiar miniatura</button>'}
      <button id="prev" ${idx <= 0 ? 'disabled' : ''}>‹ Anterior</button>
      <button id="next" ${idx >= siblings.length - 1 ? 'disabled' : ''}>Siguiente ›</button>
    </div>
    <section class="card">
      <label ${inEntry ? 'hidden' : ''}>Descripción<textarea id="caption" class="autogrow" rows="1" placeholder="Ej. Oficina">${esc(it.caption)}</textarea></label>
      <label>Nota / Medida<textarea id="measure" class="autogrow" rows="3" placeholder="Ej. 36 x 48&#10;Ventana 24 x 36">${esc(it.measure)}</textarea></label>
      <label ${r.sections.length > 1 ? '' : 'hidden'}>Sección<select id="section">${r.sections.map(s => `<option value="${s.id}" ${s.id === it.sectionId ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}</select></label>
      <div class="row wrap">
        <button id="up">↑ Mover antes</button><button id="down">↓ Mover después</button>
        ${it.type === 'photo' ? '<button id="cover">☆ Usar en portada</button>' : ''}
        <button id="save1">⬇ Descargar archivo</button>
        <button id="del" class="danger">Eliminar</button>
      </div>
    </section>`;

  const save = async () => {
    it.caption = $('#caption').value.trim(); it.measure = $('#measure').value.trim(); it.sectionId = $('#section').value;
    await DB.put('items', it);
  };
  let saveTimer;
  ['caption', 'measure'].forEach(k => {
    const el = $('#' + k);
    const grow = () => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; };
    grow();
    el.addEventListener('input', () => { grow(); clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); });
    el.addEventListener('change', save);
  });
  $('#section').addEventListener('change', save);
  const mediaImg = $('.media img');
  if (mediaImg) mediaImg.onclick = () => openViewer(it.annotated || it.blob);
  const go = async to => { await save(); location.hash = `#/i/${siblings[to].id}`; };
  $('#prev').onclick = () => go(idx - 1);
  $('#next').onclick = () => go(idx + 1);
  const swap = async d => {
    await save();
    const same = siblings.filter(s => s.sectionId === it.sectionId);
    const j = same.findIndex(s => s.id === id) + d;
    if (j < 0 || j >= same.length) return;
    const other = same[j];
    [it.order, other.order] = [other.order, it.order];
    await DB.put('items', it); await DB.put('items', other); toast('Movido');
  };
  $('#up').onclick = () => swap(-1);
  $('#down').onclick = () => swap(1);
  $('#save1').onclick = () => download(it.type === 'photo' ? (it.annotated || it.blob) : it.blob, `${it.type}_${it.id}.${(it.blob.type.split('/')[1] || 'bin').split(';')[0]}`);
  $('#del').onclick = async () => {
    if (!confirm('¿Eliminar este elemento?')) return;
    await DB.del('items', id); location.hash = inEntry ? `#/e/${r.id}/${it.entryId}` : `#/r/${r.id}`;
  };
  if ($('#cover')) $('#cover').onclick = async () => { r.coverPhoto = it.annotated || it.blob; await DB.put('reports', r); toast('Se usará en la portada'); };
  if ($('#annot')) $('#annot').onclick = async () => {
    await save();
    const res = await Annotator.open(it.blob, it.shapes || []);
    if (!res) return;
    it.shapes = res.shapes; it.annotated = res.blob;
    await DB.put('items', it); route();
  };
  if ($('#rethumb')) $('#rethumb').onclick = async () => {
    const v = $('.media video');
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    it.thumb = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
    await DB.put('items', it); toast('Miniatura tomada del momento actual del video');
  };
}

async function viewSettings() {
  setHeader('Mi empresa', '#/');
  const s = await DB.getSettings();
  view.innerHTML = `
    <section class="card">
      <p class="muted">Estos datos aparecen en la portada y encabezado de tus reportes.</p>
      <div class="logo-box">${s.logo ? `<img src="${objUrl(s.logo)}" alt="Logo">` : '<span class="muted">Sin logo</span>'}</div>
      <div class="row"><button id="logo">Elegir logo</button>${s.logo ? '<button id="nologo">Quitar</button>' : ''}</div>
      <label>Empresa<input id="name" value="${esc(s.name)}"></label>
      <label>Persona de contacto<input id="contact" value="${esc(s.contact)}"></label>
      <label>Teléfono<input id="phone" type="tel" value="${esc(s.phone)}"></label>
      <label>Correo<input id="email" type="email" value="${esc(s.email)}"></label>
      <button class="primary wide" id="save">Guardar</button>
    </section>
    <section class="card">
      <h2>Respaldo</h2>
      <p class="muted">Todo se guarda solo en este teléfono. Haz respaldos para no perder tus reportes, o para pasarlos a otro equipo.</p>
      <div class="row wrap"><button id="backup">⬇ Crear respaldo</button><button id="restore">⬆ Restaurar / importar .rplus</button></div>
      <p class="muted" id="usage"></p>
    </section>`;
  $('#logo').onclick = async () => { const [f] = await pickFiles('image/*'); if (f) { s.logo = f; await DB.saveSettings(s); route(); } };
  if ($('#nologo')) $('#nologo').onclick = async () => { s.logo = null; await DB.saveSettings(s); route(); };
  $('#save').onclick = async () => {
    ['name', 'contact', 'phone', 'email'].forEach(k => { s[k] = $('#' + k).value.trim(); });
    await DB.saveSettings(s); toast('Guardado');
  };
  $('#backup').onclick = async e => {
    e.target.disabled = true; toast('Creando respaldo…');
    const blob = await Backup.exportBundle(await DB.all('clients'), await DB.all('reports'), await DB.all('items'), s);
    download(blob, `reportplus_respaldo_${new Date().toISOString().slice(0, 10)}.rplus`);
    e.target.disabled = false;
  };
  $('#restore').onclick = async () => {
    const [f] = await pickFiles('.rplus,.zip,application/zip');
    if (!f) return;
    const n = await Backup.importBundle(f);
    toast(`Importados ${n.clients} cliente(s) y ${n.reports} reporte(s)`); location.hash = '#/';
  };
  if (navigator.storage?.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    $('#usage').textContent = `Espacio usado: ${(usage / 1e6).toFixed(1)} MB de ${(quota / 1e9).toFixed(1)} GB disponibles.`;
    navigator.storage.persist?.();
  }
}

// ---------- Respaldo / compartir editable ----------
const Backup = {
  async exportBundle(clients, reports, items, settings) {
    const zip = new JSZip();
    const blobs = zip.folder('blobs');
    const strip = it => {
      const o = { ...it };
      for (const k of ['blob', 'annotated', 'thumb']) if (o[k]) { const name = `${it.id}_${k}`; blobs.file(name, o[k]); o[k] = { file: name, type: o[k].type }; }
      return o;
    };
    const data = { app: 'reportplus', version: 1, clients, reports, items: items.map(strip) };
    if (settings) {
      data.settings = { ...settings, logo: null };
      if (settings.logo) { blobs.file('logo', settings.logo); data.settings.logo = { file: 'logo', type: settings.logo.type }; }
    }
    zip.file('data.json', JSON.stringify(data));
    return zip.generateAsync({ type: 'blob' });
  },
  async importBundle(file) {
    const zip = await JSZip.loadAsync(file);
    const data = JSON.parse(await zip.file('data.json').async('string'));
    const load = async ref => ref ? new Blob([await zip.file('blobs/' + ref.file).async('arraybuffer')], { type: ref.type }) : null;
    for (const c of data.clients) await DB.put('clients', c);
    for (const r of data.reports) await DB.put('reports', r);
    for (const it of data.items) {
      for (const k of ['blob', 'annotated', 'thumb']) it[k] = await load(it[k]);
      await DB.put('items', it);
    }
    if (data.settings) { data.settings.logo = await load(data.settings.logo); await DB.saveSettings(data.settings); }
    return { clients: data.clients.length, reports: data.reports.length };
  },
};

// ---------- Router ----------
async function route() {
  urls.splice(0).forEach(u => URL.revokeObjectURL(u));
  const [, kind, id, id2] = location.hash.split('/');
  try {
    if (kind === 'c') await viewClient(id);
    else if (kind === 'f') await viewHome(id);
    else if (kind === 'r') await viewReport(id);
    else if (kind === 'i') await viewItem(id);
    else if (kind === 'e') await viewEntry(id, id2);
    else if (kind === 'settings') await viewSettings();
    else if (kind === 'clientes') await viewClients();
    else await viewHome();
  } catch (e) { console.error(e); view.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`; }
  window.scrollTo(0, 0);
}
['gesturestart', 'gesturechange'].forEach(t => document.addEventListener(t, e => e.preventDefault()));
$('#settingsBtn').onclick = () => { location.hash = '#/settings'; };
window.addEventListener('hashchange', route);
route();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
