import * as monaco from 'monaco-editor/editor/editor.api.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';

/**
 * The editor core only — `editor.api`, not the `monaco-editor` entry point.
 *
 * The default entry registers every language Monaco ships with, and the
 * language services run in their own workers. Building against it emitted a
 * 6.9 MB TypeScript worker, a 1 MB CSS worker and a 740 kB HTML worker, for a
 * document that is two people typing prose at each other.
 *
 * What is given up is syntax highlighting, which the scaffold has no use for.
 * What is kept is the editing model, selections, and the decorations `y-monaco`
 * draws remote cursors with — the part the editor is actually here for.
 */
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

export { monaco };
