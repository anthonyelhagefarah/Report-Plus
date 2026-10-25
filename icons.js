// Íconos de línea (trazo fino, toman el color del texto). Uso: ic('gear')
const ICONS = {
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M10.3 2.5h3.4l.5 2.6 1.6.9 2.5-.9 1.7 2.9-2 1.8v1.9l2 1.8-1.7 2.9-2.5-.9-1.6.9-.5 2.6h-3.4l-.5-2.6-1.6-.9-2.5.9-1.7-2.9 2-1.8v-1.9l-2-1.8 1.7-2.9 2.5.9 1.6-.9z"/>',
  camera: '<path d="M3.5 7.5h4l1.6-2.5h5.8l1.6 2.5h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-16a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.2" r="3.8"/><circle cx="12" cy="13.2" r="2.2"/><path d="M5 6V5.2h2"/><circle cx="18.6" cy="10" r=".4"/>',
  burst: '<path d="M14.5 7.5h-2.4L10.8 5.5H6.2L4.9 7.5H3.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6"/><circle cx="10.5" cy="13.4" r="3.5"/><circle cx="10.5" cy="13.4" r="2"/><path d="M19 1.2l1 2.7 2.6-1.2-1.2 2.6 2.7 1-2.7 1 1.2 2.6-2.6-1.2-1 2.7-1-2.7-2.6 1.2 1.2-2.6-2.7-1 2.7-1-1.2-2.6 2.6 1.2z"/>',
  video: '<path d="M3.5 7.5h4l1.6-2.5h5.8l1.6 2.5h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-16a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.2" r="3.8"/><path d="M11 11.4v3.6l2.9-1.8z"/><circle cx="18.6" cy="10" r=".4"/>',
  gallery: '<path d="M7 5.5V3.5h14v12.5h-2"/><rect x="3" y="7.5" width="15.5" height="13" rx=".8"/><circle cx="8" cy="11.5" r="1.5"/><path d="M3 18l4.5-4.2 3 2.7 3.2-3.5 4.8 4.8M3 17.8v2.7"/>',
  folder: '<path d="M3 18.5V5.5a1 1 0 0 1 1-1h4.5l2 2h7.5a1 1 0 0 1 1 1v2"/><path d="M3 18.5l2.4-8.2a1 1 0 0 1 1-.8h14.2a1 1 0 0 1 1 1.3l-2.3 7.7a1 1 0 0 1-1 .7H4a1 1 0 0 1-1-.7z"/>',
  trash: '<path d="M3.5 6.8L20.5 5"/><path d="M9.6 5.9a2.4 2.4 0 0 1 4.6-.5"/><path d="M5.5 8.5l1.3 11.6a1 1 0 0 0 1 .9h8.4a1 1 0 0 0 1-.9l1.3-11.6"/><path d="M10 11v7M14 11v7"/>',
  xcircle: '<circle cx="12" cy="12" r="9.5"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/>',
  plus: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7v10M7 12h10"/>',
  pin: '<path d="M12 21.5s-6.5-7.2-6.5-12a6.5 6.5 0 0 1 13 0c0 4.8-6.5 12-6.5 12z"/><circle cx="12" cy="9.5" r="2.5"/>',
  satellite: '<g transform="rotate(-45 12 12)"><rect x="9.8" y="9.8" width="4.4" height="4.4" rx=".5"/><rect x="1.5" y="9" width="6" height="6" rx=".4"/><rect x="16.5" y="9" width="6" height="6" rx=".4"/><path d="M4.5 9v6M1.5 12h6M19.5 9v6M16.5 12h6M7.5 12h2.3M14.2 12h2.3M12 14.2v1.3M9.5 15.5a2.5 2.5 0 0 0 5 0z"/><path d="M9.8 19.3a3.5 3.5 0 0 0 4.4 0M8.6 21.3a6 6 0 0 0 6.8 0"/></g>',
  house: '<path d="M2.5 12L12 3.5l9.5 8.5"/><path d="M16 7.3V4.5h2.5v5"/><path d="M5 10v10.5h14V10"/><path d="M10 20.5V15h4v5.5"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/>',
  lock: '<rect x="4" y="10.5" width="16" height="11" rx="1.5"/><path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5"/><circle cx="12" cy="15" r="1.4"/><path d="M12 16.4v2.4"/>',
  arrow: '<path d="M10.6 21h2.8V9.5h3.6L12 3.5 7 9.5h3.6z"/>',
  report: '<rect x="5" y="4.5" width="14" height="17" rx="1.5"/><path d="M9 4.5V3h6v1.5a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1zM8.5 10h7M8.5 13.5h7M8.5 17h4.5"/>',
  phone: '<path d="M5 3.5h3.5l1.6 4.4-2.2 1.4a11 11 0 0 0 6.8 6.8l1.4-2.2 4.4 1.6V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.1 1.5 1.5 0 0 1 5 3.5z"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="1.5"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>',
  pencil: '<path d="M4 20l1-4.2L16.2 4.6a1.8 1.8 0 0 1 2.6 0l.6.6a1.8 1.8 0 0 1 0 2.6L8.2 19z"/><path d="M14.5 6.3l3.2 3.2M4 20l4.2-1"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
};
// rot: 0 = arriba, 90 = derecha, 180 = abajo, 270 = izquierda (solo para la flecha).
const ic = (name, rot = 0) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"${rot ? ` style="transform:rotate(${rot}deg)"` : ''}>${ICONS[name]}</svg>`;
