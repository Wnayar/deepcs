/**
 * Splits lesson and answer-key markdown into the pieces the step page shows
 * one at a time. Both splitters track fenced code blocks: a `##` inside
 * ``` fences is code, not a heading.
 */

export interface LessonSection {
  title: string;
  body: string;
}

export interface SplitLesson {
  /** Anything before the first `##` heading, shown above the first section. */
  preamble: string;
  sections: LessonSection[];
}

/**
 * Splits a lesson on its top-level `##` headings, one section per screen.
 * "intro\n## A\na body" becomes
 * { preamble: "intro", sections: [{ title: "A", body: "a body" }] }.
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

  // Lessons may end a section with a horizontal rule before the next
  // heading; on separate screens it is a stray line. The blank-line
  // requirement keeps a setext heading's underline ("Title\n---") intact.
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
  /** answers[i] belongs to parts[i]; the `### N.` heading is dropped because
   * the card already shows the question. */
  answers: string[];
  /** Un-numbered `###` sections, headings kept. */
  extra: string;
}

/**
 * Splits an answer key written as "### 1. ...\n### 2. ..." into one answer
 * per question. Returns null when no numbered heading is found, so the
 * caller can show the key whole.
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
