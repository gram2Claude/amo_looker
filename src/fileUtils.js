const EXT_TO_KIND = {
  pdf: 'pdf',
  // svg НЕ предпросматриваем inline: <img src=blob:svg> исполнит встроенные
  // скрипты/обработчики (XSS внутри страницы amoCRM) → отдаём на «Скачать».
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image',
  txt: 'text', json: 'text', md: 'text', log: 'text',
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
