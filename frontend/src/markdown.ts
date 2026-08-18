import { marked } from 'marked';
import Prism from 'prismjs';

// Core plus exactly the grammars the seeds use, not the "every language" build.
// Each is a few kilobytes; the full set is close to a megabyte.
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-c';

/**
 * Turning seeded lesson markdown into HTML, in one place.
 *
 * It is one place because `marked` is configured globally: calling `marked.use`
 * from two modules would leave the renderer depending on which imported first.
 * Everything that renders lesson text comes through here instead.
 *
 * **The output goes in via `dangerouslySetInnerHTML`**, which is safe here for a
 * reason worth stating rather than assuming: these bodies are seeded by a
 * migration from a fixed set of notes, no user writes them, and no route
 * updates them. The day lessons accept submissions is the day this needs a
 * sanitizer in front of it. Highlighting does not change that: Prism only ever
 * sees text `marked` already escaped.
 */

/** Cassandra's query language is close enough to SQL for Prism's grammar, and
 * shipping a CQL grammar for two code blocks is not worth the bytes. */
const GRAMMARS: Record<string, string> = { cql: 'sql' };

marked.use({
  renderer: {
    /**
     * `marked` removed its `highlight` option in v5, so colouring happens by
     * replacing the code renderer rather than by configuration.
     *
     * A fence with no language, or one Prism has no grammar for, falls through
     * to plain escaped text. That matters more than it sounds: most fenced
     * blocks in these lessons are ASCII diagrams, and running a tokenizer over
     * a drawing produces confetti.
     */
    code({ text, lang }) {
      const name = GRAMMARS[lang ?? ''] ?? lang ?? '';
      const grammar = Prism.languages[name];

      // Escaped by hand on the fallback path, because this renderer owns the
      // whole `<pre>` and nothing downstream will do it.
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

/** Lesson markdown as HTML, with code blocks coloured. */
export function renderMarkdown(md: string): string {
  return marked.parse(md) as string;
}
