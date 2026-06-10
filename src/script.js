import Injector from './inject.js';
import Modal    from './modal.js';

// AMD entry point: this whole bundle is wrapped at build time in
//   define(['jquery'], function ($) { /* bundle */ return CustomWidget; });
//
// `$` is the local jQuery instance amoCRM passes in. We expose CustomWidget
// at the bottom of the bundle so the AMD footer can return it.

export default function makeWidget($) {
  return function CustomWidget() {
    const self = this;
    self._injector = null;
    self._modal    = null;
    self._area     = null;

    this.callbacks = {
      render() { return true; },

      init() {
        self._area     = self.system().area;
        self._modal    = new Modal({ $, langs: self.langs, params: self.params, getSettings: () => self.get_settings() });
        self._injector = new Injector({ $, onEyeClick: (file) => self._modal.open(file) });
        self._injector.start();
        return true;
      },

      bind_actions()       { return true; },
      settings()           { return true; },
      advancedSettings()   { return true; },
      onSave()             { return true; },

      destroy() {
        if (self._injector) self._injector.stop();
        if (self._modal)    self._modal.close();
      }
    };
  };
}
