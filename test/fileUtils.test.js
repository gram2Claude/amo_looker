import { describe, it, expect } from 'vitest';
import { extractExt, detectKind, canPreview } from '../src/fileUtils.js';

describe('extractExt', () => {
  it('берёт расширение из имени', () => {
    expect(extractExt({ name: 'КП Burberry.docx' })).toBe('docx');
    expect(extractExt({ name: 'смета.XLSX' })).toBe('xlsx');
  });
  it('берёт расширение из href, игнорируя query', () => {
    expect(extractExt({ href: 'https://x/download/drive/a/b/file.pdf?sign=jwt' })).toBe('pdf');
  });
  it('пусто, если расширения нет', () => {
    expect(extractExt({ name: 'noext', href: 'https://x/y' })).toBe('');
  });
});

describe('detectKind', () => {
  it('маппит целевые форматы', () => {
    expect(detectKind({ name: 'a.pdf' })).toBe('pdf');
    expect(detectKind({ name: 'a.jpg' })).toBe('image');
    expect(detectKind({ name: 'a.png' })).toBe('image');
    expect(detectKind({ name: 'a.txt' })).toBe('text');
    expect(detectKind({ name: 'a.md' })).toBe('markdown');
    expect(detectKind({ name: 'a.docx' })).toBe('office');
    expect(detectKind({ name: 'a.pptx' })).toBe('office');
    expect(detectKind({ name: 'a.xlsx' })).toBe('office');
    expect(detectKind({ name: 'a.csv' })).toBe('office');
    expect(detectKind({ name: 'a.doc' })).toBe('legacy');
    expect(detectKind({ name: 'a.xls' })).toBe('legacy');
    expect(detectKind({ name: 'a.ppt' })).toBe('legacy');
  });
  it('null для неизвестного формата', () => {
    expect(detectKind({ name: 'photo.heic' })).toBe(null);
    expect(detectKind({ name: 'archive.zip' })).toBe(null);
  });
  it('svg исключён из image (XSS) → не предпросматривается', () => {
    expect(detectKind({ name: 'icon.svg' })).toBe(null);
    expect(canPreview({ name: 'icon.svg' })).toBe(false);
  });
});

describe('canPreview', () => {
  it('true для поддерживаемых, false для остального', () => {
    expect(canPreview({ name: 'a.pdf' })).toBe(true);
    expect(canPreview({ name: 'a.heic' })).toBe(false);
  });
});
