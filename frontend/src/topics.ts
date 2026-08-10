/**
 * The nine topics, in the order they are worth working through rather than
 * alphabetically — the fundamentals first, the interview-shaped ones last.
 *
 * One list, imported by the two screens that offer a choice of topic. It was
 * written out separately in each of them, which is two places to edit and one
 * silent failure mode: a topic present in one dropdown and missing from the
 * other looks like a bug in matching rather than a typo in a constant.
 *
 * Still a constant and not a fetch of `/lessons`. The strings are a closed set
 * fixed by a migration, and reading them over the network would make both
 * screens fail to render a filter when Questions is down — a worse outcome
 * than a list that has to be edited alongside the seed that defines it.
 */
export const TOPICS = [
  'os',
  'networking',
  'databases',
  'oop',
  'system-design',
  'security',
  'debugging',
  'ai-tooling',
  'behavioural',
] as const;
