import { marked } from 'marked';
import Prism from 'prismjs';

// Only the grammars the content uses; the full set is close to a megabyte.
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-c';

/**
 * Lesson markdown to HTML. One module because `marked.use` configures a
 * global renderer; a second caller would make output depend on import order.
 *
 * The output goes in via `dangerouslySetInnerHTML`, which is safe because
 * lesson bodies come from the content build, never from user input. The day
 * content accepts submissions, this needs a sanitizer.
 */

/** CQL is close enough to SQL for Prism; a real CQL grammar is not worth
 * the bytes for a handful of blocks. */
const GRAMMARS: Record<string, string> = { cql: 'sql' };

marked.use({
  renderer: {
    // A fence with no grammar falls through to escaped text: most fenced
    // blocks are ASCII diagrams, and a tokenizer turns a drawing into
    // confetti.
    code({ text, lang }) {
      const name = GRAMMARS[lang ?? ''] ?? lang ?? '';
      const grammar = Prism.languages[name];
      if (!grammar) return `<pre><code>${escapeHtml(text)}</code></pre>`;
      const html = Prism.highlight(text, grammar, name);
      return `<pre class="language-${name}"><code>${html}</code></pre>`;
    },
    // Labelled asides, all the same shape: a lesson section opens on TLDR and
    // closes on interview phrasing, and an answer card ends on Example. Each
    // is tagged by its label so the stylesheet can colour the label alone.
    blockquote({ tokens }) {
      const body = this.parser.parse(tokens);
      const label = /^<p><strong>(TLDR|Example|Interview phrasing):<\/strong>/.exec(body.trim());
      const kind = { TLDR: 'tldr', Example: 'example', 'Interview phrasing': 'phrasing' }[
        label?.[1] ?? ''
      ];
      return `<blockquote${kind ? ` class="${kind}"` : ''}>\n${body}</blockquote>\n`;
    },
  },
});

/**
 * Bracketed glossing, `**term** [what it means]`, is how the lessons define a
 * word in place. The term and the gloss are marked separately so the styling
 * can carry which is which: brackets read as punctuation to skip, where a
 * parenthesised aside reads as one. Marking it here rather than in the
 * content keeps the source plain and lets the styling change in one place.
 * Link syntax is left alone, and inline code is lifted out first so a
 * definition may contain it.
 */
function markDefinitions(md: string): string {
  return md
    .split(/(```[\s\S]*?```)/g)
    .map((chunk, index) => {
      if (index % 2) return chunk;
      const code: string[] = [];
      const stashed = chunk.replace(/`[^`\n]*`/g, (span) => `\u0000${code.push(span) - 1}\u0000`);
      return stashed
        .replace(/\[([^\][]+?)\](?!\()/g, '<span class="define">($1)</span>')
        .replace(/\u0000(\d+)\u0000/g, (whole, n: string) => code[Number(n)] ?? whole);
    })
    .join('');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderMarkdown(md: string): string {
  return marked.parse(markDefinitions(md)) as string;
}
