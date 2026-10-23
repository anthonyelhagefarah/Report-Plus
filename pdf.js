// Generación del PDF y del paquete ZIP (PDF + videos + fotos originales).
const Exporter = (() => {
  const blobToImage = blob => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img); img.onerror = rej;
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
    return { data: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height };
  }

  const ext = (blob, fallback) => {
    const m = (blob.type || '').split('/')[1];
    return m ? m.replace('quicktime', 'mov').replace('jpeg', 'jpg').split(';')[0] : fallback;
  };
  const slug = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  const fmtDur = s => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '';

  function videoName(item, n) {
    return `videos/${String(n).padStart(2, '0')}${item.caption ? '_' + slug(item.caption) : ''}.${ext(item.blob, 'mp4')}`;
  }

  async function buildPdf({ company, client, report, sections, items }) {
    const { jsPDF } = window.jspdf;
    const L = report.layout || { orientation: 'portrait', cols: 2, rows: 3 };
    const doc = new jsPDF({ orientation: L.orientation, unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const M = 12, headerH = 14, footerH = 10;
    const accent = [15, 92, 140];
    const videoFiles = new Map();
    let videoCount = 0;
    items.filter(i => i.type === 'video').forEach(i => videoFiles.set(i.id, videoName(i, ++videoCount)));

    const header = () => {
      doc.setFillColor(...accent); doc.rect(0, 0, W, 2, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(40);
      doc.text(report.title || 'Reporte', M, 9);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(110);
      doc.text([client.name, company.name].filter(Boolean).join(' · '), W - M, 9, { align: 'right' });
      doc.setDrawColor(220); doc.line(M, 11.5, W - M, 11.5);
    };

    // Portada
    if (report.cover !== false) {
      let y = 30;
      if (company.logo) {
        const lg = await toJpeg(company.logo, 600);
        const h = 28, w = Math.min(70, h * lg.w / lg.h);
        doc.addImage(lg.data, 'JPEG', (W - w) / 2, y, w, h); y += h + 10;
      }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(24); doc.setTextColor(20);
      doc.text(doc.splitTextToSize(report.title || 'Reporte', W - 2 * M), W / 2, y + 8, { align: 'center' }); y += 22;
      doc.setFontSize(14); doc.setFont('helvetica', 'normal'); doc.setTextColor(70);
      const lines = [
        client.name && `Cliente: ${client.name}`,
        (report.location || client.address) && `Ubicación: ${report.location || client.address}`,
        `Fecha: ${new Date(report.date || Date.now()).toLocaleDateString('es')}`,
      ].filter(Boolean);
      lines.forEach(l => { doc.text(l, W / 2, y, { align: 'center' }); y += 8; });
      const coverItem = items.find(i => i.id === report.coverItemId) || items.find(i => i.type === 'photo');
      if (coverItem && report.coverImage !== false) {
        const im = await toJpeg(coverItem.annotated || coverItem.blob || coverItem.thumb);
        const maxW = W - 4 * M, maxH = H - y - 55;
        const k = Math.min(maxW / im.w, maxH / im.h);
        if (k > 0) { doc.addImage(im.data, 'JPEG', (W - im.w * k) / 2, y + 6, im.w * k, im.h * k); }
      }
      doc.setFontSize(10); doc.setTextColor(90);
      const cinfo = [company.name, company.contact, company.phone, company.email].filter(Boolean);
      cinfo.forEach((l, i) => doc.text(l, W / 2, H - 30 + i * 5, { align: 'center' }));
      if (report.notes) {
        doc.addPage(); header();
        doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(20);
        doc.text('Observaciones', M, 24);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(50);
        doc.text(doc.splitTextToSize(report.notes, W - 2 * M), M, 32);
      }
    }

    const gap = 5, captionH = 13;
    const cellW = (W - 2 * M - gap * (L.cols - 1)) / L.cols;
    let first = report.cover === false;

    for (const sec of sections) {
      const secItems = items.filter(i => i.sectionId === sec.id);
      if (!secItems.length) continue;
      const perPage = L.cols * L.rows;
      for (let p = 0; p < secItems.length; p += perPage) {
        if (!first) doc.addPage(); first = false;
        header();
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...accent);
        doc.text(sec.title + (p ? ' (cont.)' : ''), M, headerH + 7);
        if (sec.text && !p) {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(60);
        }
        const textLines = sec.text && !p ? doc.splitTextToSize(sec.text, W - 2 * M).slice(0, 4) : [];
        if (textLines.length) doc.text(textLines, M, headerH + 13);
        const top = headerH + 11 + textLines.length * 4.5;
        const cellH = (H - top - footerH - gap * (L.rows - 1)) / L.rows;
        const imgH = cellH - captionH;
        const page = secItems.slice(p, p + perPage);
        for (let k = 0; k < page.length; k++) {
          const it = page[k];
          const x = M + (k % L.cols) * (cellW + gap);
          const y = top + Math.floor(k / L.cols) * (cellH + gap);
          const src = it.type === 'video' ? it.thumb : (it.annotated || it.blob);
          doc.setFillColor(245); doc.rect(x, y, cellW, imgH, 'F');
          if (src) {
            const im = await toJpeg(src);
            const s = Math.min(cellW / im.w, imgH / im.h);
            const iw = im.w * s, ih = im.h * s;
            doc.addImage(im.data, 'JPEG', x + (cellW - iw) / 2, y + (imgH - ih) / 2, iw, ih);
          }
          if (it.type === 'video') {
            const cx = x + cellW / 2, cy = y + imgH / 2, r = Math.min(cellW, imgH) * 0.12;
            doc.setFillColor(0, 0, 0); doc.circle(cx, cy, r, 'F');
            doc.setFillColor(255, 255, 255);
            doc.triangle(cx - r * 0.35, cy - r * 0.5, cx - r * 0.35, cy + r * 0.5, cx + r * 0.55, cy, 'F');
            doc.setFillColor(220, 40, 40); doc.rect(x, y, 22, 6, 'F');
            doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(255);
            doc.text(`VIDEO ${fmtDur(it.duration)}`, x + 11, y + 4.2, { align: 'center' });
          }
          doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(30);
          const num = items.indexOf(it) + 1;
          const cap = [`${num}. ${it.caption || ''}`.trim(), it.measure && `Medida: ${it.measure}`].filter(Boolean).join('  ·  ');
          doc.text(doc.splitTextToSize(cap, cellW).slice(0, 2), x, y + imgH + 4);
          if (it.type === 'video') {
            doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(120);
            doc.text(`Archivo: ${videoFiles.get(it.id)}`, x, y + imgH + 11.5);
          }
        }
      }
    }

    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(140);
      doc.text(`Página ${i} de ${n}`, W - M, H - 5, { align: 'right' });
      doc.text('Generado con Report Plus', M, H - 5);
    }
    return { pdf: doc.output('blob'), videoFiles };
  }

  async function buildZip(data) {
    const { pdf, videoFiles } = await buildPdf(data);
    const zip = new JSZip();
    const base = slug(data.report.title) || 'reporte';
    zip.file(`${base}.pdf`, pdf);
    data.items.forEach((it, i) => {
      if (it.type === 'video') zip.file(videoFiles.get(it.id), it.blob);
      else zip.file(`fotos/${String(i + 1).padStart(2, '0')}.${ext(it.blob, 'jpg')}`, it.annotated || it.blob);
    });
    return zip.generateAsync({ type: 'blob' });
  }

  return { buildPdf, buildZip, slug };
})();
