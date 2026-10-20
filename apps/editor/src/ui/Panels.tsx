import { LEVEL_COLORS } from '@innermap/schema';
import campus from '../../../../samples/demo-campus/map.json';
import demo from '../../../../samples/demo-hospital/map.json';
import { parseDraft } from '../infra/autosave';
import { downloadMap, pickFile, readMapFile } from '../infra/files';
import { saveImage } from '../infra/images';
import { addLevel, moveLevel, removeLevel, renameSite, updateLevel } from '../model/commands';
import { levelLabel } from '../model/campus';
import { isLevelEmpty, newProject, nextLevel, pxPerMeter, sortedLevels } from '../model/project';
import type { Tool } from '../model/store';
import {
  AmenityPalette,
  Checks,
  OpenOnPhoneButton,
  PrintStickersButton,
  TestRoutePanel,
} from './Phase8Panels';
import { BuildingsPanel, FloorBuildingField } from './CampusPanels';
import { OutlinePanel } from './PlanPanels';
import { Properties } from './Properties';
import { QuickBuild } from './QuickBuild';
import { useEditor } from './use-editor';

// ---------- top bar ----------

export function TopBar() {
  const { store, state } = useEditor();
  const { past, future } = state.history;
  const lastDone = past[past.length - 1];
  const nextRedo = future[0];

  const importMap = async () => {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    const result = await readMapFile(file);
    if (result.ok) store.load(`Import ${file.name}`, result.doc);
    else alert(result.message);
  };
  const loadDemo = () => {
    const doc = parseDraft(demo);
    if (doc) store.load('Load Demo Hospital', doc);
  };
  const loadCampus = () => {
    const doc = parseDraft(campus);
    if (doc) store.load('Load Demo College', doc);
  };
  // The big campus (34 buildings, ~480 KB): fetched only when asked for.
  const loadMesra = async () => {
    const big = await import('../../../../samples/demo-mesra/map.json');
    const doc = parseDraft(big.default);
    if (doc) store.load('Load BIT Mesra', doc);
  };

  return (
    <header class="topbar">
      <strong class="brand">🗺️ Inner Map Editor</strong>
      <span class="site-name">{state.doc.site.name}</span>
      <span class="grow" />
      <button type="button" onClick={() => store.load('New project', newProject())}>
        New
      </button>
      <button type="button" onClick={loadDemo}>
        Load demo
      </button>
      <button type="button" onClick={loadCampus} title="A 3-building college campus">
        Load campus
      </button>
      <button
        type="button"
        onClick={() => void loadMesra()}
        title="The big campus: 34 buildings, 758 rooms"
      >
        Load BIT Mesra
      </button>
      <button type="button" onClick={() => void importMap()}>
        Import
      </button>
      <button type="button" class="primary" onClick={() => downloadMap(state.doc)}>
        Export
      </button>
      <PrintStickersButton />
      <OpenOnPhoneButton />
      <span class="divider" />
      <button
        type="button"
        disabled={!lastDone}
        onClick={store.undo}
        title={lastDone ? `Undo ${lastDone.label} (Ctrl+Z)` : 'Nothing to undo'}
      >
        ↶ Undo
      </button>
      <button
        type="button"
        disabled={!nextRedo}
        onClick={store.redo}
        title={nextRedo ? `Redo ${nextRedo.label} (Ctrl+Y)` : 'Nothing to redo'}
      >
        ↷ Redo
      </button>
    </header>
  );
}

// ---------- tools ----------

const TOOLS: ReadonlyArray<{
  id: Tool | null;
  icon: string;
  label: string;
  key: string;
  phase?: number;
}> = [
  { id: 'select', icon: '↖', label: 'Select / move', key: 'V' },
  { id: 'scale', icon: '📏', label: 'Set scale', key: 'M' },
  { id: 'outline', icon: '▭', label: 'Outline', key: 'O' },
  { id: 'path', icon: '✏️', label: 'Path', key: 'P' },
  { id: 'door', icon: '🚪', label: 'Door', key: 'D' },
  { id: 'room', icon: '🏷️', label: 'Room', key: 'R' },
  { id: 'lift', icon: '🛗', label: 'Lift', key: 'L' },
  { id: 'stairs', icon: '🪜', label: 'Stairs', key: 'S' },
  { id: 'qr', icon: '🔳', label: 'QR sticker', key: 'Q' },
  { id: 'test', icon: '▶️', label: 'Test route', key: 'T' },
];

