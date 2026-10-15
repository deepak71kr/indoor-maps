/**
 * The map canvas: SVG in world units (meters). Shows the current floor's plan and paths
 * (other floors faintly), handles zoom / pan / pinch, and turns clicks into tool actions.
 * All map changes go through the pure functions in model/drawing.ts.
 */
import type { Level, MapFile, MapNode } from '@innermap/schema';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { LoadedImage } from '../infra/images';
import { loadImage } from '../infra/images';
import { moveNodes, setScale } from '../model/commands';
import type { Hit, Point } from '../model/drawing';
import {
  addDoorToRoom,
  addPathPoint,
  createRoom,
  hitTest,
  placeConnector,
  placeDoor,
  roomOfDoor,
  splitEdge,
} from '../model/drawing';
import { DEFAULT_PX_PER_METER, pxPerMeter } from '../model/project';
import type { EditorState, EditorStore } from '../model/store';
import { useEditor } from './use-editor';

interface View {
  /** World point at the centre of the canvas (meters). */
  cx: number;
  cy: number;
  /** Screen pixels per meter. */
  scale: number;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 400;
/** How close (screen pixels) the pointer must be to a dot or line to hit it. */
const HIT_PX = 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

type Gesture =
  | { kind: 'pan'; start: Point; view: View; moved: boolean }
  | { kind: 'move-nodes'; start: Point; ids: string[]; moved: boolean }
  | { kind: 'box'; start: Point; moved: boolean }
  | { kind: 'pinch'; distance: number; view: View; mid: Point };

export function Canvas() {
  const { store, state } = useEditor();
  const { doc, levelId, tool, selection, pathFrom, pickDoorFor } = state;
  const level = doc.levels.find((l) => l.id === levelId);

  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ cx: 30, cy: 20, scale: 12 });
  const [images, setImages] = useState<Record<string, LoadedImage | null>>({});
  const [measure, setMeasure] = useState<{ a: Point; b?: Point; cursor?: Point } | null>(null);
  const [meters, setMeters] = useState('');
  const [cursor, setCursor] = useState<Point | null>(null);
  const [offset, setOffset] = useState<Point | null>(null); // live drag of selected dots
  const [box, setBox] = useState<{ a: Point; b: Point } | null>(null);

  // Track canvas size.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  // Load floor-plan images referenced by any floor.
  const refs = doc.levels.map((l) => l.image).filter((r): r is string => !!r);
  useEffect(() => {
    for (const ref of refs) {
      if (ref in images) continue;
      void loadImage(ref).then((img) => setImages((all) => ({ ...all, [ref]: img })));
    }
  }, [refs.join('|')]);

  // Fit the floor when switching floors, when its image arrives, or when its scale changes.
  const image = level?.image ? images[level.image] : undefined;
  useEffect(() => {
    setView(fit(doc, level, image ?? null, size));
    setMeasure(null);
  }, [levelId, image, level?.pxPerMeter, size.w > 0 && size.h > 0]);

  useEffect(() => {
    if (tool !== 'scale') setMeasure(null);
  }, [tool]);

  // ---------- coordinates & hits ----------
  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    const sx = clientX - (rect?.left ?? 0);
    const sy = clientY - (rect?.top ?? 0);
    return {
      x: (sx - size.w / 2) / view.scale + view.cx,
      y: (sy - size.h / 2) / view.scale + view.cy,
    };
  };
  const hitAt = (p: Point): Hit => hitTest(doc, levelId, p, HIT_PX / view.scale);
  const selectedIds = new Set(selection?.type === 'nodes' ? selection.ids : []);

  // ---------- zoom ----------
  const zoomAt = (clientX: number, clientY: number, factor: number, from: View = view) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const sx = clientX - (rect?.left ?? 0) - size.w / 2;
    const sy = clientY - (rect?.top ?? 0) - size.h / 2;
    const scale = clamp(from.scale * factor, MIN_SCALE, MAX_SCALE);
    // Keep the world point under the cursor fixed.
    const wx = sx / from.scale + from.cx;
    const wy = sy / from.scale + from.cy;
    setView({ scale, cx: wx - sx / scale, cy: wy - sy / scale });
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
  };

  // ---------- pointer gestures ----------
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);

  const onPointerDown = (e: PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [p, q] = [...pointers.current.values()] as [Point, Point];
      gesture.current = {
        kind: 'pinch',
        distance: Math.hypot(p.x - q.x, p.y - q.y),
        view,
        mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 },
      };
      return;
    }
    const screen = { x: e.clientX, y: e.clientY };
    if (tool === 'select' && e.button === 0) {
      const p = toWorld(e.clientX, e.clientY);
      const hit = hitAt(p);
      if (hit.type === 'node') {
        let ids = selectedIds.has(hit.id) ? [...selectedIds] : [hit.id];
        if (e.shiftKey) {
          ids = selectedIds.has(hit.id)
            ? [...selectedIds].filter((id) => id !== hit.id)
            : [...selectedIds, hit.id];
        }
        store.select(ids.length > 0 ? { type: 'nodes', ids } : null);
        gesture.current = { kind: 'move-nodes', start: p, ids, moved: false };
        return;
      }
      if (hit.type === 'edge') {
        store.select({ type: 'edge', a: hit.a, b: hit.b });
        gesture.current = null;
        return;
      }
      if (e.shiftKey) {
        gesture.current = { kind: 'box', start: p, moved: false };
        return;
      }
    }
    gesture.current = { kind: 'pan', start: screen, view, moved: false };
  };

  const onPointerMove = (e: PointerEvent) => {
    if (pointers.current.has(e.pointerId))
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = toWorld(e.clientX, e.clientY);
    setCursor(p);
    const g = gesture.current;
    if (g?.kind === 'pinch' && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      zoomAt(g.mid.x, g.mid.y, Math.hypot(a.x - b.x, a.y - b.y) / g.distance, g.view);
      return;
    }
    if (tool === 'scale' && measure && !measure.b) setMeasure({ ...measure, cursor: p });
    if (g?.kind === 'pan') {
      const dx = e.clientX - g.start.x;
      const dy = e.clientY - g.start.y;
      if (Math.hypot(dx, dy) > 4) g.moved = true;
      if (g.moved)
        setView({
          ...g.view,
          cx: g.view.cx - dx / g.view.scale,
          cy: g.view.cy - dy / g.view.scale,
        });
    } else if (g?.kind === 'move-nodes') {
      const d = { x: p.x - g.start.x, y: p.y - g.start.y };
      if (Math.hypot(d.x, d.y) * view.scale > 3) g.moved = true;
      if (g.moved) setOffset(d);
    } else if (g?.kind === 'box') {
      g.moved = true;
      setBox({ a: g.start, b: p });
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    gesture.current = null;
    const p = toWorld(e.clientX, e.clientY);
    if (g?.kind === 'move-nodes' && g.moved && offset) {
      const byId = new Map(doc.nodes.map((n) => [n.id, n]));
      const moves = g.ids.flatMap((id) => {
        const n = byId.get(id);
        if (!n) return [];
        const to = { x: round2(n.x + offset.x), y: round2(n.y + offset.y) };
        return [{ id, from: { x: n.x, y: n.y }, to }];
      });
      store.run(moveNodes(moves));
      setOffset(null);
      return;
    }
    setOffset(null);
    if (g?.kind === 'box') {
      setBox(null);
      const [x1, x2] = [Math.min(g.start.x, p.x), Math.max(g.start.x, p.x)];
      const [y1, y2] = [Math.min(g.start.y, p.y), Math.max(g.start.y, p.y)];
      const ids = doc.nodes
        .filter((n) => n.lvl === levelId && n.x >= x1 && n.x <= x2 && n.y >= y1 && n.y <= y2)
        .map((n) => n.id);
      store.select(ids.length > 0 ? { type: 'nodes', ids } : null);
      return;
    }
    if (g?.kind === 'pan' && !g.moved && e.button === 0) onClick(p);
  };

  // ---------- tools ----------
  const onClick = (p: Point) => {
    const hit = hitAt(p);
    switch (tool) {
      case 'select':
        store.select(null);
        return;
      case 'scale':
        if (!measure || measure.b) setMeasure({ a: p });
        else setMeasure({ a: measure.a, b: p });
        return;
      case 'path': {
        const result = addPathPoint(doc, levelId, pathFrom, p, hit);
        store.edit('Draw path', () => result.doc);
        store.setPathFrom(result.id);
        return;
      }
      case 'door': {
        const result = placeDoor(doc, levelId, p);
        store.edit('Add door', () => result.doc);
        store.select({ type: 'nodes', ids: [result.id] });
        return;
      }
      case 'room':
        roomClick(store, doc, hit, pickDoorFor);
        return;
      case 'lift':
      case 'stairs': {
        const levels = doc.levels.map((l) => l.id);
        const result = placeConnector(doc, tool, p, levels);
        store.edit(tool === 'lift' ? 'Add lift' : 'Add stairs', () => result.doc);
        store.select({ type: 'connector', id: result.id });
        return;
      }
    }
  };

  const onDoubleClick = (e: MouseEvent) => {
    if (tool === 'path') {
      store.setPathFrom(null);
      return;
    }
    if (tool !== 'select') return;
    const hit = hitAt(toWorld(e.clientX, e.clientY));
    if (hit.type === 'edge') {
      const result = splitEdge(doc, hit.a, hit.b, hit.point);
      store.edit('Add dot', () => result.doc);
      store.select({ type: 'nodes', ids: [result.id] });
    }
  };

  // ---------- scale tool ----------
  const measuredMeters = measure?.b
    ? Math.hypot(measure.b.x - measure.a.x, measure.b.y - measure.a.y)
    : 0;
  const applyScale = (e: Event) => {
    e.preventDefault();
    const real = Number(meters.replace(',', '.'));
    if (!level || !measure?.b || !(real > 0) || measuredMeters <= 0) return;
    const imagePixels = measuredMeters * pxPerMeter(level);
    store.run(setScale(doc, level.id, imagePixels / real, DEFAULT_PX_PER_METER));
    setMeasure(null);
    setMeters('');
    store.setTool('select');
  };

  // ---------- drawing ----------
  const nodes = useMemo(() => new Map(doc.nodes.map((n) => [n.id, n])), [doc.nodes]);
  const at = (n: MapNode): Point =>
    offset && selectedIds.has(n.id) ? { x: n.x + offset.x, y: n.y + offset.y } : n;
  const r = 5 / view.scale; // dot radius: 5 screen px at any zoom
  const transform = `translate(${size.w / 2 - view.cx * view.scale} ${size.h / 2 - view.cy * view.scale}) scale(${view.scale})`;
  const hover: Hit = cursor && tool !== 'scale' ? hitAt(cursor) : { type: 'none' };
  const isSelectedEdge = (a: string, b: string) =>
    selection?.type === 'edge' &&
    ((selection.a === a && selection.b === b) || (selection.a === b && selection.b === a));

  const edgesOf = (lvl: string, interactive: boolean) =>
    doc.edges.flatMap((edge, i) => {
      const a = nodes.get(edge.a);
      const b = nodes.get(edge.b);
      if (!a || !b || a.lvl !== lvl) return [];
      const [pa, pb] = [at(a), at(b)];
      const cls = [
        interactive && isSelectedEdge(edge.a, edge.b) ? 'selected' : '',
        edge.kind === 'ramp' ? 'ramp' : '',
        edge.oneWay ? 'one-way' : '',
      ].join(' ');
      return [<line key={i} class={cls} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} />];
    });

  const levelNodes = doc.nodes.filter((n) => n.lvl === levelId);
  const labels =
    view.scale >= 9
      ? placeLabels(
          // Selected dots first, so their labels win when labels would overlap.
          [...levelNodes]
            .sort((a, b) => Number(selectedIds.has(b.id)) - Number(selectedIds.has(a.id)))
            .map((n) => ({ n, p: at(n) })),
          view.scale,
        )
      : [];
  const pathStart = pathFrom ? nodes.get(pathFrom) : undefined;
  const snapPoint: Point | null =
    hover.type === 'node'
      ? (nodes.get(hover.id) ?? null)
      : hover.type === 'edge'
        ? hover.point
        : cursor;

  return (
    <div class={`canvas lvl-${level?.color ?? 'slate'} tool-${tool}`}>
      <svg
        ref={svgRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onDblClick={onDoubleClick}
        role="img"
        aria-label={`Map of ${level?.name ?? 'floor'}`}
      >
        <g transform={transform}>
          {image && level && (
            <image
              class="plan"
              href={image.url}
              x={0}
              y={0}
              width={image.width / pxPerMeter(level)}
              height={image.height / pxPerMeter(level)}
            />
          )}
          <g class="other-floors">
            {doc.levels
              .filter((l) => l.id !== levelId)
              .map((l) => (
                <g key={l.id}>{edgesOf(l.id, false)}</g>
              ))}
          </g>
          <g class="edges">{edgesOf(levelId, true)}</g>
          {tool === 'path' && pathStart && snapPoint && (
            <line
              class="preview"
              x1={pathStart.x}
              y1={pathStart.y}
              x2={snapPoint.x}
              y2={snapPoint.y}
            />
          )}
          <g class="nodes">
            {levelNodes.map((n) => {
              const p = at(n);
              const cls = [
                'node',
                `kind-${n.kind}`,
                selectedIds.has(n.id) ? 'selected' : '',
                n.id === pathFrom ? 'path-from' : '',
                n.kind === 'door' && roomOfDoor(doc, n.id) ? 'in-room' : '',
              ].join(' ');
              return (
                <g key={n.id} class={cls}>
                  <circle cx={p.x} cy={p.y} r={n.landmark ? r * 1.3 : r} />
                </g>
              );
            })}
          </g>
          <g class="labels">
            {labels.map(({ id, x, y, text }) => (
              <text key={id} x={x} y={y} font-size={11 / view.scale} stroke-width={3 / view.scale}>
                {text}
              </text>
            ))}
          </g>
          {hover.type !== 'none' && tool !== 'select' && snapPoint && (
            <circle class="snap" cx={snapPoint.x} cy={snapPoint.y} r={r * 2.2} />
          )}
          {box && (
            <rect
              class="box"
              x={Math.min(box.a.x, box.b.x)}
              y={Math.min(box.a.y, box.b.y)}
              width={Math.abs(box.b.x - box.a.x)}
              height={Math.abs(box.b.y - box.a.y)}
            />
          )}
          {measure && (
            <g class="measure">
              <line
                x1={measure.a.x}
                y1={measure.a.y}
                x2={(measure.b ?? measure.cursor ?? measure.a).x}
                y2={(measure.b ?? measure.cursor ?? measure.a).y}
              />
              <circle cx={measure.a.x} cy={measure.a.y} r={r} />
              {measure.b && <circle cx={measure.b.x} cy={measure.b.y} r={r} />}
            </g>
          )}
        </g>
      </svg>

      <div class="canvas-tools">
        <button
          type="button"
          onClick={() => setView(fit(doc, level, image ?? null, size))}
          title="Fit floor to screen"
        >
          ⤢ Fit
        </button>
        <button
          type="button"
          onClick={() =>
            setView({ ...view, scale: clamp(view.scale * 1.25, MIN_SCALE, MAX_SCALE) })
          }
        >
          +
        </button>
        <button
          type="button"
          onClick={() =>
            setView({ ...view, scale: clamp(view.scale / 1.25, MIN_SCALE, MAX_SCALE) })
          }
        >
          −
        </button>
        <span class="muted">{view.scale.toFixed(1)} px/m</span>
      </div>

      {tool === 'scale' ? (
        <div class="tool-hint">
          {!measure?.b ? (
            <p>
              📏 Click both ends of something whose real length you know — a door (≈ 0.9 m), a
              corridor, or a dimension printed on the plan.
            </p>
          ) : (
            <form onSubmit={applyScale}>
              <label>
                This line is{' '}
                <input
                  autoFocus
                  inputMode="decimal"
                  value={meters}
                  onInput={(e) => setMeters((e.target as HTMLInputElement).value)}
                  placeholder="0.9"
                  aria-label="Real length in meters"
                />{' '}
                m long
              </label>
              <button type="submit" class="primary">
                Apply scale
              </button>
              <button type="button" onClick={() => setMeasure(null)}>
                Redo
              </button>
            </form>
          )}
        </div>
      ) : (
        <ToolHint state={state} />
      )}
    </div>
  );
}

