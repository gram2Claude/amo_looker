const EXT_TO_KIND = {
  pdf: 'pdf',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', svg: 'image',
  txt: 'text', csv: 'text', json: 'text', md: 'text', log: 'text',
  docx: 'docx',
  xlsx: 'xlsx',
  doc: 'legacy', xls: 'legacy', ppt: 'legacy', pptx: 'legacy', rtf: 'legacy', odt: 'legacy', ods: 'legacy', odp: 'legacy'
};

export function extractExt(file) {
  const name = (file.name || '').toLowerCase();
  const fromName = name.match(/\.([a-z0-9]+)(?:$|\?)/);
  if (fromName) return fromName[1];
  const href = (file.href || '').toLowerCase().split('?')[0];
  const fromHref = href.match(/\.([a-z0-9]+)$/);
  return fromHref ? fromHref[1] : '';
}

export function detectKind(file) {
  const ext = extractExt(file);
  return EXT_TO_KIND[ext] || null;
}

export function canPreview(file) {
  return !!detectKind(file);
}
