/**
 * Roadmap geometry: pure arithmetic, testable without React. A mistake in
 * `fitView` does not throw; it silently draws the tree at an invisible
 * scale, so this is tested directly.
 */

/** Grid to pixels. `gridX`/`gridY` name the centre of a box. */
export const CELL_X = 122;
export const CELL_Y = 112;
/* Wide enough that the longest topic title keeps clear air inside the box;
   at two grid columns between siblings this still leaves a gap between
   neighbours. */
export const BOX_W = 216;
export const BOX_H = 54;

export const MIN_SCALE = 0.4;
const MAX_SCALE = 2;

/** Space left around the tree when fitting it to the canvas. */
const PADDING = 64;

/** Below this the canvas has not been laid out yet; measurements of it are
 * meaningless. */
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

/** The box's left edge, in canvas pixels. */
export function boxLeft(node: Placed): number {
  return node.gridX * CELL_X - BOX_W / 2;
}

/** The box's top edge, in canvas pixels. */
export function boxTop(node: Placed): number {
  return node.gridY * CELL_Y - BOX_H / 2;
}

/** Holds a zoom inside the range the map stays legible at. */
function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** A circuit trace from the bottom of one box to the top of the next:
 * straight drops with one horizontal jog at the midpoint, corners rounded.
 * Right angles, because the map is a board of connected parts, not a vine. */
export function edgePath(from: Placed, to: Placed): string {
  const x1 = from.gridX * CELL_X;
  const y1 = from.gridY * CELL_Y + BOX_H / 2;
  const x2 = to.gridX * CELL_X;
  const y2 = to.gridY * CELL_Y - BOX_H / 2;

  // Directly below: no jog, so no corners to round.
  if (x1 === x2) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  const midY = (y1 + y2) / 2;
  const dir = Math.sign(x2 - x1);
  // Corner radius shrinks on a short jog, so the curves cannot overlap.
  const r = Math.min(10, Math.abs(x2 - x1) / 2, (y2 - y1) / 2);

  return (
    `M ${x1} ${y1} L ${x1} ${midY - r} Q ${x1} ${midY}, ${x1 + dir * r} ${midY} ` +
    `L ${x2 - dir * r} ${midY} Q ${x2} ${midY}, ${x2} ${midY + r} L ${x2} ${y2}`
  );
}

/**
 * The pan and zoom that shows the whole tree centred in `box`, or null when
 * the canvas is too small to have been laid out yet. Fitting to a zero-size
 * canvas computes a negative scale that renders nothing; refusing to answer
 * is better.
 */
export function fitView(box: Box, nodes: Placed[]): View | null {
  if (nodes.length === 0) {
    return null;
  }

  if (box.width < MIN_USABLE_PX || box.height < MIN_USABLE_PX) {
    return null;
  }

  const xs = nodes.map((node) => node.gridX * CELL_X);
  const ys = nodes.map((node) => node.gridY * CELL_Y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const treeWidth = maxX - minX + BOX_W;
  const treeHeight = maxY - minY + BOX_H;

  // Capped at 1: a small tree sits at its natural size rather than being
  // magnified to fill the canvas.
  const scale = clampScale(
    Math.min(1, (box.width - PADDING) / treeWidth, (box.height - PADDING) / treeHeight),
  );

  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;

  return {
    scale,
    x: box.width / 2 - centreX * scale,
    y: box.height / 2 - centreY * scale,
  };
}

/** Zoom towards a point, keeping whatever is under it in place. */
export function zoomAt(view: View, factor: number, px: number, py: number): View {
  const scale = clampScale(view.scale * factor);
  const ratio = scale / view.scale;

  return {
    scale,
    x: px - (px - view.x) * ratio,
    y: py - (py - view.y) * ratio,
  };
}
