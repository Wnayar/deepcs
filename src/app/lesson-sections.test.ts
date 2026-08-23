import { describe, expect, it } from 'vitest';
import { splitLesson, splitReference } from './lesson-sections';

describe('splitLesson', () => {
  it('splits on ## headings and keeps section bodies', () => {
    const md = '## First\nalpha\n\n## Second\nbeta';
    expect(splitLesson(md)).toEqual({
      preamble: '',
      sections: [
        { title: 'First', body: 'alpha' },
        { title: 'Second', body: 'beta' },
      ],
    });
  });

  it('keeps text before the first heading as the preamble', () => {
    const md = 'For each: requirements first.\n\n---\n\n## Design a Rate Limiter\nbody';
    const split = splitLesson(md);
    expect(split.preamble).toBe('For each: requirements first.');
    expect(split.sections).toEqual([{ title: 'Design a Rate Limiter', body: 'body' }]);
  });

  it('ignores ## lines inside code fences', () => {
    const md = '## Only\nbefore\n```\n## not a heading\n```\nafter';
    const split = splitLesson(md);
    expect(split.sections).toHaveLength(1);
    expect(split.sections[0]?.body).toContain('## not a heading');
  });

  it('strips a trailing horizontal rule at the end of a section', () => {
    const md = '## A\nalpha\n\n---\n\n## B\nbeta\n\n---';
    const split = splitLesson(md);
    expect(split.sections[0]?.body).toBe('alpha');
    expect(split.sections[1]?.body).toBe('beta');
  });

  it('returns no sections for a body with no headings', () => {
    expect(splitLesson('just prose')).toEqual({ preamble: 'just prose', sections: [] });
  });
});

describe('splitReference', () => {
  it('maps numbered answers to their question index, heading dropped', () => {
    const md = '### 1. First question?\nanswer one\n\n### 2. Second?\nanswer two';
    expect(splitReference(md)).toEqual({
      answers: ['answer one', 'answer two'],
      extra: '',
    });
  });

  it('collects un-numbered sections into extra, heading kept', () => {
    const md = '### 1. Q?\na\n\n### Mental models\n- model one';
    const split = splitReference(md);
    expect(split?.answers).toEqual(['a']);
    expect(split?.extra).toBe('### Mental models\n- model one');
  });

  it('ignores heading-shaped lines inside code fences', () => {
    const md = '### 1. Q?\n```\n### 2. not an answer\n```\ndone';
    const split = splitReference(md);
    expect(split?.answers).toHaveLength(1);
    expect(split?.answers[0]).toContain('### 2. not an answer');
  });

  it('returns null when nothing is numbered, so the caller shows the key whole', () => {
    expect(splitReference('### Notes\nno numbering here')).toBeNull();
  });

  it('leaves an empty string for a skipped number', () => {
    const md = '### 1. Q?\na\n\n### 3. Q?\nc';
    expect(splitReference(md)?.answers).toEqual(['a', '', 'c']);
  });
});
