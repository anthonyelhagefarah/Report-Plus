// Report Plus: reportes de inspección por cliente con fotos, videos, medidas y PDF.
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const urls = [];
const objUrl = blob => { const u = URL.createObjectURL(blob); urls.push(u); return u; };
const fmtDate = t => new Date(t).toLocaleDateString(I18N.lang, { day: '2-digit', month: 'short', year: 'numeric' });
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
function form(title, fields, okText = tr('Guardar')) {
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
      <div class="row end"><button value="cancel" formnovalidate>${tr('Cancelar')}</button><button value="ok" class="primary">${esc(okText)}</button></div>
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
    // En la página (no suelto en memoria): si no, el iPhone a veces pierde la foto al volver de la cámara.
    // Dentro de la ventana abierta, si hay una: lo que queda detrás de una ventana no responde en el iPhone.
    inp.className = 'file-hidden'; ([...document.querySelectorAll('dialog[open]')].pop() || document.body).appendChild(inp);
    const done = files => { inp.remove(); resolve(files); };
    inp.onchange = () => done([...inp.files]);
    inp.addEventListener('cancel', () => done([]));
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

// Copia real del archivo: en el iPhone, guardar la foto "tal cual" la deja ligada a un archivo temporal
// que el sistema borra después, y la foto se pierde. La copia queda guardada dentro de la app.
async function keep(f) {
  if (!f) return f;
  try { return new Blob([await f.arrayBuffer()], { type: f.type || 'image/jpeg' }); } catch (e) { console.warn(e); return f; }
}

async function addMedia(report, sectionId, files, extra = {}) {
  const existing = await DB.byIndex('items', 'reportId', report.id);
  let order = existing.length;
  const ids = [];
  for (let f of files) {
    const isVideo = f.type.startsWith('video');
    f = await keep(f);
    const item = { id: DB.uid(), reportId: report.id, sectionId, type: isVideo ? 'video' : 'photo', blob: f, caption: '', measure: '', shapes: [], order: order++, createdAt: Date.now(), ...extra };
    if (isVideo) Object.assign(item, await videoThumb(f));
    await DB.put('items', item);
    ids.push(item.id);
  }
  toast(tr('{n} elemento(s) agregado(s)', { n: files.length }));
  return ids;
}

// Ubicación GPS actual + dirección aproximada (OpenStreetMap).
function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error(tr('Este teléfono no permite obtener la ubicación')));
    // Solo coordenadas: la dirección y el residencial los escribe el usuario.
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      resolve({ lat: +lat.toFixed(6), lng: +lng.toFixed(6), accuracy: Math.round(accuracy), at: Date.now() });
    }, err => reject(new Error(tr(err.code === 1 ? 'Permiso de ubicación denegado. Actívalo en los ajustes del navegador.' : 'No se pudo obtener la ubicación'))), { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
  });
}
const mapEmbed = g => { if (!navigator.onLine) return `<div class="map map-off">${ic('pin')} ${tr('Mapa disponible con conexión')}</div>`; const k = 0.0025; return `<iframe class="map" loading="lazy" title="${tr('Mapa')}" src="https://www.openstreetmap.org/export/embed.html?bbox=${g.lng - k},${g.lat - k},${g.lng + k},${g.lat + k}&layer=mapnik&marker=${g.lat},${g.lng}"></iframe>`; };
const mapUrl = g => `https://www.google.com/maps?q=${g.lat},${g.lng}`;
const geoLine = g => g ? `<div>${ic('satellite')} <a href="${mapUrl(g)}" target="_blank" rel="noopener">${g.lat}, ${g.lng}</a> <small class="muted">(±${g.accuracy} m · ${tr('ver en mapa')})</small></div>` : '';

async function withLocation(btn) {
  const t = btn.innerHTML; btn.disabled = true; btn.textContent = tr('Buscando ubicación…');
  try { return await getLocation(); } catch (e) { toast(e.message, 5000); return null; } finally { btn.disabled = false; btn.innerHTML = t; }
}

const busy = async (btn, fn) => { btn.disabled = true; const t = btn.innerHTML; btn.textContent = tr('Generando…'); try { await fn(); } catch (e) { console.error(e); toast(tr('Error:') + ' ' + (e?.message || tr('inténtalo de nuevo')), 5000); } btn.disabled = false; btn.innerHTML = t; };

// Enviar: primero el PDF y, si hay videos, después los videos como archivos aparte
// (WhatsApp no acepta PDF y video en el mismo envío, por eso van en dos pasos).
async function sendReportPdf(r) {
  const c = await DB.get('clients', r.clientId);
  const items = (await DB.byIndex('items', 'reportId', r.id)).sort((a, b) => a.order - b.order);
  const entryCap = Object.fromEntries((r.entries || []).map(e => [e.id, e.caption]));
  const data = { company: await DB.getSettings(), client: c || {}, report: r, sections: r.sections,
    items: items.map(i => (i.entryId in entryCap ? { ...i, caption: entryCap[i.entryId] } : i)) };
  const { pdf } = await Exporter.buildPdf(data);
  const videos = Exporter.videoFilesFor(data.items, c?.name || r.title);
  await shareOrDownload(pdf, Exporter.pdfName(data.client, r), r.title);
  if (videos.length) await sendVideosStep(videos, r.title);
}

