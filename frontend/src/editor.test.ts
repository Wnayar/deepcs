// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { yCollab } from 'y-codemirror.next';

/**
 * The shared editor is the one piece of UI with a contract that breaks
 * silently: it binds a CodeMirror view to a Yjs text, and either side can be
 * swapped for something that compiles perfectly and syncs nothing.
 *
 * These build the same pieces `Session.tsx` does, without the socket.
 */
function editor(text: Y.Text, awareness: Awareness) {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: text.toString(),
      extensions: [EditorView.lineWrapping, yCollab(text, awareness)],
    }),
  });
}

describe('the shared editor', () => {
  it('shows the seeded document, and typing reaches the Yjs text', () => {
    const doc = new Y.Doc();
    const text = doc.getText('content');
    // "content" is the field Collab seeds the scaffold into; binding to any
    // other name gives an editor that syncs with nobody.
    text.insert(0, 'seeded scaffold');

    const view = editor(text, new Awareness(doc));
    expect(view.state.doc.toString()).toBe('seeded scaffold');

    view.dispatch({ changes: { from: 0, insert: 'a ' } });
    expect(text.toString()).toBe('a seeded scaffold');

    // And the other direction: a change arriving from the network shows up.
    text.insert(text.length, ' plus theirs');
    expect(view.state.doc.toString()).toBe('a seeded scaffold plus theirs');

    view.destroy();
  });

  /**
   * Two documents, synced by hand the way Collab syncs them, so this is a real
   * two-person session rather than one document pretending.
   */
  it('draws the other person a caret, in a colour from the stylesheet', () => {
    const mine = new Y.Doc();
    const theirs = new Y.Doc();
    const myText = mine.getText('content');
    myText.insert(0, 'shared answer');
    Y.applyUpdate(theirs, Y.encodeStateAsUpdate(mine));

    const myAwareness = new Awareness(mine);
    const theirAwareness = new Awareness(theirs);
    const view = editor(myText, myAwareness);

    // What Session.tsx sets: a colour and nothing else. A name here would be
    // one a peer could forge, so the real one comes from the server.
    theirAwareness.setLocalStateField('user', {
      color: 'var(--accent)',
      colorLight: 'color-mix(in srgb, var(--accent) 25%, transparent)',
    });
    theirAwareness.setLocalStateField('cursor', {
      anchor: Y.createRelativePositionFromTypeIndex(theirs.getText('content'), 3),
      head: Y.createRelativePositionFromTypeIndex(theirs.getText('content'), 3),
    });

    // Deliver their presence to my client, which is what the socket does.
    myAwareness.setLocalState(myAwareness.getLocalState());
    const states = theirAwareness.getStates();
    for (const [client, state] of states) {
      if (client !== theirAwareness.clientID) continue;
      myAwareness.states.set(client, state);
      myAwareness.emit('change', [{ added: [client], updated: [], removed: [] }, 'test']);
    }

    const caret = document.querySelector('.cm-ySelectionCaret');
    expect(caret, 'the remote caret is drawn').not.toBeNull();
    // The colour is a custom property, so it follows a theme switch and stays
    // in `:root` rather than being a hex value in the editor code.
    expect(caret?.getAttribute('style') ?? '').toContain('var(--accent)');

    view.destroy();
  });
});
