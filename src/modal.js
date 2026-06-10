import { detectKind } from './fileUtils.js';
import pdf    from './renderers/pdf.js';
import image  from './renderers/image.js';
import text   from './renderers/text.js';
import docx   from './renderers/docx.js';
import xlsx   from './renderers/xlsx.js';
import legacy from './renderers/legacy.js';

const RENDERERS = { pdf, image, text, docx, xlsx, legacy };

export default class Modal {
  constructor({ $, langs, params, getSettings }) {
    this.$ = $;
    this.langs = langs || {};
    this.params = params || {};
    this.getSettings = getSettings || (() => ({}));
    this.$root = null;
  }

  open(file) {
    this.close();
    const $ = this.$;
    this.$root = $(
      '<div class="nx-modal-overlay">' +
        '<div class="nx-modal">' +
          '<div class="nx-modal__head">' +
            '<span class="nx-modal__name"></span>' +
            '<a class="nx-modal__download" target="_blank" rel="noopener"></a>' +
            '<button class="nx-modal__close" aria-label="Close">&times;</button>' +
          '</div>' +
          '<div class="nx-modal__body"><div class="nx-modal__loading"></div></div>' +
        '</div>' +
      '</div>'
    );
    this.$root.find('.nx-modal__name').text(file.name);
    this.$root.find('.nx-modal__download').attr('href', file.href).text(this._t('modal.download'));
    this.$root.find('.nx-modal__loading').text(this._t('modal.loading'));
    this.$root.on('click', (e) => { if (e.target === this.$root[0]) this.close(); });
    this.$root.find('.nx-modal__close').on('click', () => this.close());
    $(document).on('keydown.nxLooker', (e) => { if (e.key === 'Escape') this.close(); });
    $('body').append(this.$root);

    const kind = file.kind || detectKind(file) || 'legacy';
    const renderer = RENDERERS[kind] || RENDERERS.legacy;
    const $body = this.$root.find('.nx-modal__body');
    Promise.resolve()
      .then(() => renderer({ $, file, $body, params: this.params, settings: this.getSettings(), langs: this.langs }))
      .catch((err) => {
        $body.empty().append($('<div class="nx-modal__error"/>').text(String(err && err.message || err)));
      });
  }

  close() {
    if (this.$root) {
      this.$root.remove();
      this.$root = null;
    }
    this.$(document).off('keydown.nxLooker');
  }

  _t(key) {
    const parts = key.split('.');
    const roots = this.langs && this.langs.widget ? [this.langs.widget, this.langs] : [this.langs || {}];
    for (const root of roots) {
      let node = root;
      for (const p of parts) {
        if (node == null || typeof node !== 'object') { node = undefined; break; }
        node = node[p];
      }
      if (typeof node === 'string') return node;
    }
    return key;
  }
}
