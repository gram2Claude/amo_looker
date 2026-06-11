// Единый lookup переводов для Modal и Injector.
// langs приходит из amoCRM (self.langs) и имеет форму { widget: {...} } —
// ищем сначала под widget, затем в корне (совместимость с тестами/boot.js).
export function makeT(langs) {
  const roots = langs && langs.widget ? [langs.widget, langs] : [langs || {}];
  return function t(key, fallback) {
    for (const root of roots) {
      let node = root;
      for (const p of key.split('.')) {
        if (node == null || typeof node !== 'object') { node = undefined; break; }
        node = node[p];
      }
      if (typeof node === 'string') return node;
    }
    return fallback !== undefined ? fallback : key;
  };
}
