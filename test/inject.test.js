import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Injector from '../src/inject.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, '..', 'work_directory', 'tests', 'fixtures', 'dom');
const NOTE_DOCX = readFileSync(join(FIX, 'feed_note_docx_full.html'), 'utf8');

// Минимальная jQuery-подобная обёртка: Injector использует $(sel).each / .on /
// .off / .remove / .removeAttr / .data — реализуем ровно нужное на нативном DOM.
function makeJQ() {
  const jq = (arg) => {
    let nodes;
    if (typeof arg === 'string') nodes = Array.from(document.querySelectorAll(arg));
    else if (arg === document) nodes = [document];
    else if (arg && arg.nodeType) nodes = [arg];
    else nodes = [];
    return {
      _nodes: nodes,
      each(fn) { nodes.forEach((n, i) => fn.call(n, i, n)); return this; },
      on(ev, sel, handler) {
        const [type, ns] = ev.split('.');
        nodes.forEach((n) => {
          const h = (e) => {
            const t = e.target.closest ? e.target.closest(sel) : null;
            if (t && n.contains(t)) {
              // currentTarget в jsdom — getter-only, поэтому отдаём прокси
              handler({
                currentTarget: t,
                target: e.target,
                preventDefault: () => e.preventDefault(),
                stopPropagation: () => e.stopPropagation()
              });
            }
          };
          n.__nx = n.__nx || []; n.__nx.push({ type, ns, h });
          n.addEventListener(type, h);
        });
        return this;
      },
      off(ev) {
        const [type] = ev.split('.');
        nodes.forEach((n) => {
          (n.__nx || []).filter((r) => r.type === type).forEach((r) => n.removeEventListener(r.type, r.h));
          n.__nx = (n.__nx || []).filter((r) => r.type !== type);
        });
        return this;
      },
      remove() { nodes.forEach((n) => n.remove()); return this; },
      removeAttr(a) { nodes.forEach((n) => n.removeAttribute(a)); return this; },
      data(k) { return nodes[0] ? nodes[0].getAttribute('data-' + k) : undefined; },
      append(child) { nodes.forEach((n) => n.appendChild(child)); return this; }
    };
  };
  return jq;
}

function mountFeed(innerHtml) {
  document.body.innerHTML =
    '<div class="notes-wrapper"><div class="notes-wrapper__notes js-notes">' + innerHtml + '</div></div>';
  return document.querySelector('.js-notes');
}

describe('Injector — инъекция глазика на реальной разметке ленты', () => {
  let jq;
  beforeEach(() => { jq = makeJQ(); document.body.innerHTML = ''; });

  it('вставляет глазик у вложения docx', () => {
    mountFeed(NOTE_DOCX);
    const inj = new Injector({ $: jq, onEyeClick: () => {} });
    inj.start();
    const eyes = document.querySelectorAll('.nx-eye');
    expect(eyes.length).toBe(1);
    expect(eyes[0].getAttribute('data-name')).toBe('test_doc.docx');
    expect(eyes[0].getAttribute('data-href')).toContain('test_doc.docx');
    inj.stop();
  });

  it('не дублирует при повторном проходе по той же строке', () => {
    const root = mountFeed(NOTE_DOCX);
    const inj = new Injector({ $: jq, onEyeClick: () => {} });
    inj.start();
    // повторная инъекция в тот же контейнер (имитация мутации/реренда)
    inj._injectInto(root);
    inj._injectInto(root);
    expect(document.querySelectorAll('.nx-eye').length).toBe(1);
    inj.stop();
  });

  it('stop() убирает глазики и снимает метки', () => {
    mountFeed(NOTE_DOCX);
    const inj = new Injector({ $: jq, onEyeClick: () => {} });
    inj.start();
    expect(document.querySelectorAll('.nx-eye').length).toBe(1);
    inj.stop();
    expect(document.querySelectorAll('.nx-eye').length).toBe(0);
    expect(document.querySelectorAll('[data-nx-injected]').length).toBe(0);
  });

  it('клик по глазику зовёт onEyeClick с href и name', () => {
    mountFeed(NOTE_DOCX);
    const onEyeClick = vi.fn();
    const inj = new Injector({ $: jq, onEyeClick });
    inj.start();
    document.querySelector('.nx-eye').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(onEyeClick).toHaveBeenCalledOnce();
    const arg = onEyeClick.mock.calls[0][0];
    expect(arg.name).toBe('test_doc.docx');
    expect(arg.href).toContain('test_doc.docx');
    inj.stop();
  });

  it('retry-таймер отменяется в stop() (observer не воскресает)', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div></div>';  // ленты нет → start() уйдёт в retry
    const inj = new Injector({ $: jq, onEyeClick: () => {} });
    inj.start();
    expect(inj._retryTimer).not.toBeNull();
    inj.stop();
    expect(inj._retryTimer).toBeNull();
    // лента появилась ПОСЛЕ destroy — отменённый таймер не должен ничего вставить
    mountFeed(NOTE_DOCX);
    vi.runAllTimers();
    expect(document.querySelectorAll('.nx-eye').length).toBe(0);
    vi.useRealTimers();
  });

  it('повторный start() не плодит наблюдатели (идемпотентность)', () => {
    mountFeed(NOTE_DOCX);
    const inj = new Injector({ $: jq, onEyeClick: () => {} });
    inj.start();
    const first = inj.observer;
    inj.start();
    expect(inj.observer).not.toBe(first);   // старый снят, создан новый
    expect(document.querySelectorAll('.nx-eye').length).toBe(1);  // без дублей
    inj.stop();
  });

  it('неподдерживаемый формат (heic) не получает глазик', () => {
    mountFeed(
      '<div class="feed-note-wrapper feed-note-wrapper-note"><div class="feed-note__joined-attach">' +
      '<div class="feed-note__joined-attach-item"><div class="feed-note__joined-attach-item__content">' +
      '<a href="https://venskons78.amocrm.ru/download/drive/x/y/photo.heic" class="feed-note__joined-attach__link">photo.heic</a>' +
      '</div></div></div></div>'
    );
    const inj = new Injector({ $: jq, onEyeClick: () => {} });
    inj.start();
    expect(document.querySelectorAll('.nx-eye').length).toBe(0);
    inj.stop();
  });
});
