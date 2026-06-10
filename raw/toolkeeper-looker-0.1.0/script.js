// Toolkeeper Looker — generated bundle, do not edit
// version 0.1.0
define(["jquery"], function ($) {
var TKLooker = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/script.js
  var script_exports = {};
  __export(script_exports, {
    default: () => makeWidget
  });

  // src/fileUtils.js
  var EXT_TO_KIND = {
    pdf: "pdf",
    jpg: "image",
    jpeg: "image",
    png: "image",
    gif: "image",
    webp: "image",
    svg: "image",
    txt: "text",
    csv: "text",
    json: "text",
    md: "text",
    log: "text",
    docx: "docx",
    xlsx: "xlsx",
    doc: "legacy",
    xls: "legacy",
    ppt: "legacy",
    pptx: "legacy",
    rtf: "legacy",
    odt: "legacy",
    ods: "legacy",
    odp: "legacy"
  };
  function extractExt(file) {
    const name = (file.name || "").toLowerCase();
    const fromName = name.match(/\.([a-z0-9]+)(?:$|\?)/);
    if (fromName) return fromName[1];
    const href = (file.href || "").toLowerCase().split("?")[0];
    const fromHref = href.match(/\.([a-z0-9]+)$/);
    return fromHref ? fromHref[1] : "";
  }
  function detectKind(file) {
    const ext = extractExt(file);
    return EXT_TO_KIND[ext] || null;
  }
  function canPreview(file) {
    return !!detectKind(file);
  }

  // src/inject.js
  var FILE_ROW_SELECTORS = [
    ".feed-compose-attach",
    ".feed__item__attach",
    ".feed-note__attach-file",
    ".task-detail__notes-attach",
    ".notes-wrapper [data-id]",
    'a[href*="/download/files/"]',
    'a[href*="drive.amocrm"]'
  ];
  var FEED_ROOT_SELECTORS = [
    ".feed-container",
    ".card-feed",
    ".notes-wrapper",
    ".linked-forms__contacts"
  ];
  var INJECTED_ATTR = "data-tk-injected";
  var Injector = class {
    constructor({ $, onEyeClick }) {
      this.$ = $;
      this.onEyeClick = onEyeClick;
      this.observer = null;
      this._click = this._click.bind(this);
    }
    start() {
      const roots = this._findRoots();
      if (!roots.length) {
        setTimeout(() => this.start(), 800);
        return;
      }
      this.observer = new MutationObserver((mutations) => {
        mutations.forEach((m) => {
          m.addedNodes.forEach((n) => {
            if (n.nodeType === 1) this._injectInto(n);
          });
        });
      });
      roots.forEach((root) => {
        this.observer.observe(root, { childList: true, subtree: true });
        this._injectInto(root);
      });
      this.$(document).on("click.tkLooker", ".tk-eye", this._click);
    }
    stop() {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      this.$(document).off("click.tkLooker");
      this.$(".tk-eye").remove();
      this.$(`[${INJECTED_ATTR}]`).removeAttr(INJECTED_ATTR);
    }
    _findRoots() {
      const found = [];
      FEED_ROOT_SELECTORS.forEach((sel) => {
        this.$(sel).each(function() {
          found.push(this);
        });
      });
      return found;
    }
    _injectInto(node) {
      FILE_ROW_SELECTORS.forEach((sel) => {
        const matches = node.matches && node.matches(sel) ? [node] : node.querySelectorAll ? node.querySelectorAll(sel) : [];
        Array.prototype.forEach.call(matches, (row) => {
          if (row.getAttribute(INJECTED_ATTR)) return;
          const meta = this._extractMeta(row);
          if (!meta || !meta.href) return;
          if (!canPreview(meta)) return;
          row.setAttribute(INJECTED_ATTR, "1");
          row.appendChild(this._makeButton(meta));
        });
      });
    }
    _extractMeta(row) {
      const link = row.matches && row.matches("a") ? row : row.querySelector("a[href]");
      if (!link) return null;
      return {
        href: link.href,
        name: link.textContent.trim() || link.getAttribute("download") || "file"
      };
    }
    _makeButton(meta) {
      const btn = document.createElement("span");
      btn.className = "tk-eye";
      btn.setAttribute("data-href", meta.href);
      btn.setAttribute("data-name", meta.name);
      btn.setAttribute("title", "\u041F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440");
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 5c-7 0-11 7-11 7s4 7 11 7 11-7 11-7-4-7-11-7zm0 11a4 4 0 110-8 4 4 0 010 8zm0-2a2 2 0 100-4 2 2 0 000 4z"/></svg>';
      return btn;
    }
    _click(e) {
      e.preventDefault();
      e.stopPropagation();
      const $btn = this.$(e.currentTarget);
      this.onEyeClick({
        href: $btn.data("href"),
        name: $btn.data("name")
      });
    }
  };

  // src/renderers/pdf.js
  function render({ $, file, $body }) {
    return new Promise((resolve) => {
      const $iframe = $('<iframe class="tk-render-pdf"/>').attr("src", file.href);
      $body.empty().append($iframe);
      $iframe.on("load", resolve);
      setTimeout(resolve, 4e3);
    });
  }

  // src/renderers/image.js
  function render2({ $, file, $body }) {
    return new Promise((resolve) => {
      const $img = $('<img class="tk-render-image"/>').attr("src", file.href).attr("alt", file.name);
      $body.empty().append($img);
      $img.on("load", resolve).on("error", () => {
        $body.empty().append($('<div class="tk-modal__error"/>').text("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u043A\u0430\u0440\u0442\u0438\u043D\u043A\u0443"));
        resolve();
      });
    });
  }

  // src/renderers/text.js
  var MAX = 2 * 1024 * 1024;
  function render3({ $, file, $body }) {
    return fetch(file.href, { credentials: "include" }).then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      const len = r.headers.get("content-length");
      if (len && Number(len) > MAX) throw new Error("\u0424\u0430\u0439\u043B \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0431\u043E\u043B\u044C\u0448\u043E\u0439 \u0434\u043B\u044F \u0442\u0435\u043A\u0441\u0442\u043E\u0432\u043E\u0433\u043E \u043F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0430");
      return r.text();
    }).then((txt) => {
      $body.empty().append($('<pre class="tk-render-text"/>').text(txt));
    });
  }

  // src/renderers/docx.js
  function ensureLib(params) {
    if (window.docx) return Promise.resolve(window.docx);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      const cdnBase = params && params.path ? params.path : "";
      s.src = cdnBase + "/vendor/docx-preview.min.js";
      s.onload = () => resolve(window.docx);
      s.onerror = () => reject(new Error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C docx-preview"));
      document.head.appendChild(s);
    });
  }
  function render4({ file, $body, params }) {
    return Promise.all([
      ensureLib(params),
      fetch(file.href, { credentials: "include" }).then((r) => r.arrayBuffer())
    ]).then(([docx, buf]) => {
      const container = document.createElement("div");
      container.className = "tk-render-docx";
      $body.empty().append(container);
      return docx.renderAsync(buf, container);
    });
  }

  // src/renderers/xlsx.js
  var MAX2 = 10 * 1024 * 1024;
  function ensureLib2(params) {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      const cdnBase = params && params.path ? params.path : "";
      s.src = cdnBase + "/vendor/xlsx.full.min.js";
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C SheetJS"));
      document.head.appendChild(s);
    });
  }
  function render5({ $, file, $body, params }) {
    return Promise.all([
      ensureLib2(params),
      fetch(file.href, { credentials: "include" }).then((r) => {
        const len = r.headers.get("content-length");
        if (len && Number(len) > MAX2) throw new Error("XLSX \u0431\u043E\u043B\u044C\u0448\u0435 10 \u041C\u0411 \u2014 \u0441\u043A\u0430\u0447\u0430\u0439\u0442\u0435 \u0444\u0430\u0439\u043B");
        return r.arrayBuffer();
      })
    ]).then(([XLSX, buf]) => {
      const wb = XLSX.read(buf, { type: "array" });
      const $wrap = $('<div class="tk-render-xlsx"/>');
      const $tabs = $('<div class="tk-xlsx-tabs"/>');
      const $sheet = $('<div class="tk-xlsx-sheet"/>');
      wb.SheetNames.forEach((name, i) => {
        const $tab = $('<button class="tk-xlsx-tab"/>').text(name).on("click", () => {
          $tabs.find(".tk-xlsx-tab").removeClass("is-active");
          $tab.addClass("is-active");
          $sheet.html(XLSX.utils.sheet_to_html(wb.Sheets[name]));
        });
        if (i === 0) $tab.addClass("is-active");
        $tabs.append($tab);
      });
      $sheet.html(XLSX.utils.sheet_to_html(wb.Sheets[wb.SheetNames[0]]));
      $wrap.append($tabs).append($sheet);
      $body.empty().append($wrap);
    });
  }

  // src/renderers/legacy.js
  var DEFAULT_ENDPOINT = "https://amo-conv.toolkeeper.io/convert";
  function render6({ $, file, $body, settings }) {
    const endpoint = settings && settings.converter_url || DEFAULT_ENDPOINT;
    const token = settings && settings.converter_token || "";
    return fetch(file.href, { credentials: "include" }).then((r) => r.arrayBuffer()).then((buf) => fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Filename": encodeURIComponent(file.name),
        "X-Source-Token": token
      },
      body: buf
    })).then((r) => {
      if (!r.ok) throw new Error("\u041A\u043E\u043D\u0432\u0435\u0440\u0442\u0435\u0440 \u0432\u0435\u0440\u043D\u0443\u043B " + r.status);
      return r.blob();
    }).then((blob) => {
      const url = URL.createObjectURL(blob);
      return render({ $, file: { href: url, name: file.name + ".pdf" }, $body });
    });
  }

  // src/modal.js
  var RENDERERS = { pdf: render, image: render2, text: render3, docx: render4, xlsx: render5, legacy: render6 };
  var Modal = class {
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
        '<div class="tk-modal-overlay"><div class="tk-modal"><div class="tk-modal__head"><span class="tk-modal__name"></span><a class="tk-modal__download" target="_blank" rel="noopener"></a><button class="tk-modal__close" aria-label="Close">&times;</button></div><div class="tk-modal__body"><div class="tk-modal__loading"></div></div></div></div>'
      );
      this.$root.find(".tk-modal__name").text(file.name);
      this.$root.find(".tk-modal__download").attr("href", file.href).text(this._t("modal.download"));
      this.$root.find(".tk-modal__loading").text(this._t("modal.loading"));
      this.$root.on("click", (e) => {
        if (e.target === this.$root[0]) this.close();
      });
      this.$root.find(".tk-modal__close").on("click", () => this.close());
      $(document).on("keydown.tkLooker", (e) => {
        if (e.key === "Escape") this.close();
      });
      $("body").append(this.$root);
      const kind = file.kind || detectKind(file) || "legacy";
      const renderer = RENDERERS[kind] || RENDERERS.legacy;
      const $body = this.$root.find(".tk-modal__body");
      Promise.resolve().then(() => renderer({ $, file, $body, params: this.params, settings: this.getSettings(), langs: this.langs })).catch((err) => {
        $body.empty().append($('<div class="tk-modal__error"/>').text(String(err && err.message || err)));
      });
    }
    close() {
      if (this.$root) {
        this.$root.remove();
        this.$root = null;
      }
      this.$(document).off("keydown.tkLooker");
    }
    _t(key) {
      const parts = key.split(".");
      const roots = this.langs && this.langs.widget ? [this.langs.widget, this.langs] : [this.langs || {}];
      for (const root of roots) {
        let node = root;
        for (const p of parts) {
          if (node == null || typeof node !== "object") {
            node = void 0;
            break;
          }
          node = node[p];
        }
        if (typeof node === "string") return node;
      }
      return key;
    }
  };

  // src/script.js
  function makeWidget($) {
    return function CustomWidget() {
      const self = this;
      self._injector = null;
      self._modal = null;
      self._area = null;
      this.callbacks = {
        render() {
          return true;
        },
        init() {
          self._area = self.system().area;
          self._modal = new Modal({ $, langs: self.langs, params: self.params, getSettings: () => self.get_settings() });
          self._injector = new Injector({ $, onEyeClick: (file) => self._modal.open(file) });
          self._injector.start();
          return true;
        },
        bind_actions() {
          return true;
        },
        settings() {
          return true;
        },
        advancedSettings() {
          return true;
        },
        onSave() {
          return true;
        },
        destroy() {
          if (self._injector) self._injector.stop();
          if (self._modal) self._modal.close();
        }
      };
    };
  }
  return __toCommonJS(script_exports);
})();

var factory = (typeof TKLooker !== "undefined" && TKLooker.default) ? TKLooker.default : null;
return factory ? factory($) : null;
});