function roomClick(store: EditorStore, doc: MapFile, hit: Hit, pickDoorFor: string | null): void {
  const door = hit.type === 'node' ? doc.nodes.find((n) => n.id === hit.id) : undefined;
  if (!door || door.kind !== 'door') return;
  if (pickDoorFor) {
    store.edit('Add door to room', (d) => addDoorToRoom(d, pickDoorFor, door.id));
    store.setPickDoorFor(null);
    store.select({ type: 'room', id: pickDoorFor });
    return;
  }
  const existing = roomOfDoor(doc, door.id);
  if (existing) {
    store.select({ type: 'room', id: existing.id });
    return;
  }
  const result = createRoom(doc, door.id);
  store.edit('Add room', () => result.doc);
  store.select({ type: 'room', id: result.id });
}

function ToolHint({ state }: { state: EditorState }) {
  const room = state.pickDoorFor
    ? state.doc.rooms.find((r) => r.id === state.pickDoorFor)
    : undefined;
  const text: Partial<Record<EditorState['tool'], string>> = {
    select:
      'Click a dot or line to edit it · drag dots to move · Shift+drag to select several · double-click a line to add a dot',
    path: state.pathFrom
      ? 'Keep clicking along the corridor · click a dot to join · double-click or Esc to finish'
      : '✏️ Click along a corridor · clicking a line makes a T-junction',
    door: '🚪 Click where a door is — it connects to the nearest corridor',
    room: room ? `🏷️ Click another door of “${room.name}”` : '🏷️ Click a door to make it a room',
    lift: '🛗 Click where the lift is — it is added to every floor (choose floors in the panel)',
    stairs: '🪜 Click where the stairs are — added to every floor (choose floors in the panel)',
  };
  const hint = text[state.tool];
  return hint ? (
    <div class="tool-hint">
      <p>{hint}</p>
    </div>
  ) : null;
}

