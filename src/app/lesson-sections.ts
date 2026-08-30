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

interface Chunk {
  title: string | null;
  lines: string[];
}

/**
 * Joins a chunk's lines back into markdown.
 *
 * Lessons may end a section with a horizontal rule before the next heading;
 * on separate screens it is a stray line. The blank-line requirement keeps a
 * setext heading's underline ("Title\n---") intact.
 */
function chunkText(chunk: Chunk): string {
  return chunk.lines
    .join('\n')
    .replace(/\n\s*\n-{3,}\s*$/, '')
    .trim();
}

/**
 * Splits a lesson on its top-level `##` headings, one section per screen.
 * "intro\n## A\na body" becomes
 * { preamble: "intro", sections: [{ title: "A", body: "a body" }] }.
 */
export function splitLesson(md: string): SplitLesson {
  const head: Chunk = { title: null, lines: [] };
  const chunks: Chunk[] = [head];
  let current = head;
  let inFence = false;

  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
    }

    if (!inFence && line.startsWith('## ')) {
      current = { title: line.slice(3).trim(), lines: [] };
      chunks.push(current);
    } else {
      current.lines.push(line);
    }
  }

  const sections: LessonSection[] = [];

  for (const chunk of chunks.slice(1)) {
    sections.push({ title: chunk.title ?? '', body: chunkText(chunk) });
  }

  return { preamble: chunkText(head), sections };
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
  // Sparse: a key that skips a number leaves a hole, read back as empty.
  const answers: (string[] | undefined)[] = [];
  const extra: string[] = [];
  let target = extra;
  let inFence = false;
  let found = false;

  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
    }

    if (!inFence) {
      const numbered = /^### (\d+)\./.exec(line);

      if (numbered !== null) {
        found = true;
        target = [];
        answers[Number(numbered[1]) - 1] = target;
        continue;
      }

      if (line.startsWith('### ')) {
        target = extra;
      }
    }

    target.push(line);
  }

  if (!found) {
    return null;
  }

  const joined: string[] = [];

  for (const lines of answers) {
    const body = lines ?? [];
    joined.push(body.join('\n').trim());
  }

  return { answers: joined, extra: extra.join('\n').trim() };
}
