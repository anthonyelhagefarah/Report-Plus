// Report Plus: reportes de inspección por cliente con fotos, videos, medidas y PDF.
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const urls = [];
const objUrl = blob => { const u = URL.createObjectURL(blob); urls.push(u); return u; };
const fmtDate = t => new Date(t).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtDur = s => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '';

const SECTION_TEMPLATES = {
  'Vivienda': ['Fachada', 'Sala', 'Cocina', 'Baños', 'Dormitorios', 'Techo', 'Exteriores'],
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

async function addMedia(report, sectionId, files) {
  const existing = await DB.byIndex('items', 'reportId', report.id);
  let order = existing.length;
  for (const f of files) {
    const isVideo = f.type.startsWith('video');
    const item = { id: DB.uid(), reportId: report.id, sectionId, type: isVideo ? 'video' : 'photo', blob: f, caption: '', measure: '', shapes: [], order: order++, createdAt: Date.now() };
    if (isVideo) Object.assign(item, await videoThumb(f));
    await DB.put('items', item);
  }
  toast(`${files.length} elemento(s) agregado(s)`);
}

// Ubicación GPS actual + dirección aproximada (OpenStreetMap).
function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Este teléfono no permite obtener la ubicación'));
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      let address = '', residential = '';
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=es`);
        const j = await r.json();
        const a = j.address || {};
        residential = a.residential || a.neighbourhood || a.suburb || a.quarter || '';
        address = [[a.road, a.house_number].filter(Boolean).join(' '), a.suburb || a.neighbourhood, a.city || a.town || a.village, a.state].filter(Boolean).join(', ') || j.display_name || '';
      } catch (e) { /* sin internet: se guardan solo las coordenadas */ }
      resolve({ residential: residential, lat: +lat.toFixed(6), lng: +lng.toFixed(6), accuracy: Math.round(accuracy), address: address || `${lat.toFixed(6)}, ${lng.toFixed(6)}`, at: Date.now() });
    }, err => reject(new Error(err.code === 1 ? 'Permiso de ubicación denegado. Actívalo en los ajustes del navegador.' : 'No se pudo obtener la ubicación')), { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
  });
}
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
async function viewClients() {
  setHeader('Clientes');
  const clients = (await DB.all('clients')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const reports = await DB.all('reports');
  view.innerHTML = `
    <div class="toolbar"><input type="search" id="q" placeholder="Buscar cliente…"><button class="primary" id="add">+ Cliente</button></div>
    <ul class="list" id="list">
      ${clients.map(c => `<li data-name="${esc(c.name.toLowerCase())}"><a href="#/c/${c.id}">
        <div class="avatar">${esc(c.name.slice(0, 1).toUpperCase())}</div>
        <div class="grow"><b>${esc(c.name)}</b><small>${esc([c.address, c.residential].filter(Boolean).join(' · ') || c.phone || '')}</small></div>
        <span class="badge">${reports.filter(r => r.clientId === c.id).length}</span></a></li>`).join('')}
    </ul>
    ${clients.length ? '' : `<div class="empty"><p>Aún no tienes clientes.</p><p>Crea uno para empezar tu primer reporte con fotos y videos.</p></div>`}`;
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
    if (c.address && !confirm(`¿Reemplazar la dirección del cliente por:\n${g.address}?`)) { c.geo = g; } else { c.address = g.address; c.geo = g; }
    if (!c.residential && g.residential) c.residential = g.residential;
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
        if (!r.location) r.location = r.geo.address;
        if (!c.address) { c.address = r.geo.address; c.geo = r.geo; }
        if (!c.residential && r.geo.residential) c.residential = r.geo.residential;
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
  setHeader(r.title, `#/c/${r.clientId}`);
  const items = (await DB.byIndex('items', 'reportId', id)).sort((a, b) => a.order - b.order);
  const nPhotos = items.filter(i => i.type === 'photo').length, nVideos = items.length - nPhotos;
  const L = r.layout;
  view.innerHTML = `
    <section class="card summary">
      <div><b>${esc(c?.name)}</b> · ${fmtDate(r.date)}${r.location ? ' · ' + esc(r.location) : ''}</div>
      ${c?.residential ? `<div>🏘 ${esc(c.residential)}</div>` : ''}
      ${geoLine(r.geo)}
      <div class="muted">${nPhotos} fotos · ${nVideos} videos · ${esc(LAYOUTS.find(l => l[0] === L.orientation && l[1] === L.cols && l[2] === L.rows)?.[3] || '')}</div>
      <div class="row wrap">
        <button class="primary" id="pdf">📄 PDF</button>
        <button class="primary alt" id="zip">📦 PDF + videos (ZIP)</button>
        <button id="here">📍 Ubicación</button>
        <button id="settings">⚙️ Ajustes</button>
        <button id="more">⋯</button>
      </div>
    </section>
    ${r.sections.map(s => {
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
    <button class="ghost wide" id="addsec">+ Agregar sección</button>`;

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

  $('#addsec').onclick = async () => {
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
    if (!r.location || confirm(`¿Usar esta dirección en el reporte?\n${g.address}`)) r.location = g.address;
    await DB.put('reports', r); toast('Ubicación guardada en el reporte'); route();
  };
  $('#settings').onclick = async () => {
    const v = await form('Ajustes del reporte', [
      { name: 'title', label: 'Título', value: r.title, required: true },
      { name: 'location', label: 'Ubicación', value: r.location },
      { name: 'date', label: 'Fecha', type: 'date', value: new Date(r.date).toISOString().slice(0, 10) },
      { name: 'layout', label: 'Diseño de página', type: 'select', value: `${L.orientation}|${L.cols}|${L.rows}`, options: LAYOUTS.map(l => [`${l[0]}|${l[1]}|${l[2]}`, l[3]]) },
      { name: 'cover', label: 'Incluir portada', type: 'checkbox', value: r.cover !== false },
      { name: 'coverImage', label: 'Foto en la portada', type: 'checkbox', value: r.coverImage !== false },
      { name: 'notes', label: 'Observaciones generales', value: r.notes, type: 'textarea' },
    ]);
    if (!v) return;
    const [orientation, cols, rows] = v.layout.split('|');
    Object.assign(r, {
      title: v.title, location: v.location, notes: v.notes, cover: v.cover, coverImage: v.coverImage,
      date: v.date ? new Date(v.date + 'T12:00').getTime() : r.date, layout: { orientation, cols: +cols, rows: +rows },
    });
    await DB.put('reports', r); route();
  };

  const exportData = async () => ({ company: await DB.getSettings(), client: c || {}, report: r, sections: r.sections, items: r.sections.flatMap(s => items.filter(i => i.sectionId === s.id)) });
  const busy = async (btn, fn) => { btn.disabled = true; const t = btn.textContent; btn.textContent = 'Generando…'; try { await fn(); } catch (e) { console.error(e); toast('Error: ' + e.message, 5000); } btn.disabled = false; btn.textContent = t; };
  const base = Exporter.slug(r.title) || 'reporte';
  $('#pdf').onclick = e => busy(e.target, async () => {
    const { pdf } = await Exporter.buildPdf(await exportData());
    await shareOrDownload(pdf, `${base}.pdf`, r.title);
  });
  $('#zip').onclick = e => busy(e.target, async () => {
    const zip = await Exporter.buildZip(await exportData());
    await shareOrDownload(zip, `${base}.zip`, r.title);
  });
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
      await DB.deleteReport(id); location.hash = `#/c/${r.clientId}`;
    }
  };
}

