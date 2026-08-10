/**
 * Where the roadmap's boxes and lines go.
 *
 * Separate from the component because it is arithmetic with no React in it,
 * which means it can be tested directly. That matters here: a mistake in
 * `fitView` does not throw or warn, it silently draws the whole tree at a
 * scale that makes it invisible, and the page looks empty rather than broken.
 */

/** Grid to pixels. `gridX` and `gridY` are the *centre* of a box, in small
 * whole numbers, so the migration reads as a shape rather than as pixels. */
export const CELL_X = 122;
export const CELL_Y = 112;
export const BOX_W = 194;
export const BOX_H = 54;

export const MIN_SCALE = 0.4;
export const MAX_SCALE = 2;

/** Space left around the tree when fitting it to the canvas. */
const PADDING = 64;

/** Below this the canvas has not been laid out yet and any measurement of it
 * is meaningless. */
const MIN_USABLE_PX = 80;

export interface Placed {
  gridX: number;
  gridY: number;
}

export interface Box {
  width: number;
  height: number;
}

export interface View {
  x: number;
  y: number;
  scale: number;
}

export const boxLeft = (node: Placed) => node.gridX * CELL_X - BOX_W / 2;
export const boxTop = (node: Placed) => node.gridY * CELL_Y - BOX_H / 2;

export const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/**
 * A curve from the bottom of one box to the top of the next.
 *
 * Deliberately loose. These lines say "this is the order I would read them in",
 * not "this one is required by that one", so they only have to lead the eye
 * downward. The control points sit straight below the start and straight above
 * the end, which is what keeps a line reading as downward travel even when the
 * two topics are far apart sideways.
 */
export function edgePath(from: Placed, to: Placed): string {
  const x1 = from.gridX * CELL_X;
  const y1 = from.gridY * CELL_Y + BOX_H / 2;
  const x2 = to.gridX * CELL_X;
  const y2 = to.gridY * CELL_Y - BOX_H / 2;
  const bend = (y2 - y1) / 2;
  return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
}

/**
 * The pan and zoom that shows the whole tree centred in `box`, or `null` when
 * the canvas is too small to have been laid out yet.
 *
 * The `null` is the whole point of this function existing. An unlaid-out canvas
 * measures zero, and fitting to it works out `(0 - padding) / treeHeight`,
 * which is negative: the tree is then drawn mirrored and shrunk to a speck, and
 * the page reads as empty. Refusing to answer is better than answering with a
 * number that renders nothing.
 */
export function fitView(box: Box, nodes: Placed[]): View | null {
  if (nodes.length === 0) return null;
  if (box.width < MIN_USABLE_PX || box.height < MIN_USABLE_PX) return null;

  const xs = nodes.map((n) => n.gridX * CELL_X);
  const ys = nodes.map((n) => n.gridY * CELL_Y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const scale = clampScale(
    Math.min(
      1,
      (box.width - PADDING) / (maxX - minX + BOX_W),
      (box.height - PADDING) / (maxY - minY + BOX_H),
    ),
  );

  return {
    scale,
    x: box.width / 2 - ((minX + maxX) / 2) * scale,
    y: box.height / 2 - ((minY + maxY) / 2) * scale,
  };
}

/** Scaling towards the origin makes the map slide away as it grows, which
 * feels like the zoom is fighting you. Scaling towards a point keeps whatever
 * is under that point where it is. */
export function zoomAt(view: View, factor: number, px: number, py: number): View {
  const scale = clampScale(view.scale * factor);
  const ratio = scale / view.scale;
  return { scale, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
}
