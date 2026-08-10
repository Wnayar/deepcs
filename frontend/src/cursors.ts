import type { Awareness } from 'y-protocols/awareness';

/**
 * Colours the remote cursors, which y-monaco does not do for you.
 *
 * It emits `.yRemoteSelection-<clientID>` and `.yRemoteSelectionHead-<clientID>`
 * class names and stops there — no colours, no labels. Without this every peer
 * renders identically, and the caret inherits `currentColor`, so two people
 * editing look like one person with a haunted cursor. The colour each peer
 * publishes in their awareness state has, until now, been read by nobody.
 *
 * Rules are generated per client id because that is the only hook y-monaco
 * gives, and they are rewritten whenever the room's membership changes.
 */
export function watchCursorStyles(awareness: Awareness): () => void {
  const style = document.createElement('style');
  document.head.append(style);

  const render = () => {
    const rules: string[] = [];

    for (const [clientId, state] of awareness.getStates()) {
      if (clientId === awareness.clientID) continue;
      const user = (state as { user?: { name?: string; color?: string } }).user;
      if (!user?.color) continue;

      // The selection band, translucent so the text under it stays readable.
      rules.push(`.yRemoteSelection-${clientId} { background-color: ${user.color}33; }`);
      // The caret itself.
      rules.push(
        `.yRemoteSelectionHead-${clientId} { border-left: 2px solid ${user.color}; border-top: 2px solid ${user.color}; }`,
      );
      // Their name, sitting above the caret so you can tell who is who.
      rules.push(
        `.yRemoteSelectionHead-${clientId}::after {` +
          `content: '${cssString(user.name ?? 'someone')}';` +
          `background-color: ${user.color};` +
          `color: #fff; font-size: 10px; line-height: 1;` +
          `padding: 2px 4px; border-radius: 3px;` +
          `position: absolute; top: -14px; left: -2px; white-space: nowrap;` +
          `}`,
      );
    }

    style.textContent = rules.join('\n');
  };

  render();
  awareness.on('change', render);

  return () => {
    awareness.off('change', render);
    style.remove();
  };
}

/**
 * Makes a display name safe to sit inside a CSS `content:` string.
 *
 * This is user-controlled text going into a stylesheet, so a name containing a
 * quote would end the string and let whatever follows be parsed as CSS. Quotes
 * and backslashes are dropped rather than escaped — the name is decoration, and
 * the simplest thing that cannot break out is the right one.
 */
function cssString(value: string): string {
  return value.replace(/['"\\\n\r]/g, '').slice(0, 40);
}