// Deslizar una fila: hacia la izquierda aparece Borrar (rojo); hacia la derecha, Enviar (verde) si la fila lo tiene.
let openSwipe = null;
function swipeRow(li, { del, send }) {
  const front = document.createElement('div');
  front.className = 'swipe-front ' + li.className;
  front.append(...li.childNodes);
  li.className = 'swipe-wrap' + (front.classList.contains('irow') ? ' card-wrap' : '');
  const W = 92;
  li.insertAdjacentHTML('afterbegin', (send ? `<button class="swipe-act send" aria-label="${tr('Enviar')}"><span class="swipe-in">${ic('forward')}<small>${tr('Enviar')}</small></span></button>` : '')
    + `<button class="swipe-act del" aria-label="${tr('Eliminar')}"><span class="swipe-in">${ic('trash')}<small>${tr('Eliminar')}</small></span></button>`);
  li.appendChild(front);
  const actDel = li.querySelector('.swipe-act.del'), actSend = li.querySelector('.swipe-act.send');
  let x0, y0, t0, lastX, lastT, vx = 0, dx = 0, base = 0, drag = null, raf = 0;
  // Resistencia elástica al pasar del ancho del botón, como en el iPhone.
  const rubber = x => { const a = Math.abs(x); return a <= W ? x : Math.sign(x) * (W + (a - W) * 0.35); };
  const paint = (x, anim) => {
    const ease = anim ? 'transform .45s cubic-bezier(.2,.9,.25,1)' : 'none';
    front.style.transition = ease; front.style.transform = `translate3d(${x}px,0,0)`;
    // La tira de color crece con el dedo y el ícono aparece poco a poco.
    for (const [el, side] of [[actDel, -1], [actSend, 1]]) {
      if (!el) continue;
      const w = Math.max(0, x * side), k = Math.min(1, w / W);
      el.style.transition = anim ? 'width .45s cubic-bezier(.2,.9,.25,1)' : 'none';
      el.style.width = w + 'px';
      const inn = el.firstElementChild;
      inn.style.transition = anim ? 'opacity .3s, transform .45s cubic-bezier(.2,.9,.25,1)' : 'none';
      inn.style.opacity = k; inn.style.transform = `scale(${0.6 + 0.4 * k})`;
    }
  };
  const settle = x => { base = x; paint(x, true); openSwipe = x ? close : (openSwipe === close ? null : openSwipe); };
  const close = () => settle(0);
  front.addEventListener('touchstart', e => {
    if (openSwipe && openSwipe !== close) openSwipe();
    x0 = lastX = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = lastT = e.timeStamp; vx = 0; dx = base; drag = null;
  }, { passive: true });
  front.addEventListener('touchmove', e => {
    const cx = e.touches[0].clientX, mx = cx - x0, my = e.touches[0].clientY - y0;
    if (drag === null && (Math.abs(mx) > 6 || Math.abs(my) > 6)) drag = Math.abs(mx) > Math.abs(my) * 1.2;
    if (!drag) return;
    e.preventDefault();
    if (e.timeStamp > lastT) { vx = 0.8 * ((cx - lastX) / (e.timeStamp - lastT)) + 0.2 * vx; lastX = cx; lastT = e.timeStamp; }
    let x = base + mx;
    if (!send && x > 0) x = x * 0.15; // sin acción a la derecha: solo un pequeño rebote
    dx = rubber(x);
    cancelAnimationFrame(raf); raf = requestAnimationFrame(() => paint(dx));
  }, { passive: false });
  front.addEventListener('touchend', () => {
    if (!drag) return;
    cancelAnimationFrame(raf);
    // Un movimiento rápido también abre o cierra, aunque sea corto.
    const fling = Math.abs(vx) > 0.4 ? Math.sign(vx) : 0;
    let to = 0;
    if (fling < 0 || (!fling && dx < -W / 2)) to = base > 0 ? 0 : -W;
    else if (fling > 0 || (!fling && dx > W / 2)) to = base < 0 ? 0 : (send ? W : 0);
    settle(to);
  });
  // Con la fila abierta, tocarla solo la cierra (no abre el reporte).
  front.addEventListener('click', e => { if (base) { e.preventDefault(); e.stopPropagation(); close(); } }, true);
  actDel.onclick = async () => { close(); await del(); };
  if (send) actSend.onclick = async () => {
    close(); toast(tr('Generando…'));
    try { await send(); } catch (e) { console.error(e); toast(tr('Error:') + ' ' + (e?.message || tr('inténtalo de nuevo')), 5000); }
  };
  paint(0);
}

