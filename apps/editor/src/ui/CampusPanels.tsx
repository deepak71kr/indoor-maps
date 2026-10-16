/** Phase 10 panels: the site's buildings, and which building the current floor belongs to. */
import type { Level } from '@innermap/schema';
import {
  addBuilding,
  deleteBuilding,
  floorsOf,
  renameBuilding,
  setLevelBuilding,
} from '../model/campus';
import { useEditor } from './use-editor';

export function BuildingsPanel() {
  const { store, state } = useEditor();
  const { doc } = state;
  const buildings = doc.buildings ?? [];
  const add = () => {
    const name = prompt('Building name (e.g. Block A, Library)');
    if (name?.trim()) store.edit(`Add ${name.trim()}`, (d) => addBuilding(d, name).doc);
  };
  return (
    <section class="buildings">
      <h2>🏢 Buildings</h2>
      {buildings.length === 0 && (
        <p class="muted small">
          One building? Skip this. For a campus, add each building, draw its footprint on the Ground
          floor (Outline → Building) and give it its own upper floors.
        </p>
      )}
      <ul class="building-list">
        {buildings.map((b) => {
          const floors = floorsOf(doc, b.id).length;
          return (
            <li key={b.id}>
              <input
                aria-label={`Name of ${b.name}`}
                value={b.name}
                onChange={(e) => {
                  const name = (e.target as HTMLInputElement).value;
                  if (name.trim() && name.trim() !== b.name)
                    store.edit('Rename building', (d) => renameBuilding(d, b.id, name));
                }}
              />
              <small class="muted">
                {floors} floor{floors === 1 ? '' : 's'}
              </small>
              {floors === 0 && (
                <button
                  type="button"
                  aria-label={`Delete ${b.name}`}
                  title="Delete building (its footprint stays, unlinked)"
                  onClick={() => store.edit(`Delete ${b.name}`, (d) => deleteBuilding(d, b.id))}
                >
                  🗑
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={add}>
        + Building
      </button>
    </section>
  );
}

/** "Belongs to": shared (ground / outdoors) or one building. Hidden on single-building sites. */
export function FloorBuildingField({ level }: { level: Level }) {
  const { store, state } = useEditor();
  const buildings = state.doc.buildings ?? [];
  if (buildings.length === 0) return null;
  return (
    <label>
      Belongs to
      <select
        value={level.building ?? ''}
        onChange={(e) => {
          const value = (e.target as HTMLSelectElement).value || null;
          store.edit('Change building', (d) => setLevelBuilding(d, level.id, value));
        }}
      >
        <option value="">Whole site (ground / outdoors)</option>
        {buildings.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
