import { detectKind } from './fileUtils.js';
import { makeT } from './i18n.js';
import Loader from './loader.js';
import pdf    from './renderers/pdf.js';
import image  from './renderers/image.js';
import text   from './renderers/text.js';
import markdown from './renderers/markdown.js';
import office from './renderers/office.js';
import legacy from './renderers/legacy.js';

// docx/xlsx/pptx/csv → office (Microsoft Office viewer). Прежние клиентские
// рендереры docx-preview/SheetJS выпилены (git-история хранит, если понадобится
// offline-путь без Microsoft — см. 04_reviews/09).
const RENDERERS = { pdf, image, text, markdown, office, legacy };

export default class Modal {
  constructor({ $, langs, params }) {
    this.$ = $;
    this.langs = langs || {};
    this.params = params || {};
    this._tfn = makeT(this.langs);
    this.$root = null;
    this._loader = null;
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
    // храним ссылку на конкретный handler — снимаем именно его (не чужой namespace)
    this._onKeydown = (e) => { if (e.key === 'Escape') this.close(); };
    $(document).on('keydown.nxLooker', this._onKeydown);
    $('body').append(this.$root);

    const $body = this.$root.find('.nx-modal__body');

    // Неподдерживаемый формат → НЕ отправляем на legacy-конвертер (это слило бы
    // любой неизвестный файл на внешний сервис), а показываем «Скачать».
    const kind = file.kind || detectKind(file);
    if (!kind) {
      this._showError($body, this._tErr('unsupported'));
      return;
    }

    const loader = this._loader = new Loader();
    const renderer = RENDERERS[kind] || RENDERERS.legacy;
    Promise.resolve()
      .then(() => renderer({
        $, file, $body,
        params: this.params,
        langs: this.langs,
        loader
      }))
      .catch((err) => {
        if (err && err.name === 'AbortError') return;   // модалку закрыли — молча
        // модалку успели закрыть/переоткрыть — не трогаем чужой $body
        if (this._loader !== loader) return;
        const key = err && err.langKey;
        const msg = key ? this._tErr(key, err.langParams) : this._tErr('fetch_failed');
        this._showError($body, msg);
      });
  }

  close() {
    if (this._loader) { this._loader.dispose(); this._loader = null; }
    if (this.$root) {
      this.$root.remove();
      this.$root = null;
    }
    if (this._onKeydown) {
      this.$(document).off('keydown.nxLooker', this._onKeydown);
      this._onKeydown = null;
    }
  }

  _showError($body, msg) {
    $body.empty().append(this.$('<div class="nx-modal__error"/>').text(msg));
  }

  _t(key) {
    return this._tfn(key);
  }

  // Локализованный текст ошибки с подстановкой {{param}}.
  _tErr(langKey, params) {
    let s = this._t('errors.' + langKey);
    if (s === 'errors.' + langKey) s = langKey;   // нет перевода — отдаём ключ
    if (params) for (const k of Object.keys(params)) s = s.replace('{{' + k + '}}', params[k]);
    return s;
  }
}
