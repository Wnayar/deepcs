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
  },
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderMarkdown(md: string): string {
  return marked.parse(md) as string;
}
