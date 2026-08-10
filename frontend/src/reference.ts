/**
 * Renumbers a reference answer to read like the question it answers.
 *
 * The stored markdown heads each answer with `## <the question>`, which is how
 * the source notes are written. Everywhere else in the app a question is item
 * `1.`, `2.`, `3.` — so left alone the answer arrives in a different shape from
 * the thing it is answering, and you have to re-match them by eye.
 *
 * Sections past the last question keep their name instead of a number: most
 * entries end with "Mental models" or "Quick tips", which are not answers to
 * anything and would be actively wrong as item 7.
 */
export function numberReference(referenceMd: string, partCount: number): string {
  let seen = 0;

  return referenceMd
    .split('\n')
    .map((line) => {
      const heading = /^#{2,3}\s+(.*)$/.exec(line);
      if (!heading) return line;

      seen += 1;
      return seen <= partCount ? `${seen}. ${heading[1]}` : heading[1];
    })
    .join('\n');
}