/** Greedy label placement: skip labels that would overlap one already placed. */
function placeLabels(
  items: ReadonlyArray<{ n: MapNode; p: Point }>,
  scale: number,
): Array<{ id: string; x: number; y: number; text: string }> {
  const placed: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const out: Array<{ id: string; x: number; y: number; text: string }> = [];
  const r = 5 / scale;
  for (const { n, p } of items) {
    if (!n.landmark) continue;
    const x = p.x + r * 1.8;
    const y = p.y - r * 1.4; // above the dot, so lines don't show through gaps between words
    const rect = { x1: x, y1: y - 12 / scale, x2: x + (n.landmark.length * 6.2) / scale, y2: y };
    const overlaps = placed.some(
      (o) => rect.x1 < o.x2 && rect.x2 > o.x1 && rect.y1 < o.y2 && rect.y2 > o.y1,
    );
    if (overlaps) continue;
    placed.push(rect);
    out.push({ id: n.id, x, y, text: n.landmark });
  }
  return out;
}

/** A view showing the whole floor: its image and/or its dots. */
function fit(
  doc: MapFile,
  level: Level | undefined,
  image: LoadedImage | null,
  size: { w: number; h: number },
): View {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  if (image && level) {
    include(0, 0);
    include(image.width / pxPerMeter(level), image.height / pxPerMeter(level));
  }
  // Floors share coordinates: without its own plan, a floor is framed like the whole building
  // (otherwise a new floor holding just a lift stop would zoom in on that single dot).
  for (const n of doc.nodes) if (image ? n.lvl === level?.id : true) include(n.x, n.y);
  if (!Number.isFinite(minX)) {
    include(0, 0);
    include(60, 40);
  }
  const width = Math.max(maxX - minX, 5);
  const height = Math.max(maxY - minY, 5);
  const scale = clamp(Math.min(size.w / width, size.h / height) * 0.85, MIN_SCALE, MAX_SCALE);
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale };
}
