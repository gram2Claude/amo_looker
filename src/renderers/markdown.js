import markdownit from 'markdown-it';

const MAX = 2 * 1024 * 1024;

// markdown-it инлайнится в бандл esbuild'ом (npm-зависимость): требование amoCRM
// п. 3.2 запрещает догрузку скриптов через createElement('script').
//
// Markdown → HTML с разметкой. Безопасность: html:false (raw HTML/<script> в .md
// НЕ исполняется, экранируется), markdown-it дефолтно фильтрует опасные ссылки
// (javascript:/data:) — XSS закрыт без доп. санитайзера.
export default function render({ $, file, $body, loader }) {
  return loader.fetchBuffer(file.href, { maxBytes: MAX })
    .then(({ buf }) => {
      const text = new TextDecoder('utf-8').decode(buf);
      const md = markdownit({ html: false, linkify: true, typographer: true, breaks: false });
      const container = document.createElement('div');
      container.className = 'nx-render-md';
      container.innerHTML = md.render(text);
      // ссылки — в новой вкладке, безопасный rel
      container.querySelectorAll('a[href]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
      // внешние картинки в .md (![](url)) не должны утекать origin/referrer кабинета amoCRM
      container.querySelectorAll('img').forEach((img) => { img.referrerPolicy = 'no-referrer'; img.loading = 'lazy'; });
      $body.empty().append(container);
    });
}