// Segundo paso del envío: un toque más para compartir los videos (el teléfono exige un toque por envío).
function sendVideosStep(videos, title) {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'sheet actions';
    d.innerHTML = `<form method="dialog"><h2>${videos.length === 1 ? tr('Ahora envía el video') : tr('Ahora envía los {n} videos', { n: videos.length })}</h2>
      <p class="muted small">${videos.map(v => esc(v.name)).join('<br>')}</p>
      <button type="button" class="wide primary" id="sv">${ic('video')} ${tr(videos.length === 1 ? 'Enviar video' : 'Enviar videos')}</button>
      <button value="" class="wide ghost">${tr('Ahora no')}</button></form>`;
    document.body.appendChild(d);
    $('#sv', d).onclick = async () => {
      if (navigator.canShare && navigator.canShare({ files: videos })) {
        try { await navigator.share({ files: videos, title }); } catch (err) { /* cancelado */ }
      } else videos.forEach(v => download(v, v.name));
      d.close();
    };
    d.addEventListener('close', () => { d.remove(); resolve(); });
    d.showModal();
  });
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
      <div class="cam-top"><button data-a="close">${tr('Listo')}</button><span class="cam-count">0</span><button data-a="flip">⟲</button></div>
      <div class="cam-rec" hidden>● <span>0:00</span></div>
      <div class="cam-bottom">
        <div class="cam-modes"><button data-m="photo" class="on">${tr('FOTO')}</button><button data-m="video">${tr('VIDEO')}</button></div>
        <button class="shutter" data-a="shoot" aria-label="${tr('Capturar')}"></button>
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
        toast(tr('No se pudo abrir la cámara. Usa los botones Foto/Video del sistema.'), 4000);
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
  ov.innerHTML = `<img src="${url}" alt="" draggable="false"><button class="viewer-close" aria-label="${tr('Cerrar')}">${ic('xcircle')}</button><div class="viewer-hint">${tr('Pellizca para ampliar · doble toque para acercar')}</div>`;
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
    d.innerHTML = `<form method="dialog"><h2>${tr('Nuevo cliente')}</h2>
      <label>${tr('Nombre del cliente')}<input name="name" required></label>
      <label>${tr('Sector / Descripción')}<input name="address"></label>
      <label>${tr('Nombre del residencial')}<input name="residential"></label>
      <label>${tr('Ubicación en el mapa')}</label>
      <button type="button" id="qgps" class="wide">${ic('pin')} ${tr('Guardar mi ubicación actual')}</button>
      <div id="qgeo" class="muted small"></div>
      <div id="qmap"></div>
      <label>${tr('Foto de portada')} <small>(${tr('opcional')})</small></label>
      <div class="row cover-pick"><label class="btn" data-cv="take"><input type="file" class="file-hidden" accept="image/*" capture="environment">${ic('camera')} ${tr('Tomar foto')}</label><label class="btn" data-cv="pick"><input type="file" class="file-hidden" accept="image/*">${ic('gallery')} ${tr('Galería')}</label></div>
      <div id="qcover"></div>
      <label>${tr('Teléfono')}<input name="phone" type="tel"></label>
      <label>${tr('Correo')}<input name="email" type="email"></label>
      <label>${tr('Notas')}<textarea name="notes" rows="2"></textarea></label>
      <div class="row end"><button value="cancel" formnovalidate>${tr('Cancelar')}</button><button value="ok" class="primary">${tr('Crear')}</button></div>
    </form>`;
    document.body.appendChild(d);
    let geo = null, cover = null;
    d.querySelectorAll('[data-cv] input').forEach(inp => inp.onchange = () => {
      const [f] = inp.files; inp.value = '';
      if (!f) return;
      cover = f;
      $('#qcover', d).innerHTML = `<div class="cover-prev"><img src="${URL.createObjectURL(f)}" alt=""><button type="button" class="kebab" id="qcoverdel" aria-label="${tr('Quitar')}">${ic('xcircle')}</button></div>`;
      $('#qcoverdel', d).onclick = () => { cover = null; $('#qcover', d).innerHTML = ''; };
    });
    $('#qgps', d).onclick = async e => {
      const g = await withLocation(e.currentTarget); if (!g) return;
      geo = g;
      $('#qgeo', d).innerHTML = `${ic('satellite')} ${tr('GPS guardado:')} ${g.lat}, ${g.lng} (±${g.accuracy} m) · <a href="${mapUrl(g)}" target="_blank" rel="noopener">${tr('Abrir en Google Maps')}</a>`;
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
      ${options.map(([k, t, cls, icon, file]) => file
        // Opción que abre cámara o galería: selector de archivo real, que el iPhone abre siempre.
        ? `<label class="btn wide ${cls || ''}" data-k="${esc(k)}"><input type="file" class="file-hidden" accept="${file.accept}" ${file.capture ? 'capture="environment"' : ''}>${icon ? ic(icon) + ' ' : ''}${esc(t)}</label>`
        : `<button value="${esc(k)}" class="wide ${cls || ''}">${icon ? ic(icon) + ' ' : ''}${esc(t)}</button>`).join('')}
      <button value="" class="wide ghost">${tr('Cancelar')}</button></form>`;
    document.body.appendChild(d);
    actionSheet.files = [];
    d.querySelectorAll('label[data-k] input').forEach(inp => inp.addEventListener('change', () => {
      if (!inp.files.length) return;
      actionSheet.files = [...inp.files]; d.close(inp.parentElement.dataset.k);
    }));
    d.addEventListener('close', () => { const v = d.returnValue; d.remove(); resolve(v || null); });
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    d.showModal();
  });
}
const getFolders = async () => (await DB.get('settings', 'folders')) || [];
const saveFolders = f => DB.put('settings', f, 'folders');
const fmtWhen = t => new Date(t).toLocaleString(I18N.lang, { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

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
    return `<li data-name="${esc(l.search)}" data-report="${r.id}" ${hidden ? 'hidden' : ''}><a href="#/r/${r.id}"><span class="ico">${ic('report')}</span><div class="grow"><b>${esc(l.text)}</b></div></a><button class="kebab" data-menu="${r.id}" aria-label="${tr('Opciones')}">⋮</button></li>`;
  };
  view.innerHTML = `
    ${folder ? '' : modeSwitch()}
    <div class="toolbar"><input type="search" id="q" placeholder="${tr('Buscar cliente o dirección…')}"></div>
    <ul class="list" id="list">
      ${folder ? '' : folders.map(f => `<li data-name="${esc(f.name.toLowerCase())}" data-folder-row><a href="#/f/${f.id}"><span class="ico">${ic('folder')}</span><div class="grow"><b>${esc(f.name)}</b> <small class="inline-count">${all.filter(r => r.folderId === f.id).length}</small></div></a><button class="kebab" data-fmenu="${f.id}" aria-label="${tr('Opciones')}">⋮</button></li>`).join('')}
      ${reports.map(r => reportRow(r)).join('')}
      ${folder ? '' : all.filter(r => r.folderId).map(r => reportRow(r, true).replace('<li ', '<li data-infolder ')).join('')}
    </ul>
    ${reports.length || (!folder && folders.length) ? '' : `<div class="empty"><p>${tr(folder ? 'Carpeta vacía.' : 'Aún no tienes clientes.')}</p><p>${tr('Pulsa <b>+</b> para crear uno y empezar a tomar fotos.')}</p></div>`}
    ${folder ? '' : `<button class="ghost wide" id="newfolder">${ic('folder')} ${tr('Nueva carpeta')}</button>`}
    <button class="fab" id="add" aria-label="${tr('Crear cliente')}">${ic('plus')}</button>`;
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
    const r = newReport(c.id, { title: v.name, location: v.address, geo: v.geo || undefined, folderId: folder ? folder.id : undefined, coverPhoto: (await keep(v.cover)) || undefined });
    if (SECTION_TEMPLATES[v.tpl]) r.sections = SECTION_TEMPLATES[v.tpl].map(t => ({ id: DB.uid(), title: t, text: '' }));
    await DB.put('reports', r);
    location.hash = `#/r/${r.id}`;
  };
  $('#add').onclick = createReport;
  if ($('#newfolder')) $('#newfolder').onclick = async () => {
    const v = await form(tr('Nueva carpeta'), [{ name: 'name', label: tr('Nombre'), value: '', required: true }], tr('Crear'));
    if (!v || !v.name) return;
    folders.push({ id: DB.uid(), name: v.name }); await saveFolders(folders); route();
  };
  view.querySelectorAll('[data-menu]').forEach(b => b.onclick = async () => {
    const r = all.find(x => x.id === b.dataset.menu);
    const opts = [['open', tr('Abrir')]];
    if (folders.length) opts.push(['move', tr('Mover a carpeta'), '', 'folder']);
    if (r.folderId) opts.push(['out', tr('Sacar de la carpeta')]);
    opts.push(['del', tr('Eliminar reporte'), 'danger', 'trash']);
    const a = await actionSheet(label(r).text, opts);
    if (a === 'open') location.hash = `#/r/${r.id}`;
    if (a === 'move') {
      const v = await form(tr('Mover a carpeta'), [{ name: 'f', label: tr('Carpeta'), type: 'select', value: r.folderId || folders[0].id, options: folders.map(f => [f.id, f.name]) }], tr('Mover'));
      if (v) { r.folderId = v.f; await DB.put('reports', r); route(); }
    }
    if (a === 'out') { delete r.folderId; await DB.put('reports', r); route(); }
    if (a === 'del' && confirm(tr('¿Eliminar este reporte con todas sus fotos y videos?'))) { await DB.deleteReport(r.id); route(); }
  });
  view.querySelectorAll('#list li[data-report]').forEach(li => {
    const r = all.find(x => x.id === li.dataset.report);
    swipeRow(li, {
      del: async () => { if (confirm(tr('¿Eliminar este reporte con todas sus fotos y videos?'))) { await DB.deleteReport(r.id); route(); } },
      send: () => sendReportPdf(r),
    });
  });
  view.querySelectorAll('[data-fmenu]').forEach(b => b.onclick = async () => {
    const f = folders.find(x => x.id === b.dataset.fmenu);
    const a = await actionSheet(f.name, [['rename', tr('Cambiar nombre')], ['del', tr('Eliminar carpeta (los reportes se conservan)'), 'danger', 'trash']]);
    if (a === 'rename') {
      const v = await form(tr('Cambiar nombre'), [{ name: 'name', label: tr('Nombre'), value: f.name, required: true }]);
      if (v && v.name) { f.name = v.name; await saveFolders(folders); route(); }
    }
    if (a === 'del' && confirm(tr('¿Eliminar la carpeta "{name}"? Los reportes quedan en el inicio.', { name: f.name }))) {
      for (const r of all.filter(x => x.folderId === f.id)) { delete r.folderId; await DB.put('reports', r); }
      await saveFolders(folders.filter(x => x !== f)); route();
    }
  });
}