export function Toolbar() {
  const { store, state } = useEditor();
  return (
    <nav class="toolbar" aria-label="Tools">
      {TOOLS.map((t) => (
        <button
          key={t.label}
          type="button"
          class={state.tool === t.id ? 'tool active' : 'tool'}
          disabled={!t.id}
          aria-pressed={state.tool === t.id}
          title={t.id ? `${t.label} (${t.key})` : `${t.label} — coming in Phase ${t.phase}`}
          onClick={() => t.id && store.setTool(t.id)}
        >
          <span aria-hidden="true">{t.icon}</span>
          <small>{t.label}</small>
        </button>
      ))}
      <AmenityPalette />
    </nav>
  );
}

// ---------- floor tabs ----------

export function FloorTabs() {
  const { store, state } = useEditor();
  const add = () => {
    // On a campus, a new floor goes on top of the building being edited.
    const current = state.doc.levels.find((l) => l.id === state.levelId);
    const level = nextLevel(state.doc, current?.building);
    store.run(addLevel(level));
    store.setLevel(level.id);
  };
  return (
    <div class="floor-tabs" role="tablist" aria-label="Floors">
      {sortedLevels(state.doc).map((l) => (
        <button
          key={l.id}
          type="button"
          role="tab"
          aria-selected={l.id === state.levelId}
          class={`floor-tab lvl-${l.color}`}
          onClick={() => store.setLevel(l.id)}
        >
          <i class="swatch" /> {levelLabel(state.doc, l)}
        </button>
      ))}
      <button type="button" class="floor-tab add" onClick={add}>
        + Floor
      </button>
    </div>
  );
}

// ---------- properties + issues ----------

export function SidePanel() {
  const { store, state } = useEditor();
  const { doc, levelId } = state;
  const level = doc.levels.find((l) => l.id === levelId);

  const uploadPlan = async () => {
    const file = await pickFile('image/*');
    if (!file || !level) return;
    const ref = await saveImage(file);
    store.run(updateLevel(doc, level.id, { image: ref }, 'Add floor plan'));
  };

  return (
    <aside class="side">
      {state.tool === 'test' && <TestRoutePanel />}
      {state.tool === 'outline' && <OutlinePanel />}
      <Properties />
      <section>
        <h2>Site</h2>
        <label>
          Name
          <input
            value={doc.site.name}
            onChange={(e) => {
              const name = (e.target as HTMLInputElement).value.trim();
              if (name && name !== doc.site.name) store.run(renameSite(doc, name));
            }}
          />
        </label>
      </section>
      <BuildingsPanel />

      {level && (
        <section>
          <h2>Floor</h2>
          <label>
            Name
            <input
              value={level.name}
              onChange={(e) => {
                const name = (e.target as HTMLInputElement).value.trim();
                if (name && name !== level.name)
                  store.run(updateLevel(doc, level.id, { name }, 'Rename floor'));
              }}
            />
          </label>
          <FloorBuildingField level={level} />
          <div class="field">
            <span>Color</span>
            <div class="swatches">
              {LEVEL_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  class={`swatch-btn lvl-${color}`}
                  aria-label={color}
                  aria-pressed={level.color === color}
                  onClick={() =>
                    level.color !== color &&
                    store.run(updateLevel(doc, level.id, { color }, 'Floor color'))
                  }
                />
              ))}
            </div>
          </div>
          <div class="field">
            <span>Order</span>
            <div class="row">
              <button
                type="button"
                onClick={() => runIfAny(store.run, moveLevel(doc, level.id, -1))}
              >
                ↓ Lower
              </button>
              <button
                type="button"
                onClick={() => runIfAny(store.run, moveLevel(doc, level.id, 1))}
              >
                ↑ Higher
              </button>
            </div>
          </div>
          <div class="field">
            <span>Floor plan</span>
            <div class="row">
              <button type="button" onClick={() => void uploadPlan()}>
                {level.image ? 'Replace image' : 'Upload image'}
              </button>
              {level.image && (
                <button
                  type="button"
                  onClick={() =>
                    store.run(updateLevel(doc, level.id, { image: null }, 'Remove floor plan'))
                  }
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          <div class="field">
            <span>Scale</span>
            <div class="row">
              <span class={level.pxPerMeter ? '' : 'warn'}>
                {level.pxPerMeter
                  ? `${level.pxPerMeter.toFixed(1)} px per meter`
                  : `Not set (showing ${pxPerMeter(level)} px/m)`}
              </span>
              <button type="button" onClick={() => store.setTool('scale')}>
                📏 Set
              </button>
            </div>
          </div>
          {doc.levels.length > 1 && isLevelEmpty(doc, level.id) && (
            <button
              type="button"
              class="danger"
              onClick={() => store.run(removeLevel(doc, level.id))}
            >
              Delete this floor
            </button>
          )}
        </section>
      )}

      <QuickBuild />
      <Checks />
    </aside>
  );
}

function runIfAny<T>(run: (c: T) => void, command: T | null) {
  if (command) run(command);
}
