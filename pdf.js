// Generación del PDF y del paquete ZIP (PDF + videos + fotos originales).
const Exporter = (() => {
  const blobToImage = blob => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => { URL.revokeObjectURL(img.src); rej(new Error(tr('No se pudo leer una foto'))); };
    img.src = URL.createObjectURL(blob);
  });

  // Reduce la imagen para que el PDF no pese demasiado.
  async function toJpeg(blob, max = 1400) {
    const img = await blobToImage(blob);
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    const out = { data: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height };
    c.width = c.height = 0; // libera memoria: el iPhone se traba si se acumulan lienzos grandes
    return out;
  }

  // Si una foto no se puede leer, se intenta con una copia; si tampoco, se omite en vez de cancelar todo el PDF.
  async function safeJpeg(blob, max) {
    try { return await toJpeg(blob, max); } catch (e) { console.warn(e); }
    try { return await toJpeg(new Blob([await blob.arrayBuffer()], { type: blob.type || 'image/jpeg' }), max); } catch (e) { console.warn(e); }
    return null;
  }

  const ext = (blob, fallback) => {
    const m = (blob.type || '').split('/')[1];
    return m ? m.replace('quicktime', 'mov').replace('jpeg', 'jpg').split(';')[0] : fallback;
  };
  const slug = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  const fmtDur = s => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '';

  // Nombre del video: "Cliente - Descripción.mp4" (con número si hay varios).
  const clean = t => (t || '').replace(/[\\/:*?"<>|\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  function videoName(item, n, clientName, total) {
    const base = [clean(clientName), clean(item.caption)].filter(Boolean).join(' - ') || tr('Video');
    return `${base}${total > 1 ? ` (${n})` : ''}.${ext(item.blob, 'mp4')}`;
  }

  async function buildPdf({ company, client, report, sections, items }) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const M = 12, headerH = 14, footerH = 10;
    const accent = [200, 75, 49];
    const videoFiles = new Map();
    let videoCount = 0;
    const vids = items.filter(i => i.type === 'video');
    vids.forEach(i => videoFiles.set(i.id, videoName(i, ++videoCount, client.name, vids.length)));

    const header = () => {
      doc.setFillColor(...accent); doc.rect(0, 0, W, 2, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(40);
      doc.text(doc.splitTextToSize([client.name || report.title, client.residential].filter(Boolean).join(' - '), W - 2 * M - 50)[0], M, 9);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(110);
      if (company.name) doc.text(company.name, W - M, 9, { align: 'right' });
      doc.setDrawColor(220); doc.line(M, 11.5, W - M, 11.5);
    };

    // Portada
    if (report.cover !== false) {
      let y = 30;
      if (company.logo) {
        const lg = await safeJpeg(company.logo, 600);
        if (lg) { const h = 28, w = Math.min(70, h * lg.w / lg.h); doc.addImage(lg.data, 'JPEG', (W - w) / 2, y, w, h); y += h + 10; }
      }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(24); doc.setTextColor(20);
      doc.text(doc.splitTextToSize(report.title || tr('Reporte'), W - 2 * M), W / 2, y + 8, { align: 'center' }); y += 22;
      doc.setFontSize(14); doc.setFont('helvetica', 'normal'); doc.setTextColor(70);
      const lines = [
        client.name && `${tr('Cliente')}: ${client.name}`,
        (report.location || client.address) && `${tr('Ubicación')}: ${report.location || client.address}`,
        client.residential && `${tr('Residencial')}: ${client.residential}`,
        `${tr('Fecha')}: ${new Date(report.date || Date.now()).toLocaleDateString(I18N.lang)}`,
      ].filter(Boolean);
      lines.forEach(l => { doc.text(l, W / 2, y, { align: 'center' }); y += 8; });
      const geo = report.geo || client.geo;
      if (geo) {
        doc.setFontSize(10); doc.setTextColor(...accent);
        const gps = `GPS: ${geo.lat}, ${geo.lng} (${tr('ver en mapa')})`;
        doc.textWithLink(gps, W / 2 - doc.getTextWidth(gps) / 2, y, { url: `https://www.google.com/maps?q=${geo.lat},${geo.lng}` });
        y += 7; doc.setFontSize(14); doc.setTextColor(70);
      }
      // Foto de portada solo si el usuario la eligió.
      if (report.coverPhoto) {
        const im = await safeJpeg(report.coverPhoto);
        if (im) {
        const maxW = W - 4 * M, maxH = H - y - 55;
        const k = Math.min(maxW / im.w, maxH / im.h);
        if (k > 0) { doc.addImage(im.data, 'JPEG', (W - im.w * k) / 2, y + 6, im.w * k, im.h * k); }
        }
      }
      doc.setFontSize(10); doc.setTextColor(90);
      const cinfo = [company.name, company.contact, company.phone, company.email].filter(Boolean);
      cinfo.forEach((l, i) => doc.text(l, W / 2, H - 30 + i * 5, { align: 'center' }));
      if (report.notes) {
        doc.addPage(); header();
        doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(20);
        doc.text(tr('Observaciones'), M, 24);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(50);
        doc.text(doc.splitTextToSize(report.notes, W - 2 * M), M, 32);
      }
    }

    // Bloques: una foto/video por página; las fotos de una ráfaga van juntas, lado a lado.
    const blocks = [];
    const byEntry = new Map();
    for (const it of items) {
      if (it.entryId && byEntry.has(it.entryId)) { byEntry.get(it.entryId).items.push(it); continue; }
      const b = { entryId: it.entryId || null, items: [it] };
      if (it.entryId) byEntry.set(it.entryId, b);
      blocks.push(b);
    }
    const textLinesFor = (it, width, withCaption, num) => {
      const out = [];
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
      if (withCaption) {
        // Respeta los saltos de línea que escribió el usuario (ej. "Sala" en una línea y el detalle en otras).
        const capLines = (it.caption || '').split('\n').map(l => l.trim()).filter(Boolean);
        if (!capLines.length) capLines.push('');
        capLines[0] = `${num}. ${capLines[0]}`.trim();
        out.push({ bold: true, size: 12, lines: [].concat(...capLines.map(l => doc.splitTextToSize(l, width))) });
      }
      const measures = (it.measure || '').split('\n').map(m => m.trim()).filter(Boolean);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
      if (measures.length) out.push({ bold: false, size: 11, lines: doc.splitTextToSize(`${tr('Nota / Medida')}: ${measures[0]}`, width).concat(...measures.slice(1).map(m => doc.splitTextToSize(m, width))) });
      if (it.type === 'video') out.push({ italic: true, size: 9, lines: doc.splitTextToSize(`${tr('Video')} ${fmtDur(it.duration)} · ${tr('se envía aparte por WhatsApp:')} "${videoFiles.get(it.id)}"`, width) });
      return out;
    };
    const lineH = size => size * 0.42;
    const textHeight = groups => groups.reduce((h, g) => h + g.lines.length * lineH(g.size) + 1.5, 0);
    const drawText = (groups, x, y) => {
      for (const g of groups) {
        doc.setFont('helvetica', g.bold ? 'bold' : g.italic ? 'italic' : 'normal'); doc.setFontSize(g.size); doc.setTextColor(g.italic ? 110 : 30);
        doc.text(g.lines, x, y + lineH(g.size)); y += g.lines.length * lineH(g.size) + 1.5;
      }
    };
    const drawMedia = async (it, x, y, w, h) => {
      const src = it.type === 'video' ? it.thumb : (it.annotated || it.blob);
      const im = src && await safeJpeg(src, 1800);
      if (!im) {
        const ph = Math.min(h, w * 0.6);
        doc.setFillColor(240); doc.rect(x, y, w, ph, 'F');
        doc.setFont('helvetica', 'italic'); doc.setFontSize(10); doc.setTextColor(120);
        doc.text(tr('Foto no disponible'), x + w / 2, y + ph / 2, { align: 'center' });
        return ph;
      }
      const k = Math.min(w / im.w, h / im.h);
      const iw = im.w * k, ih = im.h * k, ix = x + (w - iw) / 2, iy = y;
      doc.addImage(im.data, 'JPEG', ix, iy, iw, ih);
      if (it.type === 'video') {
        const cx = ix + iw / 2, cy = iy + ih / 2, r = Math.min(iw, ih) * 0.1;
        doc.setFillColor(0, 0, 0); doc.circle(cx, cy, r, 'F');
        doc.setFillColor(255, 255, 255);
        doc.triangle(cx - r * 0.35, cy - r * 0.5, cx - r * 0.35, cy + r * 0.5, cx + r * 0.55, cy, 'F');
        doc.setFillColor(220, 40, 40); doc.rect(ix, iy, 24, 6.5, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(255);
        doc.text(`${tr('VIDEO')} ${fmtDur(it.duration)}`, ix + 12, iy + 4.5, { align: 'center' });
      }
      return ih;
    };

    let first = report.cover === false;
    const newPage = () => { if (!first) doc.addPage(); first = false; header(); };
    const top = headerH + 6, bottom = H - footerH - 4, width = W - 2 * M;
    let num = 0;
    for (const b of blocks) {
      num++;
      if (!b.entryId) {
        const it = b.items[0];
        newPage();
        const groups = textLinesFor(it, width, true, num);
        const th = textHeight(groups);
        const ih = await drawMedia(it, M, top, width, bottom - top - th - 6);
        drawText(groups, M, top + (ih || 0) + 5);
        continue;
      }
      // Ráfaga: título una vez y las fotos de dos en dos, lado a lado, con su nota/medida.
      const gap = 6, colW = (width - gap) / 2;
      const title = cont => {
        newPage();
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...accent);
        doc.text(`${num}. ${b.items[0].caption || tr('Ráfaga')}${cont ? ` (${tr('cont.')})` : ''}`, M, top + 5);
        return top + 10;
      };
      let y = title(false);
      for (let k = 0; k < b.items.length; k += 2) {
        const pair = b.items.slice(k, k + 2);
        const texts = pair.map(it => textLinesFor(it, colW, false, num));
        const th = Math.max(...texts.map(textHeight));
        const imgMax = Math.min(colW * 1.25, (bottom - top - 10) / 2 - th - 3);
        if (y + imgMax + th + 3 > bottom) y = title(true);
        let rowBottom = y;
        for (let q = 0; q < pair.length; q++) {
          const x = M + q * (colW + gap);
          const ih = await drawMedia(pair[q], x, y, colW, imgMax) || 0;
          drawText(texts[q], x, y + ih + 2);
          rowBottom = Math.max(rowBottom, y + ih + 2 + textHeight(texts[q]));
        }
        y = rowBottom + gap;
      }
    }

    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(140);
      doc.text(tr('Página {i} de {n}', { i, n }), W - M, H - 5, { align: 'right' });
      doc.text(tr('Generado con Report Plus'), M, H - 5);
    }
    return { pdf: doc.output('blob'), videoFiles };
  }

  async function buildZip(data) {
    const { pdf, videoFiles } = await buildPdf(data);
    const zip = new JSZip();
    const base = slug(data.report.title) || tr('reporte');
    zip.file(`${base}.pdf`, pdf);
    data.items.forEach((it, i) => {
      if (it.type === 'video') zip.file('videos/' + videoFiles.get(it.id), it.blob);
      else zip.file(`${tr('fotos')}/${String(i + 1).padStart(2, '0')}.${ext(it.blob, 'jpg')}`, it.annotated || it.blob);
    });
    return zip.generateAsync({ type: 'blob' });
  }

  // Archivos de video con el mismo nombre que aparece en el PDF, para enviarlos aparte.
  // Nombre del PDF: "Cliente - Dirección, Residencial".
  function pdfName(client, report) {
    const place = [clean(client.address), clean(client.residential)].filter(Boolean).join(', ');
    return ([clean(client.name || report.title), place].filter(Boolean).join(' - ') || tr('reporte')).slice(0, 120) + '.pdf';
  }

  function videoFilesFor(items, clientName) {
    const vids = items.filter(i => i.type === 'video');
    let n = 0;
    return vids.map(i => new File([i.blob], videoName(i, ++n, clientName, vids.length), { type: (i.blob.type || 'video/mp4').split(';')[0] }));
  }

  return { buildPdf, buildZip, slug, pdfName, videoFilesFor };
})();
