import pdfRender from './pdf.js';

const DEFAULT_ENDPOINT = 'https://nexus-oko.naithon.one/convert';

export default function render({ $, file, $body, settings }) {
  const endpoint = (settings && settings.converter_url) || DEFAULT_ENDPOINT;
  const token    = (settings && settings.converter_token) || '';

  return fetch(file.href, { credentials: 'same-origin' })
    .then((r) => r.arrayBuffer())
    .then((buf) => fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name),
        'X-Source-Token': token
      },
      body: buf
    }))
    .then((r) => {
      if (!r.ok) throw new Error('Конвертер вернул ' + r.status);
      return r.blob();
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      return pdfRender({ $, file: { href: url, name: file.name + '.pdf' }, $body });
    });
}