async function viewClients() {
  setHeader(tr('Clientes'));
  const clients = (await DB.all('clients')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const reports = await DB.all('reports');
  view.innerHTML = `
    ${modeSwitch()}
    <div class="toolbar"><input type="search" id="q" placeholder="${tr('Buscar cliente…')}"><button class="primary" id="add">+ ${tr('Cliente')}</button></div>
    <ul class="list" id="list">
      ${clients.map(c => `<li data-name="${esc(c.name.toLowerCase())}"><a href="#/c/${c.id}">
        <div class="avatar">${esc(c.name.slice(0, 1).toUpperCase())}</div>
        <div class="grow"><b>${esc(c.name)}</b><small>${esc([c.address, c.residential].filter(Boolean).join(' · ') || c.phone || '')}</small></div>
        <span class="badge">${reports.filter(r => r.clientId === c.id).length}</span></a></li>`).join('')}
    </ul>
    ${clients.length ? '' : `<div class="empty"><p>${tr('Aún no tienes clientes.')}</p><p>${tr('Crea uno para empezar tu primer reporte con fotos y videos.')}</p></div>`}`;
  bindModeSwitch();
  $('#q').oninput = e => {
    const q = e.target.value.toLowerCase();
    view.querySelectorAll('#list li').forEach(li => { li.hidden = !li.dataset.name.includes(q); });
  };
  $('#add').onclick = async () => {
    const v = await form(tr('Nuevo cliente'), clientFields({}));
    if (!v || !v.name) return;
    const c = { id: DB.uid(), ...v, createdAt: Date.now(), updatedAt: Date.now() };
    await DB.put('clients', c);
    location.hash = `#/c/${c.id}`;
  };
}

const clientFields = c => [
  { name: 'name', label: tr('Nombre'), value: c.name, required: true },
  { name: 'address', label: tr('Sector / Descripción'), value: c.address },
  { name: 'residential', label: tr('Nombre del residencial'), value: c.residential },
  { name: 'phone', label: tr('Teléfono'), value: c.phone, type: 'tel' },
  { name: 'email', label: tr('Correo'), value: c.email, type: 'email' },
  { name: 'notes', label: tr('Notas'), value: c.notes, type: 'textarea' },
];

async function viewClient(id) {
  const c = await DB.get('clients', id);
  if (!c) return (location.hash = '#/');
  setHeader(c.name, '#/');
  const reports = (await DB.byIndex('reports', 'clientId', id)).sort((a, b) => b.date - a.date);
  view.innerHTML = `
    <section class="card">
      <div class="row"><div class="grow">
        ${c.address ? `<div>${ic('pin')} ${esc(c.address)}</div>` : ''}${c.residential ? `<div>${ic('house')} ${esc(c.residential)}</div>` : ''}${geoLine(c.geo)}${c.phone ? `<div>${ic('phone')} <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></div>` : ''}
        ${c.email ? `<div>${ic('mail')} <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>` : ''}${c.notes ? `<p class="muted">${esc(c.notes)}</p>` : ''}
      </div><div class="col"><button id="here">${ic('pin')} ${tr('Estoy aquí')}</button><button id="edit">${tr('Editar')}</button><button id="del" class="danger">${tr('Eliminar')}</button></div></div>
    </section>
    <div class="toolbar"><h2 class="grow">${tr('Reportes')}</h2><button class="primary" id="add">+ ${tr('Reporte')}</button></div>
    <ul class="list">
      ${reports.map(r => `<li><a href="#/r/${r.id}"><div class="grow"><b>${esc(r.title)}</b><small>${fmtDate(r.date)}${r.location ? ' · ' + esc(r.location) : ''}</small></div><span class="chev">›</span></a></li>`).join('')}
    </ul>
    ${reports.length ? '' : `<div class="empty"><p>${tr('Sin reportes todavía.')}</p></div>`}`;
  $('#edit').onclick = async () => {
    const v = await form(tr('Editar cliente'), clientFields(c)); if (!v) return;
    await DB.put('clients', { ...c, ...v, updatedAt: Date.now() }); route();
  };
  $('#here').onclick = async e => {
    const g = await withLocation(e.target); if (!g) return;
    c.geo = g;
    await DB.put('clients', { ...c, updatedAt: Date.now() }); toast(tr('Ubicación guardada')); route();
  };
  $('#del').onclick = async () => {
    if (!confirm(tr('¿Eliminar a {name} y todos sus reportes, fotos y videos?', { name: c.name }))) return;
    await DB.deleteClient(id); location.hash = '#/';
  };
  $('#add').onclick = async () => {
    const v = await form(tr('Nuevo reporte'), [
      { name: 'title', label: tr('Título'), value: `${tr('Inspección')} ${new Date().toLocaleDateString(I18N.lang)}`, required: true },
      { name: 'location', label: tr('Ubicación'), value: c.address },
      { name: 'gps', label: tr('Guardar mi ubicación GPS actual'), type: 'checkbox', value: true },
      { name: 'tpl', label: tr('Plantilla de secciones'), type: 'select', value: '', options: [['', tr('Una sola sección (General)')], ...Object.keys(SECTION_TEMPLATES).map(k => [k, k])] },
    ], tr('Crear'));
    if (!v) return;
    const names = SECTION_TEMPLATES[v.tpl] || ['General'];
    const r = {
      id: DB.uid(), clientId: id, title: v.title, location: v.location, date: Date.now(), notes: '',
      sections: names.map(t => ({ id: DB.uid(), title: t, text: '' })),
      layout: { orientation: 'portrait', cols: 2, rows: 3 }, cover: true, coverImage: true,
    };
    if (v.gps) {
      toast(tr('Obteniendo ubicación…'));
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
      ${c?.residential ? `<div>${ic('house')} ${esc(c.residential)}</div>` : ''}
      ${geoLine(r.geo)}
      ${simple && r.geo ? mapEmbed(r.geo) : ''}
      <div class="muted">${tr('{p} fotos · {v} videos', { p: nPhotos, v: nVideos })}${r.coverPhoto ? ' · ' + tr('con foto de portada') : ''}</div>
      <div class="report-actions">
        <button class="primary" id="pdf">${ic('arrow')}<span>${tr(nVideos ? 'Enviar PDF + videos' : 'Enviar PDF')}</span></button>
        <button class="primary" id="coverbtn">${ic('gallery')}<span>${tr('Portada')}</span></button>
        <button class="primary" id="here">${ic('pin')}<span>${tr('Ubicación')}</span></button>
        <button class="primary" id="settings">${ic('gear')}<span>${tr('Ajustes')}</span></button>
        <button class="primary more" id="more">⋯</button>
      </div>
    </section>
    ${simple ? simpleReportBody(r, items) : r.sections.map(s => {
      const its = items.filter(i => i.sectionId === s.id);
      return `<section class="section" data-sec="${s.id}">
        <div class="sec-head"><h2 class="grow">${esc(s.title)} <small>(${its.length})</small></h2><button data-a="secedit" title="Editar sección">${ic('pencil')}</button></div>
        ${s.text ? `<p class="muted">${esc(s.text)}</p>` : ''}
        <div class="grid">${its.map(it => `
          <a class="thumb" href="#/i/${it.id}">
            ${(it.type === 'video' ? it.thumb : (it.annotated || it.blob)) ? `<img loading="lazy" src="${objUrl(it.type === 'video' ? it.thumb : (it.annotated || it.blob))}" alt="">` : `<div class="noimg">${ic('video')}</div>`}
            ${it.type === 'video' ? `<span class="vbadge">▶ ${fmtDur(it.duration)}</span>` : ''}
            ${it.shapes?.length ? `<span class="abadge">${ic('pencil')}</span>` : ''}
            ${(it.caption || it.measure) ? `<span class="cap">${esc([it.caption, it.measure].filter(Boolean).join(' · ').replace(/\n+/g, ' · '))}</span>` : ''}
          </a>`).join('')}</div>
        <div class="row add-row">
          <button data-a="cam">${ic('burst')} Ráfaga</button>
          <button data-a="photo">${ic('camera')} Foto</button>
          <button data-a="video">${ic('video')} Video</button>
          <button data-a="gallery">${ic('gallery')} Galería</button>
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
      if (a === 'gallery') { const f = await pickFiles('image/*,video/*', { multiple: true }); if (f.length) { toast(tr('Importando…')); await addMedia(r, sid, f); route(); } }
      if (a === 'secedit') {
        const s = r.sections.find(x => x.id === sid);
        const v = await form(tr('Sección'), [
          { name: 'title', label: tr('Título'), value: s.title, required: true },
          { name: 'text', label: tr('Texto / párrafo (aparece en el PDF)'), value: s.text, type: 'textarea' },
          { name: 'pos', label: tr('Posición'), type: 'select', value: 'same', options: [['same', tr('Sin cambio')], ['up', tr('Subir')], ['down', tr('Bajar')]] },
          { name: 'del', label: tr('Eliminar sección (y sus elementos)'), type: 'checkbox', value: false },
        ]);
        if (!v) return;
        const idx = r.sections.indexOf(s);
        if (v.del) {
          if (!confirm(tr('¿Eliminar la sección y todo su contenido?'))) return;
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
    const v = await form(tr('Agregar secciones'), [
      { name: 'title', label: tr('Título de la nueva sección'), value: '' },
      { name: 'tpl', label: tr('o agregar desde plantilla'), type: 'select', value: '', options: [['', '—'], ...Object.keys(SECTION_TEMPLATES).map(k => [k, k])] },
    ], tr('Agregar'));
    if (!v) return;
    const names = v.tpl ? SECTION_TEMPLATES[v.tpl] : v.title ? [v.title] : [];
    names.forEach(t => r.sections.push({ id: DB.uid(), title: t, text: '' }));
    await DB.put('reports', r); route();
  };

  $('#here').onclick = async e => {
    const g = await withLocation(e.target); if (!g) return;
    r.geo = g;
    await DB.put('reports', r); toast(tr('Ubicación guardada en el reporte')); route();
  };
  $('#settings').onclick = async () => {
    const clientPart = simple && c ? [
      { name: 'cname', label: tr('Nombre del cliente'), value: c.name, required: true },
      { name: 'caddress', label: tr('Sector / Descripción'), value: c.address },
      { name: 'cresidential', label: tr('Nombre del residencial'), value: c.residential },
      { name: 'cphone', label: tr('Teléfono'), value: c.phone, type: 'tel' },
    ] : [];
    const v = await form(tr('Ajustes del reporte'), [
      ...clientPart,
      { name: 'title', label: tr('Título'), value: r.title, required: true },
      { name: 'location', label: tr('Ubicación'), value: r.location },
      { name: 'date', label: tr('Fecha'), type: 'date', value: new Date(r.date).toISOString().slice(0, 10) },
      { name: 'cover', label: tr('Incluir portada'), type: 'checkbox', value: r.cover !== false },
      { name: 'notes', label: tr('Observaciones generales'), value: r.notes, type: 'textarea' },
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

  const base = Exporter.slug(r.title) || tr('reporte');
  $('#pdf').onclick = e => busy(e.target, () => sendReportPdf(r));
  $('#coverbtn').onclick = async () => {
    const opts = [['take', tr('Tomar foto'), '', 'camera', { accept: 'image/*', capture: true }], ['pick', tr('Elegir de galería'), '', 'gallery', { accept: 'image/*' }]];
    if (r.coverPhoto) opts.push(['see', tr('Ver portada actual'), '', 'eye'], ['del', tr('Quitar foto de portada'), 'danger']);
    const a = await actionSheet(tr('Foto de portada'), opts);
    if (a === 'take' || a === 'pick') {
      const [f] = actionSheet.files;
      if (f) { r.coverPhoto = await keep(f); await DB.put('reports', r); toast(tr('Foto de portada guardada')); route(); }
    }
    if (a === 'see') openViewer(r.coverPhoto);
    if (a === 'del') { delete r.coverPhoto; await DB.put('reports', r); route(); }
  };
  $('#more').onclick = async () => {
    const v = await form(tr('Más opciones'), [{ name: 'act', label: tr('Acción'), type: 'select', value: 'share', options: [
      ['share', tr('Compartir reporte editable (.rplus)')], ['dup', tr('Duplicar reporte')], ['del', tr('Eliminar reporte')],
    ] }], tr('Aceptar'));
    if (!v) return;
    if (v.act === 'share') {
      const blob = await Backup.exportBundle([c], [r], items);
      await shareOrDownload(blob, `${base}.rplus`, r.title);
    }
    if (v.act === 'dup') {
      const map = {};
      const copy = { ...r, id: DB.uid(), title: r.title + ' (' + tr('copia') + ')', date: Date.now(), sections: r.sections.map(s => { const n = { ...s, id: DB.uid() }; map[s.id] = n.id; return n; }) };
      await DB.put('reports', copy);
      for (const it of items) await DB.put('items', { ...it, id: DB.uid(), reportId: copy.id, sectionId: map[it.sectionId] });
      location.hash = `#/r/${copy.id}`;
    }
    if (v.act === 'del' && confirm(tr('¿Eliminar este reporte con todas sus fotos y videos?'))) {
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
    const thumbs = its.slice(0, 4).map(it => { const src = it.type === 'video' ? it.thumb : (it.annotated || it.blob); return `<span class="ithumb sm">${src ? `<img loading="lazy" src="${objUrl(src)}" alt="">` : ic('video')}</span>`; }).join('');
    return `<li class="irow"><div class="when">${fmtWhen(e.createdAt)} · ${ic('burst')} ${tr('Ráfaga')}</div>
      <a href="#/e/${r.id}/${e.id}" class="irow-main col-main">
        <span class="itext"><b>${esc(e.caption || tr('Ráfaga'))}</b> <span class="muted">(${its.length} ${tr(its.length === 1 ? 'foto' : 'fotos')})</span></span>
        <span class="strip">${thumbs}${its.length > 4 ? `<span class="more">+${its.length - 4}</span>` : ''}</span>
      </a><button class="kebab" data-emenu="${e.id}" aria-label="${tr('Opciones')}">⋮</button></li>`;
  }
  function row(it) {
    const src = it.type === 'video' ? it.thumb : (it.annotated || it.blob);
    const text = [it.caption, it.measure].filter(Boolean).join('\n');
    return `<li class="irow"><div class="when">${fmtWhen(it.createdAt)}</div>
      <a href="#/i/${it.id}" class="irow-main">
        <span class="ithumb">${src ? `<img loading="lazy" src="${objUrl(src)}" alt="">` : ic('video')}${it.type === 'video' ? `<span class="vbadge">▶ ${fmtDur(it.duration)}</span>` : ''}</span>
        <span class="itext">${text ? esc(text) : `<span class="muted">${tr('Toca para agregar descripción y medidas')}</span>`}</span>
      </a><button class="kebab" data-imenu="${it.id}" aria-label="${tr('Opciones')}">⋮</button></li>`;
  }
  return `
    ${rows.length ? `<ul class="ilist">${rows.map(x => x.html).join('')}</ul>`
    : `<div class="empty"><p>${tr('Todavía no hay fotos ni videos.')}</p><p>${tr('Pulsa <b>+</b> para agregar fotos o videos.')}</p></div>`}
    <button class="fab" id="newItem" aria-label="${tr('Agregar foto o video')}">${ic('plus')}</button>`;
}

// Ventana del botón +: área, descripción, medida y cómo capturar.
function newItemSheet(r) {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'sheet';
    const area = currentArea[r.id];
    d.innerHTML = `<form method="dialog"><h2>${tr('Agregar')}</h2>
      <label>${tr('Descripción')}<textarea name="caption" class="autogrow" rows="1" placeholder="${tr('Ej. Oficina')}"></textarea></label>
      <label>${tr('Nota / Medida')} <small>(${tr('en Ráfaga cada foto lleva la suya')})</small><textarea name="measure" class="autogrow" rows="3" placeholder="${tr('Ej. 36 x 48')}&#10;${tr('Ventana 24 x 36')}"></textarea></label>
      <div class="cap-btns">
        <button type="button" data-a="cam">${ic('burst')}<small>${tr('Ráfaga')}</small></button>
        <label data-a="photo"><input type="file" class="file-hidden" accept="image/*" capture="environment">${ic('camera')}<small>${tr('Foto')}</small></label>
        <label data-a="video"><input type="file" class="file-hidden" accept="video/*" capture="environment">${ic('video')}<small>${tr('Video')}</small></label>
        <label data-a="gallery"><input type="file" class="file-hidden" accept="image/*,video/*" multiple>${ic('gallery')}<small>${tr('Galería')}</small></label>
      </div>
      <div class="row end"><button value="cancel" formnovalidate>${tr('Cancelar')}</button></div>
    </form>`;
    document.body.appendChild(d);
    d.querySelectorAll('textarea.autogrow').forEach(el => el.addEventListener('input', () => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; }));
    let result = null;
    const finish = (action, files) => {
      result = { action, files, sectionId: area, caption: d.querySelector('[name=caption]').value.trim(), measure: d.querySelector('[name=measure]').value.trim() };
      d.close();
    };
    d.querySelector('[data-a=cam]').addEventListener('click', () => finish('cam', null));
    // Foto, Video y Galería son selectores de archivo reales dentro de la ventana: el iPhone los abre siempre
    // y la ventana se cierra solo cuando ya llegó la foto o el video.
    d.querySelectorAll('label[data-a] input').forEach(inp => inp.addEventListener('change', () => {
      if (inp.files.length) finish(inp.parentElement.dataset.a, [...inp.files]);
    }));
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
    if (!f.length) return;
    if (v.action === 'gallery') toast(tr('Importando…'));
    const ids = await addMedia(r, sid, f, extra);
    // Foto o video: directo a escribir descripción y nota / medida.
    if (ids.length === 1) location.hash = `#/i/${ids[0]}`; else route();
  };
  view.querySelectorAll('[data-emenu]').forEach(b => b.onclick = async () => {
    const e = r.entries.find(x => x.id === b.dataset.emenu);
    const a = await actionSheet(e.caption || tr('Ráfaga'), [['open', tr('Abrir')], ['del', tr('Eliminar ráfaga completa'), 'danger', 'trash']]);
    if (a === 'open') location.hash = `#/e/${r.id}/${e.id}`;
    if (a === 'del' && confirm(tr('¿Eliminar esta ráfaga con todas sus fotos?'))) {
      for (const it of items.filter(i => i.entryId === e.id)) await DB.del('items', it.id);
      r.entries = r.entries.filter(x => x !== e); await DB.put('reports', r); route();
    }
  });
  view.querySelectorAll('.ilist > li').forEach(li => {
    const eb = li.querySelector('[data-emenu]'), ib = li.querySelector('[data-imenu]');
    swipeRow(li, { del: async () => {
      if (eb) {
        const e = r.entries.find(x => x.id === eb.dataset.emenu);
        if (!confirm(tr('¿Eliminar esta ráfaga con todas sus fotos?'))) return;
        for (const it of items.filter(i => i.entryId === e.id)) await DB.del('items', it.id);
        r.entries = r.entries.filter(x => x !== e); await DB.put('reports', r);
      } else if (ib) {
        if (!confirm(tr('¿Eliminar este elemento?'))) return;
        await DB.del('items', ib.dataset.imenu);
      }
      route();
    } });
  });
  view.querySelectorAll('[data-imenu]').forEach(b => b.onclick = async () => {
    const it = items.find(x => x.id === b.dataset.imenu);
    const opts = [['open', tr('Abrir')], ['del', tr('Eliminar'), 'danger', 'trash']];
    const a = await actionSheet(tr(it.type === 'video' ? 'Video' : 'Foto'), opts);
    if (a === 'open') location.hash = `#/i/${it.id}`;
    if (a === 'area') {
      const v = await form(tr('Cambiar de área'), [{ name: 's', label: tr('Área'), type: 'select', value: it.sectionId, options: r.sections.map(s => [s.id, s.title]) }]);
      if (v) { it.sectionId = v.s; await DB.put('items', it); route(); }
    }
    if (a === 'del' && confirm(tr('¿Eliminar este elemento?'))) { await DB.del('items', it.id); route(); }
  });
}

// Ráfaga: una descripción (ej. "Cocina") y cada foto con su propia medida.
async function viewEntry(rid, eid) {
  const r = await DB.get('reports', rid);
  const e = r && (r.entries || []).find(x => x.id === eid);
  if (!e) return (location.hash = r ? `#/r/${rid}` : '#/');
  setHeader(e.caption || tr('Ráfaga'), `#/r/${rid}`);
  const its = (await DB.byIndex('items', 'reportId', rid)).filter(i => i.entryId === eid).sort((a, b) => a.order - b.order);
  view.innerHTML = `
    <section class="card">
      <label>${tr('Descripción')}<textarea id="ecap" class="autogrow" rows="1" placeholder="${tr('Ej. Cocina')}">${esc(e.caption)}</textarea></label>
    </section>
    <ul class="blist">${its.map((it, n) => {
      const src = it.type === 'video' ? it.thumb : (it.annotated || it.blob);
      return `<li class="card bitem" data-id="${it.id}">
        <div class="bhead"><b>${tr(it.type === 'video' ? 'Video' : 'Foto')} ${n + 1}</b><button class="kebab" data-bdel="${it.id}" aria-label="${tr('Eliminar')}">${ic('trash')}</button></div>
        <a href="#/i/${it.id}" class="bmedia">${src ? `<img loading="lazy" src="${objUrl(src)}" alt="">` : ic('video')}${it.type === 'video' ? `<span class="vbadge">▶ ${fmtDur(it.duration)}</span>` : ''}</a>
        <label>${tr('Nota / Medida')}<textarea class="autogrow bmeasure" rows="1" placeholder="${tr('Ej. 36 x 48')}">${esc(it.measure)}</textarea></label>
      </li>`;
    }).join('')}</ul>
    ${its.length ? '' : `<div class="empty"><p>${tr('Sin fotos todavía.')}</p></div>`}
    <div class="cap-btns entry-add">
      <button data-a="cam">${ic('burst')}<small>${tr('Más ráfaga')}</small></button>
      <button data-a="photo">${ic('camera')}<small>${tr('Foto')}</small></button>
      <button data-a="video">${ic('video')}<small>${tr('Video')}</small></button>
      <button data-a="gallery">${ic('gallery')}<small>${tr('Galería')}</small></button>
    </div>`;
  const grow = el => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; };
  const ecap = $('#ecap');
  grow(ecap);
  ecap.addEventListener('input', () => { grow(ecap); setHeader(ecap.value.trim() || tr('Ráfaga'), `#/r/${rid}`); clearTimeout(ecap.t); ecap.t = setTimeout(async () => { e.caption = ecap.value.trim(); await DB.put('reports', r); }, 400); });
  view.querySelectorAll('.bitem').forEach(li => {
    const it = its.find(x => x.id === li.dataset.id);
    const ta = $('.bmeasure', li);
    grow(ta);
    ta.addEventListener('input', () => { grow(ta); clearTimeout(ta.t); ta.t = setTimeout(() => { it.measure = ta.value.trim(); DB.put('items', it); }, 400); });
  });
  view.querySelectorAll('[data-bdel]').forEach(b => b.onclick = async () => {
    if (!confirm(tr('¿Eliminar esta foto?'))) return;
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
  setHeader(tr(it.type === 'video' ? 'Video' : 'Foto'), inEntry ? `#/e/${r.id}/${it.entryId}` : `#/r/${r.id}`);
  const media = it.type === 'video'
    ? `<video controls playsinline src="${objUrl(it.blob)}" ${it.thumb ? `poster="${objUrl(it.thumb)}"` : ''}></video>`
    : `<img src="${objUrl(it.annotated || it.blob)}" alt="">`;
  view.innerHTML = `
    <div class="media">${media}</div>
    <div class="row media-bar">
      ${it.type === 'photo' ? `<button class="primary" id="annot">${ic('pencil')} ${tr('Anotar / medir')}</button>` : `<button id="rethumb">${ic('gallery')} ${tr('Cambiar miniatura')}</button>`}
      <div class="nav-pair">
        <button id="prev" ${idx <= 0 ? 'disabled' : ''}>‹ ${tr('Anterior')}</button>
        <button id="next" ${idx >= siblings.length - 1 ? 'disabled' : ''}>${tr('Siguiente')} ›</button>
      </div>
    </div>
    <section class="card">
      <label ${inEntry ? 'hidden' : ''}>${tr('Descripción')}<textarea id="caption" class="autogrow" rows="1" placeholder="${tr('Ej. Oficina')}">${esc(it.caption)}</textarea></label>
      <label>${tr('Nota / Medida')}<textarea id="measure" class="autogrow" rows="3" placeholder="${tr('Ej. 36 x 48')}&#10;${tr('Ventana 24 x 36')}">${esc(it.measure)}</textarea></label>
      <label ${r.sections.length > 1 ? '' : 'hidden'}>${tr('Sección')}<select id="section">${r.sections.map(s => `<option value="${s.id}" ${s.id === it.sectionId ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}</select></label>
      <div class="row wrap">
        <button id="up">${ic('arrow')} ${tr('Mover antes')}</button><button id="down">${ic('arrow', 180)} ${tr('Mover después')}</button>
        ${it.type === 'photo' ? `<button id="cover">${ic('star')} ${tr('Usar en portada')}</button>` : ''}
        <button id="save1">${ic('arrow', 180)} ${tr('Descargar archivo')}</button>
        <button id="del" class="danger">${tr('Eliminar')}</button>
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
  if (mediaImg) {
    mediaImg.onclick = () => openViewer(it.annotated || it.blob);
    // Si la versión anotada no abre, se muestra la original; si tampoco, un aviso claro en vez del "?".
    mediaImg.onerror = () => {
      if (it.annotated && !mediaImg.dataset.retry) { mediaImg.dataset.retry = 1; mediaImg.src = objUrl(it.blob); return; }
      $('.media').innerHTML = `<div class="media-lost">${ic('camera')}<p>${tr('Esta foto ya no está guardada en el teléfono.')}</p><p class="small">${tr('La nota y la medida siguen aquí. Puedes eliminarla y tomar la foto de nuevo.')}</p></div>`;
    };
  }
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
    await DB.put('items', it); await DB.put('items', other); toast(tr('Movido'));
  };
  $('#up').onclick = () => swap(-1);
  $('#down').onclick = () => swap(1);
  $('#save1').onclick = () => download(it.type === 'photo' ? (it.annotated || it.blob) : it.blob, `${it.type}_${it.id}.${(it.blob.type.split('/')[1] || 'bin').split(';')[0]}`);
  $('#del').onclick = async () => {
    if (!confirm(tr('¿Eliminar este elemento?'))) return;
    await DB.del('items', id); location.hash = inEntry ? `#/e/${r.id}/${it.entryId}` : `#/r/${r.id}`;
  };
  if ($('#cover')) $('#cover').onclick = async () => { r.coverPhoto = it.annotated || it.blob; await DB.put('reports', r); toast(tr('Se usará en la portada')); };
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
    await DB.put('items', it); toast(tr('Miniatura tomada del momento actual del video'));
  };
}

async function viewSettings() {
  setHeader(tr('Mi empresa'), '#/');
  const s = await DB.getSettings();
  view.innerHTML = `
    <section class="card">
      <label>${tr('Idioma')} · Language · Langue<select id="lang">${I18N.LANGS.map(([k, n]) => `<option value="${k}" ${k === I18N.lang ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    </section>
    <section class="card">
      <p class="muted">${tr('Estos datos aparecen en la portada y encabezado de tus reportes.')}</p>
      <div class="logo-box">${s.logo ? `<img src="${objUrl(s.logo)}" alt="Logo">` : `<span class="muted">${tr('Sin logo')}</span>`}</div>
      <div class="row"><button id="logo">${tr('Elegir logo')}</button>${s.logo ? `<button id="nologo">${tr('Quitar')}</button>` : ''}</div>
      <label>${tr('Empresa')}<input id="name" value="${esc(s.name)}"></label>
      <label>${tr('Persona de contacto')}<input id="contact" value="${esc(s.contact)}"></label>
      <label>${tr('Teléfono')}<input id="phone" type="tel" value="${esc(s.phone)}"></label>
      <label>${tr('Correo')}<input id="email" type="email" value="${esc(s.email)}"></label>
      <button class="primary wide" id="save">${tr('Guardar')}</button>
    </section>
    <section class="card">
      <h2>${tr('Respaldo')}</h2>
      <p class="muted">${tr('Todo se guarda solo en este teléfono. Haz respaldos para no perder tus reportes, o para pasarlos a otro equipo.')}</p>
      <div class="row wrap"><button id="backup">${ic('arrow', 180)} ${tr('Crear respaldo')}</button><button id="restore">${ic('arrow')} ${tr('Restaurar / importar .rplus')}</button></div>
      <p class="muted" id="usage"></p>
    </section>`;
  $('#lang').onchange = e => { I18N.set(e.target.value); route(); };
  $('#logo').onclick = async () => { const [f] = await pickFiles('image/*'); if (f) { s.logo = await keep(f); await DB.saveSettings(s); route(); } };
  if ($('#nologo')) $('#nologo').onclick = async () => { s.logo = null; await DB.saveSettings(s); route(); };
  $('#save').onclick = async () => {
    ['name', 'contact', 'phone', 'email'].forEach(k => { s[k] = $('#' + k).value.trim(); });
    await DB.saveSettings(s); toast(tr('Guardado'));
  };
  $('#backup').onclick = async e => {
    e.target.disabled = true; toast(tr('Creando respaldo…'));
    const blob = await Backup.exportBundle(await DB.all('clients'), await DB.all('reports'), await DB.all('items'), s);
    download(blob, `reportplus_${tr('respaldo')}_${new Date().toISOString().slice(0, 10)}.rplus`);
    e.target.disabled = false;
  };
  $('#restore').onclick = async () => {
    const [f] = await pickFiles('.rplus,.zip,application/zip');
    if (!f) return;
    const n = await Backup.importBundle(f);
    toast(tr('Importados {c} cliente(s) y {r} reporte(s)', { c: n.clients, r: n.reports })); location.hash = '#/';
  };
  if (navigator.storage?.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    $('#usage').textContent = tr('Espacio usado: {u} MB de {q} GB disponibles.', { u: (usage / 1e6).toFixed(1), q: (quota / 1e9).toFixed(1) });
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
  $('#backBtn').setAttribute('aria-label', tr('Atrás'));
  $('#settingsBtn').setAttribute('aria-label', tr('Mi empresa'));
  updateOnline();
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
  } catch (e) { console.error(e); view.innerHTML = `<div class="empty">${tr('Error:')} ${esc(e.message)}</div>`; }
  window.scrollTo(0, 0);
}
['gesturestart', 'gesturechange'].forEach(t => document.addEventListener(t, e => e.preventDefault()));
$('#settingsBtn').onclick = () => { location.hash = '#/settings'; };
window.addEventListener('hashchange', route);
// Aviso visible mientras no hay internet; todo se sigue guardando en el teléfono.
const offlineBar = document.createElement('div');
offlineBar.id = 'offline'; offlineBar.setAttribute('role', 'status');
document.querySelector('.topbar').append(offlineBar);
const updateOnline = () => { offlineBar.textContent = tr('Sin conexión: tus cambios se guardan en el teléfono'); offlineBar.hidden = navigator.onLine; };
window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOnline);
route();
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // Cuando llega una versión nueva, la app se recarga sola una vez para usarla (sin interrumpir si hay una ventana abierta).
  const hadSW = !!navigator.serviceWorker.controller;
  let reloading = false;
  const reload = () => { if (!reloading) { reloading = true; location.reload(); } };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadSW) return;
    if (!document.querySelector('dialog[open]')) reload();
    else document.addEventListener('visibilitychange', () => document.hidden && reload());
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    // Al volver a la app (estaba en segundo plano), busca si hay versión nueva.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  });
}
