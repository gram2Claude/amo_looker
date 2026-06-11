const EXT_TO_KIND = {
  pdf: 'pdf',
  // svg показываем ТОЛЬКО через <img src=blob:> — в img-контексте браузер НЕ
  // исполняет встроенные в svg скрипты/обработчики и блокирует внешние запросы,
  // поэтому XSS-вектор закрыт. Inline-вставку (innerHTML/object/iframe) НЕ применять.
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', svg: 'image',
  txt: 'text', json: 'text', log: 'text',
  md: 'markdown', markdown: 'markdown',   // .md рендерим с разметкой (markdown-it)
  // docx/pptx/xlsx/csv → Office Online viewer (Word/PP/Excel-вид). ВНИМАНИЕ: файл уходит к Microsoft.
  docx: 'office', pptx: 'office', xlsx: 'office', csv: 'office',
  doc: 'legacy', xls: 'legacy', ppt: 'legacy', rtf: 'legacy', odt: 'legacy', ods: 'legacy', odp: 'legacy'
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
