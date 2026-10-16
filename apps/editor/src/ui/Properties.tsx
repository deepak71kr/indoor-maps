import { roomIcon } from '@innermap/core';
/** Properties of the selected dot(s), line, room or lift/staircase. */
import type { Amenity, Connector, Edge, MapFile, MapNode, QrAnchor, Room } from '@innermap/schema';
import { EDGE_KINDS, NODE_KINDS, ROOM_CATEGORIES } from '@innermap/schema';
import {
  deleteAmenity,
  deleteConnector,
  deleteQr,
  QR_CODE_PATTERN,
  updateAmenity,
  updateQr,
  deleteItems,
  deleteRoom,
  renameConnector,
  roomOfDoor,
  setConnectorLevels,
  updateEdge,
  updateNode,
  updateRoom,
} from '../model/drawing';
import { sortedLevels } from '../model/project';
import type { EditorStore } from '../model/store';
import { AMENITIES } from './amenities';
import { ShapeProps } from './PlanPanels';
import { useEditor } from './use-editor';

/** Plain-language names for dot kinds. */
const KIND_LABEL: Record<MapNode['kind'], string> = {
  junction: 'Corridor point',
  corner: 'Corner',
  entrance: 'Entrance',
  door: 'Door',
  'lift-stop': 'Lift stop',
  'stairs-stop': 'Stairs stop',
};
/** Line tags the routing rules understand (LLD §3). */
const EDGE_TAGS: ReadonlyArray<{ tag: string; label: string }> = [
  { tag: 'steps', label: 'Has steps (not step-free)' },
  { tag: 'covered', label: 'Covered (rain)' },
  { tag: 'hazard', label: 'Hazard — never route' },
  { tag: 'ppe-required', label: 'PPE required' },
];

export function Properties() {
  const { store, state } = useEditor();
  const { doc, selection } = state;
  if (!selection) return null;
  switch (selection.type) {
    case 'nodes': {
      const nodes = doc.nodes.filter((n) => selection.ids.includes(n.id));
      const [only] = nodes;
      return nodes.length === 1 && only ? (
        <NodeProps store={store} doc={doc} node={only} />
      ) : (
        <section>
          <h2>{nodes.length} dots selected</h2>
          <DeleteButton
            label="Delete dots"
            onClick={() =>
              store.edit('Delete dots', (d) => deleteItems(d, new Set(selection.ids), []))
            }
          />
        </section>
      );
    }
    case 'edge': {
      const edge = doc.edges.find(
        (e) =>
          (e.a === selection.a && e.b === selection.b) ||
          (e.a === selection.b && e.b === selection.a),
      );
      return edge ? <EdgeProps store={store} doc={doc} edge={edge} /> : null;
    }
    case 'shape': {
      const shape = doc.levels.find((l) => l.id === selection.levelId)?.shapes?.[selection.index];
      return shape ? (
        <ShapeProps
          store={store}
          doc={doc}
          levelId={selection.levelId}
          index={selection.index}
          shape={shape}
        />
      ) : null;
    }
    case 'room': {
      const room = doc.rooms.find((r) => r.id === selection.id);
      return room ? <RoomProps store={store} doc={doc} room={room} /> : null;
    }
    case 'amenity': {
      const amenity = doc.amenities.find((a) => a.id === selection.id);
      return amenity ? <AmenityProps store={store} doc={doc} amenity={amenity} /> : null;
    }
    case 'qr': {
      const qr = doc.qr.find((q) => q.code === selection.code);
      return qr ? <QrProps store={store} doc={doc} qr={qr} /> : null;
    }
    case 'connector': {
      const connector = doc.connectors.find((c) => c.id === selection.id);
      return connector ? <ConnectorProps store={store} doc={doc} connector={connector} /> : null;
    }
  }
}

interface Props {
  readonly store: EditorStore;
  readonly doc: MapFile;
}

