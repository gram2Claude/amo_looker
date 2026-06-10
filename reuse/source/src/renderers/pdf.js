// Phase: simple <iframe> backed by the file URL. amoCRM file URLs are
// typically served with inline-disposition for PDFs and the browser can
// render them natively. If that fails we'll move to pdf.js (vendor/).
export default function render({ $, file, $body }) {
  return new Promise((resolve) => {
    const $iframe = $('<iframe class="tk-render-pdf"/>').attr('src', file.href);
    $body.empty().append($iframe);
    $iframe.on('load', resolve);
    setTimeout(resolve, 4000);
  });
}
