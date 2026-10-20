/**
 * ⚡ Quick build (side panel): the building wizard, copy a floor, a room list from a
 * spreadsheet, and auto-connect. Each is one undoable step (model/generate.ts).
 */
import { useState } from 'preact/hooks';
import { pickFile } from '../infra/files';
import {
  autoConnect,
  copyFloor,
  DEFAULT_BUILDING,
  generateBuilding,
  importRoomList,
} from '../model/generate';
import type { BuildingSpec } from '../model/generate';
import { isLevelEmpty, nextLevel } from '../model/project';
import { levelLabel } from '../model/campus';
import { useEditor } from './use-editor';

export function QuickBuild() {
  const { store, state } = useEditor();
  const { doc, levelId } = state;
  const level = doc.levels.find((l) => l.id === levelId);
  const [open, setOpen] = useState<'wizard' | 'rooms' | null>(null);
  const [spec, setSpec] = useState<BuildingSpec>(DEFAULT_BUILDING);
  const [list, setList] = useState('');
  const [note, setNote] = useState('');
  if (!level) return null;

  const num = (key: keyof BuildingSpec, min: number, max: number) => (e: Event) => {
    const v = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(v)) setSpec({ ...spec, [key]: Math.max(min, Math.min(max, v)) });
  };

  const build = () => {
    let floors = 0;
    store.edit(`Build ${spec.name}`, (d) => {
      const result = generateBuilding(d, levelId, spec);
      floors = result.levelIds.length;
      return result.doc;
    });
    setNote(
      `✅ ${spec.name}: ${floors} floor${floors === 1 ? '' : 's'} drawn. Rename the rooms, or import a room list.`,
    );
    setOpen(null);
  };

  // Copy this floor onto a new floor above (or onto an empty one).
  const empties = doc.levels.filter(
    (l) => l.id !== levelId && l.building === level.building && isLevelEmpty(doc, l.id),
  );
  const copyTo = (targetId: string | null) => {
    let made = '';
    store.edit(`Copy ${level.name}`, (d) => {
      let next = d;
      let to = targetId;
      if (!to) {
        const fresh = nextLevel(next, level.building);
        next = { ...next, levels: [...next.levels, fresh] };
        to = fresh.id;
      }
      made = to;
      return copyFloor(next, levelId, to);
    });
    if (made) store.setLevel(made);
    setNote('✅ Floor copied: rooms renumbered, lifts and stairs now stop there too.');
  };

  const importList = (text: string) => {
    let result = { updated: 0, notFound: [] as string[] };
    store.edit('Import room list', (d) => {
      const r = importRoomList(d, text);
      result = r;
      return r.doc;
    });
    setNote(
      result.notFound.length
        ? `✅ ${result.updated} rooms updated · ⚠️ not found: ${result.notFound.slice(0, 8).join(', ')}${result.notFound.length > 8 ? '…' : ''}`
        : `✅ ${result.updated} rooms updated.`,
    );
    if (result.updated > 0) {
      setList('');
      setOpen(null);
    }
  };

  const connect = () => {
    let counts = { connected: 0, named: 0 };
    store.edit('Auto-connect', (d) => {
      const r = autoConnect(d, levelId);
      counts = r;
      return r.doc;
    });
    setNote(
      counts.connected || counts.named
        ? `✅ ${counts.connected} door${counts.connected === 1 ? '' : 's'} joined, ${counts.named} spot${counts.named === 1 ? '' : 's'} named.`
        : 'Nothing to do: every door is joined and every turning spot has a name.',
    );
  };

  return (
    <section class="quick">
      <h2>⚡ Quick build</h2>
      <div class="quick-grid">
        <button type="button" onClick={() => setOpen(open === 'wizard' ? null : 'wizard')}>
          🏗️ Building wizard
        </button>
        <button type="button" onClick={() => copyTo(null)} title="Same plan on a new floor above">
          📄 Copy floor up
        </button>
        <button type="button" onClick={() => setOpen(open === 'rooms' ? null : 'rooms')}>
          📋 Room list
        </button>
        <button type="button" onClick={connect} title="Join lone doors, name turning spots">
          🔗 Auto-connect
        </button>
      </div>
      {empties.length > 0 && (
        <label>
          Or copy {level.name} onto
          <select
            value=""
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              if (v) copyTo(v);
            }}
          >
            <option value="">— an empty floor —</option>
            {empties.map((l) => (
              <option key={l.id} value={l.id}>
                {levelLabel(doc, l)}
              </option>
            ))}
          </select>
        </label>
      )}

      {open === 'wizard' && (
        <div class="wizard">
          <p class="hint">
            A corridor building with rooms on both sides, lift and stairs, toilets and an entrance,
            starting on <b>{level.name}</b>. Every room, door and corridor spot is named, so the
            checks pass straight away.
          </p>
          <label>
            Name
            <input
              value={spec.name}
              onInput={(e) => setSpec({ ...spec, name: (e.target as HTMLInputElement).value })}
            />
          </label>
          <div class="two">
            <label>
              Length (m)
              <input
                type="number"
                min="12"
                max="300"
                value={spec.length}
                onInput={num('length', 12, 300)}
              />
            </label>
            <label>
              Rooms each side
              <input
                type="number"
                min="1"
                max="40"
                value={spec.roomsPerSide}
                onInput={num('roomsPerSide', 1, 40)}
              />
            </label>
            <label>
              Floors
              <input
                type="number"
                min="1"
                max="20"
                value={spec.floors}
                onInput={num('floors', 1, 20)}
              />
            </label>
            <label>
              Room depth (m)
              <input
                type="number"
                min="3"
                max="20"
                value={spec.roomDepth}
                onInput={num('roomDepth', 3, 20)}
              />
            </label>
            <label>
              Lift and stairs
              <select
                value={spec.core}
                onChange={(e) =>
                  setSpec({
                    ...spec,
                    core: (e.target as HTMLSelectElement).value as BuildingSpec['core'],
                  })
                }
              >
                <option value="start">West end</option>
                <option value="end">East end</option>
                <option value="none">None</option>
              </select>
            </label>
            <label>
              Entrance
              <select
                value={spec.entrance}
                onChange={(e) =>
                  setSpec({
                    ...spec,
                    entrance: (e.target as HTMLSelectElement).value as BuildingSpec['entrance'],
                  })
                }
              >
                <option value="start">West end</option>
                <option value="end">East end</option>
              </select>
            </label>
          </div>
          <button type="button" class="primary" disabled={!spec.name.trim()} onClick={build}>
            Build it
          </button>
        </div>
      )}

      {open === 'rooms' && (
        <div class="wizard">
          <p class="hint">
            Paste rows from a spreadsheet (or a .csv file): <b>number, name, type, popular</b>. A
            header row is optional. Rooms are matched by number; type can be everyday words
            (“Laboratory”, “Accounts”, “HOD”).
          </p>
          <textarea
            rows={6}
            placeholder={
              'Room No,Name,Type,Popular\nG01,Admission office,Admin,yes\nG02,Physics lab,Laboratory,'
            }
            value={list}
            onInput={(e) => setList((e.target as HTMLTextAreaElement).value)}
          />
          <div class="row">
            <button
              type="button"
              class="primary"
              disabled={!list.trim()}
              onClick={() => importList(list)}
            >
              Apply
            </button>
            <button
              type="button"
              onClick={async () => {
                const file = await pickFile('.csv,.tsv,.txt,text/csv,text/plain');
                if (file) importList(await file.text());
              }}
            >
              Open .csv file
            </button>
          </div>
        </div>
      )}
      {note && (
        <p class="quick-note" role="status">
          {note}
        </p>
      )}
    </section>
  );
}
