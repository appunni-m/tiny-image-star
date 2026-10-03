const paths = {
  cursor: '<path d="M5 3.5 19 13l-6.2 1.2L10 20 5 3.5Z"/><path d="m12.8 14.1 3.1 5.1"/>',
  scale: '<path d="M4 8V4h4M20 16v4h-4M4 4l6 6m10 10-6-6"/><path d="M9 4h7a4 4 0 0 1 4 4v1M15 20H8a4 4 0 0 1-4-4v-1"/>',
  lasso: '<path d="M19.4 12.3c0 4.5-3.1 7.7-7.4 7.7s-7.4-3.2-7.4-7.7S7.7 4 12 4s7.4 3.2 7.4 7.7Z"/><path d="M12 20v1.2a1.8 1.8 0 0 0 3.6 0V20"/>',
  frame: '<rect x="3.5" y="4" width="17" height="16" rx="1.5"/><path d="M7 7h4v4H7z"/>',
  section: '<path d="M4 6.5h16M4 17.5h16"/><path d="M6 7v10m12-10v10"/>',
  slice: '<rect x="4" y="5" width="16" height="14" rx="1" stroke-dasharray="3 2"/><path d="M4 9h16"/>',
  rectangle: '<rect x="4" y="5" width="16" height="14" rx="1.5"/>',
  ellipse: '<circle cx="12" cy="12" r="8"/>',
  line: '<path d="m5 19 14-14"/>',
  polygon: '<path d="m12 3 8 6-3 10H7L4 9l8-6Z"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
  pen: '<path d="m5 19 3.2-7.4L16 4l4 4-7.6 7.8L5 19Z"/><path d="m8.2 11.6 4.2 4.2M16 4l4 4"/>',
  pencil: '<path d="m4 16.5-.8 4.3 4.3-.8L19.7 7.8a2.8 2.8 0 0 0-4-4L4 16.5Z"/><path d="m13.8 5.8 4.4 4.4"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="9" cy="9" r="1.5"/><path d="m5 17 5-5 3.5 3 2.5-2 3 4"/>',
  hand: '<path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V10 4.8a1.5 1.5 0 0 1 3 0V10 6a1.5 1.5 0 0 1 3 0v5.7l.8-1.4a1.6 1.6 0 0 1 2.8 1.6l-2.4 5A4.2 4.2 0 0 1 14.4 20h-1.6a5 5 0 0 1-3.7-1.7L5 13.8a1.7 1.7 0 0 1 2.5-2.3L10 14"/>',
  comment: '<path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.4 8.4 0 0 1-3.2-.6L4 20l1.2-3.6A7.2 7.2 0 0 1 4 12c0-4.2 3.6-7.5 8-7.5s8 2.8 8 7Z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>',
  eye: '<path d="M2.5 12s3.3-6 9.5-6 9.5 6 9.5 6-3.3 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
  rectangleSmall: '<rect x="5" y="6" width="14" height="12" rx="1"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  layerFrame: '<rect x="4" y="5" width="16" height="14" rx="1.4"/><path d="M8 8h4v4H8z"/>',
  layerText: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  layerImage: '<rect x="3.5" y="5" width="17" height="14" rx="1"/><circle cx="9" cy="9" r="1.3"/><path d="m5 17 5-5 3 3 2.5-2 3.5 4"/>',
  layerEllipse: '<circle cx="12" cy="12" r="7.5"/>',
  layerVector: '<path d="M5 18 9 6l10 4-8 8H5Z"/><circle cx="5" cy="18" r="1"/><circle cx="9" cy="6" r="1"/><circle cx="19" cy="10" r="1"/>',
  layerSection: '<path d="M4 6h16M4 18h16M6 7v10m12-10v10"/>',
  layerSlice: '<rect x="4" y="5" width="16" height="14" rx="1" stroke-dasharray="3 2"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
};

export function icon(name, size = 16) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.rectangle}</svg>`;
}
