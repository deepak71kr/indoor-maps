/** Phase 9 panels: what the Outline tool draws, and the selected outline's properties. */
import type { MapFile, Shape } from '@innermap/schema';
import type { ShapeKind } from '../model/plan';
import { deleteShape, updateShape } from '../model/plan';
import type { EditorStore } from '../model/store';
import { useEditor } from './use-editor';

export const SHAPE_KINDS_UI: ReadonlyArray<{
  kind: ShapeKind;
  icon: string;
  label: string;
  hint: string;
}> = [
  { kind: 'room', icon: '▭', label: 'Room', hint: 'Joins the room whose door is on its wall' },
  {
    kind: 'floor',
    icon: '⬜',
    label: 'Floor area',
    hint: 'Corridors and lobbies: the white walkable area',
  },
  { kind: 'lift', icon: '🛗', label: 'Lift shaft', hint: 'The box of a lift' },
  { kind: 'stairs', icon: '🪜', label: 'Stairwell', hint: 'The box of a staircase' },
  {
    kind: 'void',
    icon: '▦',
    label: 'Courtyard / void',
    hint: 'Not walkable: courtyard, atrium, shaft',
  },
  {
    kind: 'wall',
    icon: '╱',
    label: 'Wall line',
    hint: 'An extra wall that is not part of an outline',
  },
  {
    kind: 'building',
    icon: '🏢',
    label: 'Building',
    hint: 'Campus: a building footprint on the Ground floor; joins the first building not drawn yet',
  },
  { kind: 'road', icon: '🛣️', label: 'Road', hint: 'Campus: a road' },
  { kind: 'path', icon: '🚶', label: 'Footpath', hint: 'Campus: a footpath or walkway' },
  { kind: 'green', icon: '🌳', label: 'Lawn / garden', hint: 'Campus: lawns, gardens, grounds' },
  { kind: 'parking', icon: '🅿️', label: 'Parking', hint: 'Campus: a parking area' },
  { kind: 'water', icon: '💧', label: 'Water', hint: 'Campus: a lake, pond or swimming pool' },
  { kind: 'tree', icon: '🌳', label: 'Tree', hint: 'Campus: one tree (a small outline)' },
];

export function OutlinePanel() {
  const { store, state } = useEditor();
  const current = SHAPE_KINDS_UI.find((k) => k.kind === state.shapeKind);
  return (
    <section class="outline-panel">
      <h2>▭ Outline</h2>
      <div class="kinds" role="radiogroup" aria-label="Draw">
        {SHAPE_KINDS_UI.map((k) => (
          <button
            key={k.kind}
            type="button"
            role="radio"
            aria-checked={state.shapeKind === k.kind}
            class={state.shapeKind === k.kind ? 'active' : ''}
            onClick={() => store.setShapeKind(k.kind)}
          >
            <span aria-hidden="true">{k.icon}</span> {k.label}
          </button>
        ))}
      </div>
      <p class="muted small">{current?.hint}</p>
      <p class="muted small">
        <b>Drag</b> for a rectangle · or <b>click</b> corner by corner, then click the first corner
        (or double-click / Enter) to finish · Esc cancels. Corners snap to other outlines and a ½ m
        grid.
      </p>
    </section>
  );
}

export function ShapeProps({
  store,
  doc,
  levelId,
  index,
  shape,
}: {
  store: EditorStore;
  doc: MapFile;
  levelId: string;
  index: number;
  shape: Shape;
}) {
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const rooms = doc.rooms.filter((r) => r.doors.some((d) => nodes.get(d)?.lvl === levelId));
  const edit = (label: string, patch: Parameters<typeof updateShape>[3]) =>
    store.edit(label, (d) => updateShape(d, levelId, index, patch));
  const kind = SHAPE_KINDS_UI.find((k) => k.kind === shape.kind);
  return (
    <section>
      <h2>
        {kind?.icon} Outline: {kind?.label}
      </h2>
      <label>
        Kind
        <select
          value={shape.kind}
          onChange={(e) =>
            edit('Change outline', { kind: (e.target as HTMLSelectElement).value as ShapeKind })
          }
        >
          {SHAPE_KINDS_UI.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      {shape.kind === 'room' && (
        <label>
          Room
          <select
            aria-label="Linked room"
            value={shape.room ?? ''}
            onChange={(e) =>
              edit('Link outline', { room: (e.target as HTMLSelectElement).value || null })
            }
          >
            <option value="">— not linked (use a label) —</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.number ? ` (${r.number})` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {shape.kind === 'building' && (
        <label>
          Building
          <select
            aria-label="Linked building"
            value={shape.building ?? ''}
            onChange={(e) =>
              edit('Link footprint', { building: (e.target as HTMLSelectElement).value || null })
            }
          >
            <option value="">— not linked (use a label) —</option>
            {(doc.buildings ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!shape.room && !shape.building && shape.kind !== 'floor' && (
        <label>
          Label on the map
          <input
            key={`${levelId}-${index}`}
            value={shape.label ?? ''}
            placeholder="e.g. Store, Toilets, Courtyard"
            maxLength={40}
            onChange={(e) =>
              edit('Label outline', { label: (e.target as HTMLInputElement).value.trim() || null })
            }
          />
        </label>
      )}
      <p class="muted small">{shape.pts.length / 2} corners · drag the white squares to reshape</p>
      <button
        type="button"
        class="danger"
        onClick={() => store.edit('Delete outline', (d) => deleteShape(d, levelId, index))}
      >
        🗑 Delete outline
      </button>
    </section>
  );
}
