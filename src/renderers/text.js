const MAX = 2 * 1024 * 1024;  // лимит проверяется loader'ом по реальному размеру

// Текст через loader: байты → декод UTF-8 → <pre>. .text() в loader не делаем,
// чтобы единый путь (abort/limit/objectURL) жил в одном месте.
export default function render({ $, file, $body, loader }) {
  return loader.fetchBuffer(file.href, { maxBytes: MAX }).then(({ buf }) => {
    const txt = new TextDecoder('utf-8').decode(buf);
    $body.empty().append($('<pre class="nx-render-text"/>').text(txt));
  });
}
