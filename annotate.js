// Editor de anotaciones: flechas, círculos, rectángulos, cotas de medida, texto y trazo libre.
// Las figuras se guardan como vectores para poder volver a editarlas.
const Annotator = (() => {
  const COLORS = ['#e53935', '#fdd835', '#43a047', '#1e88e5', '#ffffff', '#000000'];
  const TOOLS = [
    ['arrow', '➚', 'Flecha'], ['measure', '↔', 'Medida'], ['circle', '◯', 'Círculo'],
    ['rect', '▭', 'Rectángulo'], ['text', 'T', 'Texto'], ['pen', '✎', 'Libre'],
  ];

  function drawShape(ctx, s, scale) {
    const lw = s.width * scale;
    ctx.save();
    ctx.strokeStyle = s.color; ctx.fillStyle = s.color;
    ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const [x1, y1, x2, y2] = s.p || [];
    if (s.type === 'arrow' || s.type === 'measure') {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      const head = (a, bx, by) => {
        const h = lw * 4;
        ctx.beginPath(); ctx.moveTo(bx, by);
        ctx.lineTo(bx - h * Math.cos(a - 0.45), by - h * Math.sin(a - 0.45));
        ctx.lineTo(bx - h * Math.cos(a + 0.45), by - h * Math.sin(a + 0.45));
        ctx.closePath(); ctx.fill();
      };
      const ang = Math.atan2(y2 - y1, x2 - x1);
      head(ang, x2, y2);
      if (s.type === 'measure') {
        head(ang + Math.PI, x1, y1);
        if (s.text) label(ctx, s.text, (x1 + x2) / 2, (y1 + y2) / 2, s, scale);
      }
    } else if (s.type === 'circle') {
      ctx.beginPath();
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.type === 'rect') {
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (s.type === 'pen') {
      ctx.beginPath();
      s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    } else if (s.type === 'text') {
      label(ctx, s.text, x1, y1, s, scale);
    }
    ctx.restore();
  }

  function label(ctx, text, x, y, s, scale) {
    const size = Math.round(s.width * scale * 6);
    ctx.font = `bold ${size}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + size * 0.6;
    ctx.fillStyle = s.color === '#000000' ? '#ffffff' : 'rgba(0,0,0,0.65)';
    ctx.fillRect(x - w / 2, y - size * 0.7, w, size * 1.4);
    ctx.fillStyle = s.color;
    ctx.fillText(text, x, y);
  }

  function loadImage(blob) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(blob);
    });
  }

  // Dibuja la imagen con sus anotaciones y devuelve un JPEG.
  async function render(blob, shapes) {
    const img = await loadImage(blob);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const scale = Math.max(c.width, c.height) / 1000;
    shapes.forEach(s => drawShape(ctx, s, scale));
    URL.revokeObjectURL(img.src);
    return new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  }

  function open(blob, initialShapes = []) {
    return new Promise(async (resolve) => {
      const img = await loadImage(blob);
      const shapes = initialShapes.map(s => JSON.parse(JSON.stringify(s)));
      let tool = 'arrow', color = COLORS[0], width = 4, current = null;

      const wrap = document.createElement('div');
      wrap.className = 'annot';
      wrap.innerHTML = `
        <div class="annot-bar">
          <button data-act="cancel">Cancelar</button>
          <span class="spacer"></span>
          <button data-act="undo" title="Deshacer">↶</button>
          <button data-act="clear" title="Borrar todo">🗑</button>
          <button data-act="save" class="primary">Guardar</button>
        </div>
        <div class="annot-stage"><canvas></canvas></div>
        <div class="annot-tools">
          ${TOOLS.map(([k, ic, t]) => `<button data-tool="${k}" title="${t}"><b>${ic}</b><small>${t}</small></button>`).join('')}
        </div>
        <div class="annot-colors">
          ${COLORS.map(c => `<button data-color="${c}" style="background:${c}" aria-label="color ${c}"></button>`).join('')}
          <select data-act="width" aria-label="Grosor">
            <option value="2">Fino</option><option value="4" selected>Medio</option><option value="7">Grueso</option>
          </select>
        </div>`;
      document.body.appendChild(wrap);
      document.body.classList.add('noscroll');

      const canvas = wrap.querySelector('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(canvas.width, canvas.height) / 1000;

      const redraw = () => {
        ctx.drawImage(img, 0, 0);
        shapes.forEach(s => drawShape(ctx, s, scale));
        if (current) drawShape(ctx, current, scale);
      };
      const sync = () => {
        wrap.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
        wrap.querySelectorAll('[data-color]').forEach(b => b.classList.toggle('on', b.dataset.color === color));
      };
      const pos = e => {
        const r = canvas.getBoundingClientRect();
        return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height];
      };

      canvas.addEventListener('pointerdown', e => {
        e.preventDefault();
        const [x, y] = pos(e);
        if (tool === 'text') {
          const t = prompt('Texto:');
          if (t) { shapes.push({ type: 'text', color, width, p: [x, y], text: t }); redraw(); }
          return;
        }
        canvas.setPointerCapture(e.pointerId);
        current = tool === 'pen' ? { type: 'pen', color, width, pts: [[x, y]] } : { type: tool, color, width, p: [x, y, x, y] };
      });
      canvas.addEventListener('pointermove', e => {
        if (!current) return;
        const [x, y] = pos(e);
        if (current.type === 'pen') current.pts.push([x, y]); else { current.p[2] = x; current.p[3] = y; }
        redraw();
      });
      const finish = () => {
        if (!current) return;
        const s = current; current = null;
        const tiny = s.p && Math.hypot(s.p[2] - s.p[0], s.p[3] - s.p[1]) < 5;
        if (!tiny) {
          if (s.type === 'measure') s.text = prompt('Medida (ej. 2.35 m):', '') || '';
          shapes.push(s);
        }
        redraw();
      };
      canvas.addEventListener('pointerup', finish);
      canvas.addEventListener('pointercancel', finish);

      const close = (result) => {
        wrap.remove(); document.body.classList.remove('noscroll');
        URL.revokeObjectURL(img.src);
        resolve(result);
      };

      wrap.addEventListener('click', async e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.tool) tool = b.dataset.tool;
        if (b.dataset.color) color = b.dataset.color;
        const act = b.dataset.act;
        if (act === 'undo') shapes.pop();
        if (act === 'clear' && confirm('¿Borrar todas las anotaciones?')) shapes.length = 0;
        if (act === 'cancel') return close(null);
        if (act === 'save') {
          current = null; redraw();
          const out = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
          return close({ shapes, blob: shapes.length ? out : null });
        }
        sync(); redraw();
      });
      wrap.querySelector('[data-act=width]').addEventListener('change', e => { width = +e.target.value; });
      sync(); redraw();
    });
  }

  return { open, render };
})();
