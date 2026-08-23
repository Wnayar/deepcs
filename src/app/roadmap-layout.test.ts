import { describe, expect, it } from 'vitest';
import { BOX_H, MIN_SCALE, edgePath, fitView, zoomAt } from './roadmap-layout';

/** A tree the shape of the seeded roadmap: six rows, branching and rejoining.
 * Positions are representative rather than copied, because what is under test is
 * the geometry, not which topic sits where. */
const TREE = [
  { gridX: 3, gridY: 0 },
  { gridX: 1, gridY: 1 },
  { gridX: 5, gridY: 1 },
  { gridX: 1, gridY: 2 },
  { gridX: 5, gridY: 2 },
  { gridX: 3, gridY: 3 },
  { gridX: 3, gridY: 4 },
  { gridX: 1, gridY: 5 },
  { gridX: 5, gridY: 5 },
];

describe('fitView', () => {
  it('refuses a canvas that has not been laid out', () => {
    // The bug this exists for. A zero-height canvas made the fit work out a
    // negative scale, so the tree was drawn mirrored and microscopic and the
    // roadmap looked completely empty. Nothing threw and nothing warned.
    expect(fitView({ width: 1200, height: 0 }, TREE)).toBeNull();
    expect(fitView({ width: 0, height: 0 }, TREE)).toBeNull();
    expect(fitView({ width: 1200, height: 40 }, TREE)).toBeNull();
  });

  it('never returns a scale that would hide the tree', () => {
    // Every plausible window, including ones too small to fit the tree at all.
    for (const height of [100, 240, 600, 900, 2000]) {
      for (const width of [320, 768, 1440, 3840]) {
        const view = fitView({ width, height }, TREE);
        if (view === null) continue;
        expect(view.scale).toBeGreaterThanOrEqual(MIN_SCALE);
        expect(Number.isFinite(view.x) && Number.isFinite(view.y)).toBe(true);
      }
    }
  });

  it('centres the tree in the canvas', () => {
    const box = { width: 1200, height: 900 };
    const view = fitView(box, TREE)!;

    // The middle column sits at gridX 3, so once placed it should land on the
    // horizontal centre line of the canvas.
    const centreColumn = 3 * 122 * view.scale + view.x;
    expect(centreColumn).toBeCloseTo(box.width / 2, 6);
  });

  it('is a single node at full scale when there is only one', () => {
    expect(fitView({ width: 1200, height: 900 }, [{ gridX: 0, gridY: 0 }])?.scale).toBe(1);
  });
});

describe('edgePath', () => {
  it('always travels downward', () => {
    const path = edgePath({ gridX: 3, gridY: 0 }, { gridX: 1, gridY: 1 });
    const startY = Number(/^M \S+ (\S+)/.exec(path)![1]);
    const endY = Number(path.slice(path.lastIndexOf(' ') + 1));

    expect(startY).toBe(BOX_H / 2);
    expect(endY).toBeGreaterThan(startY);
  });
});

describe('zoomAt', () => {
  it('keeps the point under the cursor where it is', () => {
    const before = { x: 100, y: 50, scale: 1 };
    const cursor = { x: 640, y: 400 };

    // Where the document point under the cursor is, before and after.
    const documentX = (cursor.x - before.x) / before.scale;
    const after = zoomAt(before, 1.5, cursor.x, cursor.y);

    expect(documentX * after.scale + after.x).toBeCloseTo(cursor.x, 6);
  });

  it('will not zoom past its limits however hard it is pushed', () => {
    let view = { x: 0, y: 0, scale: 1 };
    for (let i = 0; i < 50; i += 1) view = zoomAt(view, 1.5, 0, 0);
    expect(view.scale).toBeLessThanOrEqual(2);

    for (let i = 0; i < 50; i += 1) view = zoomAt(view, 1 / 1.5, 0, 0);
    expect(view.scale).toBeGreaterThanOrEqual(MIN_SCALE);
  });
});