function NodeProps({ store, doc, node }: Props & { node: MapNode }) {
  const room = node.kind === 'door' ? roomOfDoor(doc, node.id) : undefined;
  const connector = doc.connectors.find((c) => Object.values(c.stops).includes(node.id));
  return (
    <section>
      <h2>Dot · {KIND_LABEL[node.kind]}</h2>
      <label>
        Landmark people can see
        <input
          key={node.id}
          value={node.landmark ?? ''}
          placeholder="e.g. Pharmacy counter (green board)"
          onChange={(e) => {
            const landmark = (e.target as HTMLInputElement).value.trim();
            if (landmark !== (node.landmark ?? ''))
              store.edit('Name landmark', (d) =>
                updateNode(d, node.id, { landmark: landmark || null }),
              );
          }}
        />
      </label>
      <p class="muted small">
        Named dots become steps for visitors. Use something visible: a sign, a counter, a color.
      </p>
      <label>
        Kind
        <select
          value={node.kind}
          disabled={!!connector}
          onChange={(e) => {
            const kind = (e.target as HTMLSelectElement).value as MapNode['kind'];
            store.edit('Change dot kind', (d) => updateNode(d, node.id, { kind }));
          }}
        >
          {NODE_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      {room && (
        <button
          type="button"
          class="link"
          onClick={() => store.select({ type: 'room', id: room.id })}
        >
          Door of “{room.name}” →
        </button>
      )}
      {connector && (
        <button
          type="button"
          class="link"
          onClick={() => store.select({ type: 'connector', id: connector.id })}
        >
          Stop of “{connector.name}” →
        </button>
      )}
      <p class="muted small">
        {node.id} · x {node.x.toFixed(2)} m · y {node.y.toFixed(2)} m
      </p>
      <DeleteButton
        label="Delete dot"
        onClick={() => store.edit('Delete dot', (d) => deleteItems(d, new Set([node.id]), []))}
      />
    </section>
  );
}

function EdgeProps({ store, doc, edge }: Props & { edge: Edge }) {
  const [a, b] = [doc.nodes.find((n) => n.id === edge.a), doc.nodes.find((n) => n.id === edge.b)];
  const length = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
  const tags = edge.tags ?? [];
  const set = (label: string, patch: Parameters<typeof updateEdge>[3]) =>
    store.edit(label, (d) => updateEdge(d, edge.a, edge.b, patch));
  return (
    <section>
      <h2>Line · {length.toFixed(1)} m</h2>
      <label>
        Type
        <select
          value={edge.kind ?? 'walk'}
          onChange={(e) => {
            const kind = (e.target as HTMLSelectElement).value as NonNullable<Edge['kind']>;
            set('Change line type', { kind: kind === 'walk' ? null : kind });
          }}
        >
          {EDGE_KINDS.map((k) => (
            <option key={k} value={k}>
              {k === 'walk' ? 'Walk' : k === 'ramp' ? 'Ramp' : 'Outdoor'}
            </option>
          ))}
        </select>
      </label>
      {EDGE_TAGS.map(({ tag, label }) => (
        <label key={tag} class="check">
          <input
            type="checkbox"
            checked={tags.includes(tag)}
            onChange={(e) => {
              const on = (e.target as HTMLInputElement).checked;
              const next = on ? [...tags, tag] : tags.filter((t) => t !== tag);
              set('Change line tags', { tags: next.length > 0 ? next : null });
            }}
          />
          {label}
        </label>
      ))}
      <label class="check">
        <input
          type="checkbox"
          checked={!!edge.oneWay}
          onChange={(e) =>
            set('One-way', { oneWay: (e.target as HTMLInputElement).checked ? true : null })
          }
        />
        One-way ({a?.landmark ?? edge.a} → {b?.landmark ?? edge.b})
      </label>
      <DeleteButton
        label="Delete line"
        onClick={() =>
          store.edit('Delete line', (d) => deleteItems(d, new Set(), [[edge.a, edge.b]]))
        }
      />
    </section>
  );
}

function RoomProps({ store, doc, room }: Props & { room: Room }) {
  const set = (label: string, patch: Parameters<typeof updateRoom>[2]) =>
    store.edit(label, (d) => updateRoom(d, room.id, patch));
  const doorName = (id: string) => doc.nodes.find((n) => n.id === id)?.landmark ?? id;
  return (
    <section>
      <h2>Room</h2>
      <label>
        Name
        <input
          key={room.id}
          value={room.name}
          onChange={(e) => {
            const name = (e.target as HTMLInputElement).value.trim();
            if (name && name !== room.name) set('Rename room', { name });
          }}
        />
      </label>
      <label>
        Number on the door
        <input
          key={`${room.id}-n`}
          value={room.number ?? ''}
          placeholder="e.g. 214"
          onChange={(e) => {
            const number = (e.target as HTMLInputElement).value.trim();
            if (number !== (room.number ?? '')) set('Room number', { number: number || null });
          }}
        />
      </label>
      <label>
        Icon on the map
        <input
          key={`${room.id}-i`}
          class="icon-input"
          value={room.icon ?? ''}
          maxLength={8}
          placeholder={`${roomIcon(room, '📍')} (automatic)`}
          onChange={(e) => {
            const icon = (e.target as HTMLInputElement).value.trim();
            if (icon !== (room.icon ?? '')) set('Room icon', { icon: icon || null });
          }}
        />
      </label>
      <label>
        Category
        <select
          value={room.category}
          onChange={(e) =>
            set('Room category', {
              category: (e.target as HTMLSelectElement).value as Room['category'],
            })
          }
        >
          {ROOM_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={room.visibility === 'locked'}
          onChange={(e) =>
            set('Staff only', {
              visibility: (e.target as HTMLInputElement).checked ? 'locked' : null,
            })
          }
        />
        Staff only 🔒 (shown, but visitors are told to ask at the door)
      </label>
      <div class="field">
        <span>Doors</span>
        <ul class="plain">
          {room.doors.map((id) => (
            <li key={id}>
              <button
                type="button"
                class="link"
                onClick={() => store.select({ type: 'nodes', ids: [id] })}
              >
                🚪 {doorName(id)}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => {
            store.setTool('room');
            store.setPickDoorFor(room.id);
          }}
        >
          + Add another door
        </button>
      </div>
      <DeleteButton
        label="Delete room (keeps its doors)"
        onClick={() => store.edit('Delete room', (d) => deleteRoom(d, room.id))}
      />
    </section>
  );
}

function ConnectorProps({ store, doc, connector }: Props & { connector: Connector }) {
  const served = new Set(Object.keys(connector.stops));
  return (
    <section>
      <h2>{connector.kind === 'lift' ? '🛗 Lift' : '🪜 Staircase'}</h2>
      <label>
        Name
        <input
          key={connector.id}
          value={connector.name}
          onChange={(e) => {
            const name = (e.target as HTMLInputElement).value.trim();
            if (name && name !== connector.name)
              store.edit('Rename', (d) => renameConnector(d, connector.id, name));
          }}
        />
      </label>
      <div class="field">
        <span>Stops at</span>
        {sortedLevels(doc)
          .reverse()
          .map((level) => (
            <label key={level.id} class="check">
              <input
                type="checkbox"
                checked={served.has(level.id)}
                onChange={(e) => {
                  const on = (e.target as HTMLInputElement).checked;
                  const next = on
                    ? [...served, level.id]
                    : [...served].filter((id) => id !== level.id);
                  store.edit('Change floors', (d) => setConnectorLevels(d, connector.id, next));
                }}
              />
              {level.name}
            </label>
          ))}
        <p class="muted small">
          A lift can skip floors. Connect each stop to a corridor with the Path tool.
        </p>
      </div>
      <DeleteButton
        label={`Delete ${connector.kind === 'lift' ? 'lift' : 'staircase'} (all floors)`}
        onClick={() => store.edit('Delete', (d) => deleteConnector(d, connector.id))}
      />
    </section>
  );
}

function AmenityProps({ store, doc, amenity }: Props & { amenity: Amenity }) {
  const node = doc.nodes.find((n) => n.id === amenity.node);
  return (
    <section>
      <h2>Amenity</h2>
      <label>
        Kind
        <select
          value={amenity.kind}
          onChange={(e) => {
            const kind = (e.target as HTMLSelectElement).value as Amenity['kind'];
            store.edit('Change amenity', (d) => updateAmenity(d, amenity.id, { kind }));
          }}
        >
          {AMENITIES.map((a) => (
            <option key={a.kind} value={a.kind}>
              {a.emoji} {a.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Name (optional)
        <input
          key={amenity.id}
          value={amenity.name ?? ''}
          placeholder="e.g. SBI ATM"
          onChange={(e) => {
            const name = (e.target as HTMLInputElement).value.trim();
            if (name !== (amenity.name ?? ''))
              store.edit('Name amenity', (d) =>
                updateAmenity(d, amenity.id, { name: name || null }),
              );
          }}
        />
      </label>
      <p class="muted small">At: {node?.landmark ?? amenity.node}</p>
      <DeleteButton
        label="Delete amenity"
        onClick={() => store.edit('Delete amenity', (d) => deleteAmenity(d, amenity.id))}
      />
    </section>
  );
}

const DIRECTIONS = [
  ['N', 0],
  ['NE', 45],
  ['E', 90],
  ['SE', 135],
  ['S', 180],
  ['SW', 225],
  ['W', 270],
  ['NW', 315],
] as const;

function QrProps({ store, doc, qr }: Props & { qr: QrAnchor }) {
  const node = doc.nodes.find((n) => n.id === qr.node);
  return (
    <section>
      <h2>🔳 QR sticker</h2>
      <label>
        Code printed under the QR
        <input
          key={qr.code}
          value={qr.code}
          onChange={(e) => {
            const input = e.target as HTMLInputElement;
            const code = input.value.trim().toUpperCase();
            if (code === qr.code) return;
            if (!QR_CODE_PATTERN.test(code) || doc.qr.some((q) => q.code === code)) {
              input.value = qr.code;
              alert('Codes are 2–16 capital letters, digits or "-", and must be unique.');
              return;
            }
            store.edit('Rename QR sticker', (d) => updateQr(d, qr.code, { code }));
            store.select({ type: 'qr', code });
          }}
        />
      </label>
      <div class="field">
        <span>Reader faces (the wall it is stuck on): {qr.facing}°</span>
        <div class="compass">
          {DIRECTIONS.map(([label, deg]) => (
            <button
              key={label}
              type="button"
              aria-pressed={qr.facing === deg}
              onClick={() =>
                store.edit('Turn QR sticker', (d) => updateQr(d, qr.code, { facing: deg }))
              }
            >
              {label}
            </button>
          ))}
        </div>
        <p class="muted small">Up on the plan is N. Tip: with the QR tool, drag from the dot.</p>
      </div>
      <p class="muted small">At: {node?.landmark ?? qr.node}</p>
      <DeleteButton
        label="Delete QR sticker"
        onClick={() => store.edit('Delete QR sticker', (d) => deleteQr(d, qr.code))}
      />
    </section>
  );
}

function DeleteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" class="danger" onClick={onClick}>
      🗑 {label}
    </button>
  );
}
