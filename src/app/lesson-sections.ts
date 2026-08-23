/**
 * Splitting seeded markdown into the pieces the step page shows one at a time.
 *
 * Both splitters walk line by line and track fenced code blocks, because a
 * line starting with `##` inside ``` fences is code, not a heading. Both are
 * pure so they can be tested without a browser.
 */

export interface LessonSection {
  title: string;
  body: string;
}

export interface SplitLesson {
  /** Anything before the first `##` heading. Usually empty; one seeded lesson
   * opens with a one-line framing sentence, shown above its first section. */
  preamble: string;
  sections: LessonSection[];
}

/**
 * Splits a lesson on its top-level `##` headings, one section per screen.
 *
 * e.g. "intro\n## A\na body\n## B\nb body" becomes
 * { preamble: "intro", sections: [{ title: "A", body: "a body" }, ...] }.
 */
export function splitLesson(md: string): SplitLesson {
  let inFence = false;
  const head: { title: string | null; lines: string[] } = { title: null, lines: [] };
  let current = head;
  const chunks = [head];

  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && line.startsWith('## ')) {
      current = { title: line.slice(3).trim(), lines: [] };
      chunks.push(current);
    } else {
      current.lines.push(line);
    }
  }

  // The seeds separate sections with a horizontal rule before the next
  // heading; once sections are separate screens it is a stray line at the
  // bottom of each one. The blank-line requirement keeps a setext heading's
  // underline ("Title\n---") intact.
  const text = (chunk: { lines: string[] }) =>
    chunk.lines
      .join('\n')
      .replace(/\n\s*\n-{3,}\s*$/, '')
      .trim();

  return {
    preamble: text(head),
    sections: chunks.slice(1).map((chunk) => ({ title: chunk.title as string, body: text(chunk) })),
  };
}

export interface SplitReference {
  /** answers[i] belongs to parts[i]; the `### N.` heading itself is dropped
   * because the card showing the answer already shows the question. */
  answers: string[];
  /** Un-numbered `###` sections (e.g. "Mental models"), headings kept. */
  extra: string;
}

/**
 * Splits a reference answer key into one answer per question.
 *
 * The seeds write answer keys as "### 1. Process vs thread?\n...\n### 2. ..."
 * with the number matching the question's position in `parts`. Returns null
 * when no numbered heading is found, so the caller can fall back to showing
 * the key whole.
 */
export function splitReference(md: string): SplitReference | null {
  let inFence = false;
  const answers: string[][] = [];
  const extra: string[] = [];
  let target = extra;
  let found = false;

  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const numbered = inFence ? null : /^### (\d+)\./.exec(line);
    if (numbered) {
      found = true;
      target = [];
      answers[Number(numbered[1]) - 1] = target;
      continue;
    }
    if (!inFence && line.startsWith('### ')) target = extra;
    target.push(line);
  }

  if (!found) return null;
  return {
    answers: Array.from(answers, (lines) => (lines ?? []).join('\n').trim()),
    extra: extra.join('\n').trim(),
  };
}
