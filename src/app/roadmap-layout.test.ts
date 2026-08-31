import { describe, expect, test } from 'vitest';
import { BOX_H, MIN_SCALE, edgePath, fitView, zoomAt } from './roadmap-layout';

/** A tree the shape of the real roadmap: six rows, branching and rejoining.
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
  /**
   * The bug this exists for. A zero-height canvas made the fit work out a
   * negative scale, so the tree was drawn mirrored and microscopic and the
   * roadmap looked completely empty. Nothing threw and nothing warned.
   */
  test('refuses a canvas that has not been laid out', () => {
    // Arrange, canvases as measured before or during first layout
    const unlaidOut = [
      { width: 1200, height: 0 },
      { width: 0, height: 0 },
      { width: 1200, height: 40 },
    ];

    // Act and assert, each measurement in turn
    for (const box of unlaidOut) {
      expect(fitView(box, TREE), `${box.width}x${box.height}`).toBeNull();
    }
  });

  /**
   * The floor holds even when the tree cannot fit at all. Without it a narrow
   * window shrinks the roadmap to a smudge, which looks like a failed load
   * rather than a zoom the reader can undo.
   */
  test('never returns a scale that would hide the tree', () => {
    // Arrange, every plausible window including ones far too small
    const heights = [100, 240, 600, 900, 2000];
    const widths = [320, 768, 1440, 3840];

    // Act and assert, on each candidate viewport
    for (const height of heights) {
      for (const width of widths) {
        const view = fitView({ width, height }, TREE);

        if (view === null) {
          continue;
        }

        expect(view.scale).toBeGreaterThanOrEqual(MIN_SCALE);
        expect(Number.isFinite(view.x) && Number.isFinite(view.y)).toBe(true);
      }
    }
  });

  /** The opening view is never scrolled to, so anything off centre reads as a
   * layout bug on first paint. */
  test('centres the tree in the canvas', () => {
    // Arrange
    const box = { width: 1200, height: 900 };

    // Act
    const view = fitView(box, TREE)!;

    // Assert, the middle column at gridX 3 should land on the centre line
    const centreColumn = 3 * 122 * view.scale + view.x;
    expect(centreColumn).toBeCloseTo(box.width / 2, 6);
  });

  /** A single node has no extent to fit, which is the degenerate case where a
   * scale derived from tree width divides by zero. */
  test('is a single node at full scale when there is only one', () => {
    // Arrange
    const oneNode = [{ gridX: 0, gridY: 0 }];

    // Act
    const view = fitView({ width: 1200, height: 900 }, oneNode);

    // Assert
    expect(view?.scale).toBe(1);
  });
});

describe('edgePath', () => {
  /** Edges are drawn without arrowheads, so direction is carried by the curve
   * alone. One that doubled back would read as a link to the parent. */
  test('always travels downward', () => {
    // Arrange
    const parent = { gridX: 3, gridY: 0 };
    const child = { gridX: 1, gridY: 1 };

    // Act
    const path = edgePath(parent, child);

    // Assert
    const startY = Number(/^M \S+ (\S+)/.exec(path)![1]);
    const endY = Number(path.slice(path.lastIndexOf(' ') + 1));
    expect(startY).toBe(BOX_H / 2);
    expect(endY).toBeGreaterThan(startY);
  });
});

describe('zoomAt', () => {
  /**
   * What separates a zoom from a scale: the point under the cursor is the
   * fixed point, so the pan has to be corrected by the same step. Get it wrong
   * and the tree slides away from wherever the reader is pointing.
   */
  test('keeps the point under the cursor where it is', () => {
    // Arrange
    const before = { x: 100, y: 50, scale: 1 };
    const cursor = { x: 640, y: 400 };
    const documentX = (cursor.x - before.x) / before.scale;

    // Act
    const after = zoomAt(before, 1.5, cursor.x, cursor.y);

    // Assert
    expect(documentX * after.scale + after.x).toBeCloseTo(cursor.x, 6);
  });

  /** A trackpad emits zoom events far faster than a reader means to, so the
   * stop has to survive being pushed at repeatedly. */
  test('will not zoom in past its maximum', () => {
    // Arrange
    let view = { x: 0, y: 0, scale: 1 };

    // Act, far more zoom-ins than it takes to reach the stop
    for (let i = 0; i < 50; i += 1) {
      view = zoomAt(view, 1.5, 0, 0);
    }

    // Assert
    expect(view.scale).toBeLessThanOrEqual(2);
  });

  /** The same stop at the other end, where overshooting shrinks the roadmap
   * out of sight instead of merely cropping it. */
  test('will not zoom out past its minimum', () => {
    // Arrange
    let view = { x: 0, y: 0, scale: 1 };

    // Act, far more zoom-outs than it takes to reach the stop
    for (let i = 0; i < 50; i += 1) {
      view = zoomAt(view, 1 / 1.5, 0, 0);
    }

    // Assert
    expect(view.scale).toBeGreaterThanOrEqual(MIN_SCALE);
  });
});
