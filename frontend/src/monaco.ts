import * as monaco from 'monaco-editor/editor/editor.api.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';

/**
 * The editor core only — `editor.api`, not the `monaco-editor` entry point.
 *
 * The default entry registers every language Monaco ships with, and the
 * language services run in their own workers. Building against it emitted a
 * 6.9 MB TypeScript worker, a 1 MB CSS worker and a 740 kB HTML worker, for a
 * document that is markdown prose two people are writing together. None of
 * that serves anything here: it is static bytes either way.
 *
 * What is given up: syntax highlighting for the `##` headings in the scaffold.
 * What is kept: the editing model, selections, and the decorations `y-monaco`
 * draws remote cursors with — which is the part the editor actually needs.
 */
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

export { monaco };
