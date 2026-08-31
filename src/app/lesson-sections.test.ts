import { describe, expect, test } from 'vitest';
import { splitLesson, splitReference } from './lesson-sections';

describe('splitLesson', () => {
  /**
   * The core contract with the reader UI: one `##` heading becomes one step a
   * reader can navigate to, so this split is what turns a flat lesson file
   * into the stepped screen.
   */
  test('splits on ## headings and keeps section bodies', () => {
    // Arrange
    const md = '## First\nalpha\n\n## Second\nbeta';

    // Act
    const split = splitLesson(md);

    // Assert
    expect(split).toEqual({
      preamble: '',
      sections: [
        { title: 'First', body: 'alpha' },
        { title: 'Second', body: 'beta' },
      ],
    });
  });

  /**
   * Several lessons open with a line of framing that belongs to no section.
   * Anything not carried out as the preamble is silently dropped from the page.
   */
  test('keeps text before the first heading as the preamble', () => {
    // Arrange
    const md = 'For each: requirements first.\n\n---\n\n## Design a Rate Limiter\nbody';

    // Act
    const split = splitLesson(md);

    // Assert
    expect(split.preamble).toBe('For each: requirements first.');
    expect(split.sections).toEqual([{ title: 'Design a Rate Limiter', body: 'body' }]);
  });

  /**
   * Python and shell blocks are full of `#` comment lines that are
   * indistinguishable from a heading once you are matching line starts.
   */
  test('ignores ## lines inside code fences', () => {
    // Arrange
    const md = '## Only\nbefore\n```\n## not a heading\n```\nafter';

    // Act
    const split = splitLesson(md);

    // Assert
    expect(split.sections).toHaveLength(1);
    expect(split.sections[0]?.body).toContain('## not a heading');
  });

  /**
   * STYLE.md separates sections with a rule, which belongs to the boundary and
   * not to the section. Kept, it renders as a stray line under every step.
   */
  test('strips a trailing horizontal rule at the end of a section', () => {
    // Arrange
    const md = '## A\nalpha\n\n---\n\n## B\nbeta\n\n---';

    // Act
    const split = splitLesson(md);

    // Assert
    expect(split.sections[0]?.body).toBe('alpha');
    expect(split.sections[1]?.body).toBe('beta');
  });

  /**
   * An unstepped lesson is legal. Everything has to land in the preamble,
   * because the caller renders that whole and would otherwise show nothing.
   */
  test('returns no sections for a body with no headings', () => {
    // Arrange
    const md = 'just prose';

    // Act
    const split = splitLesson(md);

    // Assert
    expect(split).toEqual({ preamble: 'just prose', sections: [] });
  });
});

describe('splitReference', () => {
  /**
   * Questions and their reference answers live in separate files, and the
   * number is the only join between them. Position in this array is what the
   * reader clicks through to, so it has to track the number, not the order.
   */
  test('maps numbered answers to their question index, heading dropped', () => {
    // Arrange
    const md = '### 1. First question?\nanswer one\n\n### 2. Second?\nanswer two';

    // Act
    const split = splitReference(md);

    // Assert
    expect(split).toEqual({ answers: ['answer one', 'answer two'], extra: '' });
  });

  /**
   * Reference keys end with material belonging to no single question. It has a
   * heading of its own, which has to survive because nothing else labels it.
   */
  test('collects un-numbered sections into extra, heading kept', () => {
    // Arrange
    const md = '### 1. Q?\na\n\n### Mental models\n- model one';

    // Act
    const split = splitReference(md);

    // Assert
    expect(split?.answers).toEqual(['a']);
    expect(split?.extra).toBe('### Mental models\n- model one');
  });

  /** The same fenced-code trap as splitLesson, one heading level down. */
  test('ignores heading-shaped lines inside code fences', () => {
    // Arrange
    const md = '### 1. Q?\n```\n### 2. not an answer\n```\ndone';

    // Act
    const split = splitReference(md);

    // Assert
    expect(split?.answers).toHaveLength(1);
    expect(split?.answers[0]).toContain('### 2. not an answer');
  });

  /**
   * Null is the signal, not an error: a key with no numbering is shown whole
   * rather than shredded into answers that would not line up with anything.
   */
  test('returns null when nothing is numbered, so the caller shows the key whole', () => {
    // Arrange
    const md = '### Notes\nno numbering here';

    // Act
    const split = splitReference(md);

    // Assert
    expect(split).toBeNull();
  });

  /**
   * A gap in the numbering must leave a hole rather than close up. Closing up
   * would shift every later answer onto the wrong question, which reads as
   * plausible prose and so would not be noticed.
   */
  test('leaves an empty string for a skipped number', () => {
    // Arrange
    const md = '### 1. Q?\na\n\n### 3. Q?\nc';

    // Act
    const split = splitReference(md);

    // Assert
    expect(split?.answers).toEqual(['a', '', 'c']);
  });
});
