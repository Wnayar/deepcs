// Splits content by access tier into the Worker's asset directory: free on
// public paths, paid under content/paid/ where only the Worker serves it.
// Doubles as the content validator, so a content mistake fails the build
// rather than the deploy.
//
//   node scripts/build-content.mjs            # fixtures in ./content
//   CONTENT_DIR=../deepcs-content node ...    # real content, in CI

import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const src = process.env.CONTENT_DIR ?? 'content';
const out = 'dist/client/content';

let failed = false;

/** Records one problem without stopping, so an author sees every mistake in
 * one run rather than one per build. */
function fail(msg) {
  console.error(`content: ${msg}`);
  failed = true;
}

const roadmap = JSON.parse(readFileSync(path.join(src, 'roadmap.json'), 'utf8'));
const questions = JSON.parse(readFileSync(path.join(src, 'questions.json'), 'utf8'));
const bySteps = new Map(questions.steps.map((s) => [s.id, s]));

// ---- validate -------------------------------------------------------------

const topicIds = new Set(roadmap.topics.map((t) => t.id));
const stepAccess = new Map();

/** En dash and em dash, banned from anything a reader sees (CLAUDE.md). */
const emDash = /[–—]/;

const TIERS = ['easy', 'medium', 'hard', 'skills'];

/** A lesson body, or '' after recording that the file is missing. */
function readLesson(stepId) {
  try {
    return readFileSync(path.join(src, 'lessons', `${stepId}.md`), 'utf8');
  } catch {
    fail(`step ${stepId} has no lesson file`);
    return '';
  }
}

/** Checks one topic's own fields: its tier, its access, and its edges. */
function checkTopic(topic) {
  if (topic.access !== 'free' && topic.access !== 'paid') {
    fail(`topic ${topic.id} has access "${topic.access}", not free|paid`);
  }

  if (!TIERS.includes(topic.tier)) {
    fail(`topic ${topic.id} has tier "${topic.tier}", not ${TIERS.join('|')}`);
  }

  for (const dep of topic.dependsOn) {
    if (!topicIds.has(dep)) {
      fail(`topic ${topic.id} depends on unknown ${dep}`);
    }
  }

  if (emDash.test(topic.title + topic.summary)) {
    fail(`em/en dash in topic ${topic.id}`);
  }
}

/** Checks one step's lesson and questions, and records the tier it inherits
 * from its topic. That map is what splits the output below. */
function checkStep(step, access) {
  stepAccess.set(step.id, access);

  const q = bySteps.get(step.id);

  if (!q) {
    fail(`step ${step.id} missing from questions.json`);
  }

  const lesson = readLesson(step.id);
  const readable = [step.title, lesson, q?.referenceMd ?? '', (q?.parts ?? []).join('\n')];

  if (emDash.test(readable.join('\n'))) {
    fail(`em/en dash in step ${step.id}`);
  }
}

for (const topic of roadmap.topics) {
  checkTopic(topic);

  for (const step of topic.steps) {
    checkStep(step, topic.access);
  }
}

if (![...stepAccess.values()].includes('free')) {
  fail('the free tier is empty');
}

for (const id of bySteps.keys()) {
  if (!stepAccess.has(id)) {
    fail(`questions.json has ${id}, roadmap does not`);
  }
}

for (const file of readdirSync(path.join(src, 'lessons'))) {
  if (!stepAccess.has(file.replace(/\.md$/, ''))) {
    fail(`orphan lesson file ${file}`);
  }
}

if (failed) {
  process.exit(1);
}

// ---- write, split by tier ---------------------------------------------------

mkdirSync(path.join(out, 'lessons'), { recursive: true });
mkdirSync(path.join(out, 'paid', 'lessons'), { recursive: true });

// The map is public in full (locked topics are the sales page); only the
// bodies split by tier.
writeFileSync(path.join(out, 'roadmap.json'), JSON.stringify(roadmap, null, 2) + '\n');

for (const access of ['free', 'paid']) {
  const steps = questions.steps.filter((s) => stepAccess.get(s.id) === access);

  let dir = out;

  if (access === 'paid') {
    dir = path.join(out, 'paid');
  }

  writeFileSync(path.join(dir, 'questions.json'), JSON.stringify({ steps }, null, 2) + '\n');

  for (const step of steps) {
    cpSync(path.join(src, 'lessons', `${step.id}.md`), path.join(dir, 'lessons', `${step.id}.md`));
  }
}

const paid = [...stepAccess.values()].filter((a) => a === 'paid').length;

console.log(
  `content: ${roadmap.topics.length} topics, ${stepAccess.size} steps ` +
    `(${stepAccess.size - paid} free, ${paid} paid) -> ${out}`,
);
