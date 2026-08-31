import { describe, expect, test } from 'vitest';
import { renderMarkdown } from './markdown';

/**
 * The renderer the lessons actually go through. Pure, so this needs no browser
 * and no running stack.
 */
describe('rendering lesson markdown', () => {
  /** Most code in these lessons is Python, so this is the highlighter's
   * ordinary case: the grammar is loaded and the language class reaches the
   * page for the stylesheet to hook. */
  test('colours a Python block', () => {
    // Arrange
    const md = '```python\ndef add(a, b):\n    return a + b\n```';

    // Act
    const html = renderMarkdown(md);

    // Assert
    expect(html).toContain('language-python');
    expect(html).toContain('token keyword');
  });

  /** Cassandra is close enough to SQL for Prism, and two blocks do not earn a
   * second grammar, so cql is aliased rather than taught. */
  test('colours SQL, and treats CQL as SQL', () => {
    // Arrange
    const languages = ['sql', 'cql'];

    // Act and assert, one grammar lookup at a time
    for (const lang of languages) {
      const html = renderMarkdown(`\`\`\`${lang}\nSELECT id FROM users;\n\`\`\``);
      expect(html, lang).toContain('token keyword');
    }
  });

  /**
   * The case that matters most, because most fenced blocks in these lessons are
   * ASCII diagrams. Running a tokenizer over a drawing produces confetti, so an
   * unlabelled fence has to come out as plain text.
   */
  test('leaves an unlabelled block alone', () => {
    // Arrange
    const md = '```\n high addresses  +------+\n                 | stack|\n```';

    // Act
    const html = renderMarkdown(md);

    // Assert
    expect(html).not.toContain('token');
    expect(html).toContain('high addresses');
  });

  /** A label with no grammar behind it has to degrade to plain text rather
   * than throw or emit half-tokenised markup. */
  test('leaves a language it has no grammar for alone', () => {
    // Arrange
    const md = '```protobuf\nmessage M { string a = 1; }\n```';

    // Act
    const html = renderMarkdown(md);

    // Assert
    expect(html).not.toContain('token');
  });

  /**
   * The fallback path builds its own `<pre>`, so nothing downstream escapes for
   * it. A lesson containing a tag must not become that tag.
   */
  test('escapes markup in code rather than emitting it', () => {
    // Arrange
    const md = '```\n<script>alert(1)</script>\n```';

    // Act
    const html = renderMarkdown(md);

    // Assert
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  /** The custom passes run over the same source as base markdown, so this
   * pins that they did not eat it on the way through. */
  test('still renders ordinary prose', () => {
    // Arrange
    const md = '**bold** and `code`';

    // Act
    const html = renderMarkdown(md);

    // Assert
    expect(html).toContain('<strong>bold</strong>');
  });

  /**
   * Three of the four marks that are a contract between the lessons and this
   * renderer. Renaming a label silently un-styles every lesson using it, which
   * is why the exact strings are pinned here rather than in a lesson.
   */
  test('tags each labelled aside, and leaves an unlabelled quote plain', () => {
    // Arrange
    const md =
      '> **TLDR:** short.\n\n> **Example:** like so.\n\n> **Interview phrasing:** say this.\n\n> just a quote.';

    // Act
    const html = renderMarkdown(md);

    // Assert
    expect(html).toContain('<blockquote class="tldr">');
    expect(html).toContain('<blockquote class="example">');
    expect(html).toContain('<blockquote class="phrasing">');
    expect(html).toContain('<blockquote>\n<p>just a quote.</p>');
  });

  /** The fourth mark. Brackets read as punctuation to skip, so the parens are
   * the whole point of the transform; inline code inside has to survive it. */
  test('renders a definition as a parenthesised gloss, code and all', () => {
    // Arrange
    const md = 'A **global** [a variable `any` function can write] is shared.';

    // Act
    const html = renderMarkdown(md);

    // Assert
    expect(html).toContain('<span class="define">(a variable <code>any</code> function can write)');
    expect(html).not.toContain('[a variable');
  });

  /** The bolded term is optional: a gloss can follow prose that already named
   * the thing, and the pattern must not require a term to fire. */
  test('still glosses a definition with no term in front of it', () => {
    // Arrange
    const md = 'it uses a [conflict-free replicated data type] here';

    // Act
    const html = renderMarkdown(md);

    // Assert
    expect(html).toContain('<span class="define">(conflict-free replicated data type)</span>');
  });

  /**
   * The three ways the definition pattern can misfire. A markdown link differs
   * from a gloss only by what follows the closing bracket, and array syntax is
   * everywhere in the code blocks.
   */
  test('leaves link syntax and code brackets alone', () => {
    // Arrange
    const link = 'see [the docs](https://example.com)';
    const arrayInBlock = '```python\nxs = [1, 2]\n```';
    const indexInline = 'the value `xs[0]` is first';

    // Act
    const renderedLink = renderMarkdown(link);
    const renderedBlock = renderMarkdown(arrayInBlock);
    const renderedInline = renderMarkdown(indexInline);

    // Assert
    expect(renderedLink).not.toContain('define');
    expect(renderedBlock).not.toContain('define');
    expect(renderedInline).not.toContain('define');
  });
});
