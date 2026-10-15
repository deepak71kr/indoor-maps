/**
 * The map canvas: SVG in world units (meters). Shows the current floor's plan image and
 * paths, other floors faintly, and handles zoom / pan / pinch and the scale tool.
 */
import type { Level, MapFile } from '@innermap/schema';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { LoadedImage } from '../infra/images';
import { loadImage } from '../infra/images';
import { setScale } from '../model/commands';
import { DEFAULT_PX_PER_METER, pxPerMeter } from '../model/project';
import { useEditor } from './use-editor';

interface Point {
  x: number;
  y: number;
}
interface View {
  /** World point at the centre of the canvas (meters). */
  cx: number;
  cy: number;
  /** Screen pixels per meter. */
  scale: number;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 400;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function Canvas() {
  const { store, state } = useEditor();
  const { doc, levelId, tool } = state;
  const level = doc.levels.find((l) => l.id === levelId);

  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ cx: 30, cy: 20, scale: 12 });
  const [images, setImages] = useState<Record<string, LoadedImage | null>>({});
  const [measure, setMeasure] = useState<{ a: Point; b?: Point; cursor?: Point } | null>(null);
  const [meters, setMeters] = useState('');

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

  // Fit the floor when switching floors or when its image arrives.
  const image = level?.image ? images[level.image] : undefined;
  useEffect(() => {
    setView(fit(doc, level, image ?? null, size));
    setMeasure(null);
    // Re-fit when the floor's scale changes: its image changes size in meters.
  }, [levelId, image, level?.pxPerMeter, size.w > 0 && size.h > 0]);

  useEffect(() => {
    if (tool !== 'scale') setMeasure(null);
  }, [tool]);

  // ---------- coordinates ----------
  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    const sx = clientX - (rect?.left ?? 0);
    const sy = clientY - (rect?.top ?? 0);
    return {
      x: (sx - size.w / 2) / view.scale + view.cx,
      y: (sy - size.h / 2) / view.scale + view.cy,
    };
  };

  // ---------- zoom / pan / pinch ----------
  const pointers = useRef(new Map<number, Point>());
  const drag = useRef<{ start: Point; view: View; moved: boolean } | null>(null);
  const pinch = useRef<{ distance: number; view: View; mid: Point } | null>(null);

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

  const onPointerDown = (e: PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [p, q] = [...pointers.current.values()] as [Point, Point];
      pinch.current = {
        distance: Math.hypot(p.x - q.x, p.y - q.y),
        view,
        mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 },
      };
      drag.current = null;
      return;
    }
    drag.current = { start: { x: e.clientX, y: e.clientY }, view, moved: false };
  };

  const onPointerMove = (e: PointerEvent) => {
    if (pointers.current.has(e.pointerId))
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [p, q] = [...pointers.current.values()] as [Point, Point];
      const { distance, view: from, mid } = pinch.current;
      zoomAt(mid.x, mid.y, Math.hypot(p.x - q.x, p.y - q.y) / distance, from);
      return;
    }
    if (tool === 'scale' && measure && !measure.b)
      setMeasure({ ...measure, cursor: toWorld(e.clientX, e.clientY) });
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.start.x;
    const dy = e.clientY - d.start.y;
    if (Math.hypot(dx, dy) > 4) d.moved = true;
    if (d.moved)
      setView({ ...d.view, cx: d.view.cx - dx / d.view.scale, cy: d.view.cy - dy / d.view.scale });
  };

  const onPointerUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    // A click (not a drag).
    if (tool === 'scale') {
      const p = toWorld(e.clientX, e.clientY);
      if (!measure || measure.b) setMeasure({ a: p });
      else setMeasure({ a: measure.a, b: p });
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
  const r = 5 / view.scale; // dot radius: 5 screen px at any zoom
  const transform = `translate(${size.w / 2 - view.cx * view.scale} ${size.h / 2 - view.cy * view.scale}) scale(${view.scale})`;
  const showLabels = view.scale >= 9;

  const edgesOf = (lvl: string) =>
    doc.edges.flatMap((edge, i) => {
      const a = nodes.get(edge.a);
      const b = nodes.get(edge.b);
      return a && b && a.lvl === lvl ? [<line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />] : [];
    });

  return (
    <div class={`canvas lvl-${level?.color ?? 'slate'} tool-${tool}`}>
      <svg
        ref={svgRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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
                <g key={l.id}>{edgesOf(l.id)}</g>
              ))}
          </g>
          <g class="edges">{edgesOf(levelId)}</g>
          <g class="nodes">
            {doc.nodes
              .filter((n) => n.lvl === levelId)
              .map((n) => (
                <g key={n.id} class={`node kind-${n.kind}`}>
                  <circle cx={n.x} cy={n.y} r={n.landmark ? r * 1.3 : r} />
                  {showLabels && n.landmark && (
                    <text
                      x={n.x + r * 1.8}
                      // Above the dot, so corridor lines don't show through the gaps between words.
                      y={n.y - r * 1.4}
                      font-size={11 / view.scale}
                      stroke-width={3 / view.scale}
                    >
                      {n.landmark}
                    </text>
                  )}
                </g>
              ))}
          </g>
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

      {tool === 'scale' && (
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
      )}
    </div>
  );
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
  for (const n of doc.nodes) if (n.lvl === level?.id) include(n.x, n.y);
  if (!Number.isFinite(minX)) {
    include(0, 0);
    include(60, 40);
  }
  const width = Math.max(maxX - minX, 5);
  const height = Math.max(maxY - minY, 5);
  const scale = clamp(Math.min(size.w / width, size.h / height) * 0.85, MIN_SCALE, MAX_SCALE);
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale };
}
