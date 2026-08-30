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

/** The labels are a contract with the lessons (CLAUDE.md); renaming one here
 * silently un-styles every lesson that uses it. */
const ASIDE_CLASSES: Record<string, string> = {
  TLDR: 'tldr',
  Example: 'example',
  'Interview phrasing': 'phrasing',
};

const ASIDE_LABEL = /^<p><strong>(TLDR|Example|Interview phrasing):<\/strong>/;

marked.use({
  renderer: {
    // A fence with no grammar falls through to escaped text: most fenced
    // blocks are ASCII diagrams, and a tokenizer turns a drawing into
    // confetti.
    code({ text, lang }) {
      const requested = lang ?? '';
      const name = GRAMMARS[requested] ?? requested;
      const grammar = Prism.languages[name];

      if (!grammar) {
        return `<pre><code>${escapeHtml(text)}</code></pre>`;
      }

      const html = Prism.highlight(text, grammar, name);

      return `<pre class="language-${name}"><code>${html}</code></pre>`;
    },

    // Labelled asides, all the same shape: a lesson section opens on TLDR and
    // closes on interview phrasing, and an answer card ends on Example. Each
    // is tagged by its label so the stylesheet can colour the label alone.
    blockquote({ tokens }) {
      const body = this.parser.parse(tokens);
      const labelled = ASIDE_LABEL.exec(body.trim());
      const label = labelled === null ? '' : (labelled[1] ?? '');
      const kind = ASIDE_CLASSES[label];

      if (kind === undefined) {
        return `<blockquote>\n${body}</blockquote>\n`;
      }

      return `<blockquote class="${kind}">\n${body}</blockquote>\n`;
    },
  },
});

/** A character no lesson can contain, so a stashed span cannot be confused
 * with prose. */
const STASH = '\u0000';

/** Puts the stashed code spans back where their placeholders sit. */
function restoreCode(text: string, code: string[]): string {
  return text.replace(/\u0000(\d+)\u0000/g, (whole, digits: string) => {
    const span = code[Number(digits)];

    return span ?? whole;
  });
}

/** Marks the glosses in one run of prose, leaving its inline code alone. */
function markChunk(chunk: string): string {
  // Inline code is lifted out first so a definition may contain it.
  const code: string[] = [];
  const stashed = chunk.replace(/`[^`\n]*`/g, (span) => {
    code.push(span);

    return `${STASH}${code.length - 1}${STASH}`;
  });

  // Link syntax is left alone: the lookahead skips a `]` followed by `(`.
  const glossed = stashed.replace(/\[([^\][]+?)\](?!\()/g, '<span class="define">($1)</span>');

  return restoreCode(glossed, code);
}

/**
 * Bracketed glossing, `**term** [what it means]`, is how the lessons define a
 * word in place. The term and the gloss are marked separately so the styling
 * can carry which is which: brackets read as punctuation to skip, where a
 * parenthesised aside reads as one. Marking it here rather than in the
 * content keeps the source plain and lets the styling change in one place.
 */
function markDefinitions(md: string): string {
  // The capture group makes split keep the fences: odd indices are the fenced
  // blocks themselves, which pass through untouched.
  const chunks = md.split(/(```[\s\S]*?```)/g);
  const out: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i] ?? '';
    const isFence = i % 2 === 1;

    if (isFence) {
      out.push(chunk);
    } else {
      out.push(markChunk(chunk));
    }
  }

  return out.join('');
}

/** The four characters that would otherwise open a tag or close an attribute. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** One lesson body, ready for the step page. */
export function renderMarkdown(md: string): string {
  return marked.parse(markDefinitions(md)) as string;
}