async function viewItem(id) {
  const it = await DB.get('items', id);
  if (!it) return history.back();
  const r = await DB.get('reports', it.reportId);
  const siblings = (await DB.byIndex('items', 'reportId', r.id)).sort((a, b) => a.order - b.order);
  const idx = siblings.findIndex(s => s.id === id);
  setHeader(it.type === 'video' ? 'Video' : 'Foto', `#/r/${r.id}`);
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
      <label>Descripción<textarea id="caption" class="autogrow" rows="1" placeholder="Ej. Oficina">${esc(it.caption)}</textarea></label>
      <label>Medidas <small>(una por línea)</small><textarea id="measure" class="autogrow" rows="3" placeholder="Ej. 36 x 48&#10;Ventana 24 x 36">${esc(it.measure)}</textarea></label>
      <label>Sección<select id="section">${r.sections.map(s => `<option value="${s.id}" ${s.id === it.sectionId ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}</select></label>
      <div class="row wrap">
        <button id="up">↑ Mover antes</button><button id="down">↓ Mover después</button>
        ${it.type === 'photo' ? `<button id="cover">${r.coverItemId === it.id ? '★ Es portada' : '☆ Usar en portada'}</button>` : ''}
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
    await DB.del('items', id); location.hash = `#/r/${r.id}`;
  };
  if ($('#cover')) $('#cover').onclick = async () => { r.coverItemId = it.id; await DB.put('reports', r); toast('Se usará en la portada'); route(); };
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
  const [, kind, id] = location.hash.split('/');
  try {
    if (kind === 'c') await viewClient(id);
    else if (kind === 'r') await viewReport(id);
    else if (kind === 'i') await viewItem(id);
    else if (kind === 'settings') await viewSettings();
    else await viewClients();
  } catch (e) { console.error(e); view.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`; }
  window.scrollTo(0, 0);
}
['gesturestart', 'gesturechange'].forEach(t => document.addEventListener(t, e => e.preventDefault()));
$('#settingsBtn').onclick = () => { location.hash = '#/settings'; };
window.addEventListener('hashchange', route);
route();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
