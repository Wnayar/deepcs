import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

/**
 * The renderer the lessons actually go through. Pure, so this needs no browser
 * and no running stack.
 */
describe('rendering lesson markdown', () => {
  it('colours a Python block', () => {
    const html = renderMarkdown('```python\ndef add(a, b):\n    return a + b\n```');

    expect(html).toContain('language-python');
    expect(html).toContain('token keyword');
  });

  it('colours SQL, and treats CQL as SQL', () => {
    // Cassandra is close enough to SQL for Prism, and two blocks do not earn a
    // second grammar.
    for (const lang of ['sql', 'cql']) {
      const html = renderMarkdown(`\`\`\`${lang}\nSELECT id FROM users;\n\`\`\``);
      expect(html, lang).toContain('token keyword');
    }
  });

  /**
   * The case that matters most, because most fenced blocks in these lessons are
   * ASCII diagrams. Running a tokenizer over a drawing produces confetti, so an
   * unlabelled fence has to come out as plain text.
   */
  it('leaves an unlabelled block alone', () => {
    const html = renderMarkdown('```\n high addresses  +------+\n                 | stack|\n```');

    expect(html).not.toContain('token');
    expect(html).toContain('high addresses');
  });

  it('leaves a language it has no grammar for alone', () => {
    const html = renderMarkdown('```protobuf\nmessage M { string a = 1; }\n```');
    expect(html).not.toContain('token');
  });

  it('escapes markup in code rather than emitting it', () => {
    // The fallback path builds its own <pre>, so nothing downstream escapes for
    // it. A lesson containing a tag must not become that tag.
    const html = renderMarkdown('```\n<script>alert(1)</script>\n```');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('still renders ordinary prose', () => {
    expect(renderMarkdown('**bold** and `code`')).toContain('<strong>bold</strong>');
  });
});
