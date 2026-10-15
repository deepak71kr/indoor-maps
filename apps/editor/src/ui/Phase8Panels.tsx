/** Phase 8 panels: amenity palette, checks, ▶ test route, print stickers, open on phone. */
import type { Destination } from '@innermap/core';
import type { MapFile } from '@innermap/schema';
import QRCode from 'qrcode';
import { useEffect, useState } from 'preact/hooks';
import { printStickers } from '../infra/stickers';
import { publishToDevServer, savedVisitorUrl, saveVisitorUrl } from '../infra/visitor-link';
import { collectIssues } from '../model/issues';
import { sortedLevels } from '../model/project';
import { AMENITIES, AMENITY_DRAG_TYPE } from './amenities';
import { testRoute } from './test-route';
import { useEditor } from './use-editor';

// ---------- amenity palette ----------

export function AmenityPalette() {
  const { store, state } = useEditor();
  return (
    <div class="palette" aria-label="Amenities">
      <small class="palette-title">Amenities</small>
      {AMENITIES.map((a) => (
        <button
          key={a.kind}
          type="button"
          draggable
          class={
            state.tool === 'amenity' && state.amenityKind === a.kind
              ? 'amenity-btn active'
              : 'amenity-btn'
          }
          title={`${a.label} — drag onto the map, or click then click the map`}
          aria-label={a.label}
          onDragStart={(e: DragEvent) => e.dataTransfer?.setData(AMENITY_DRAG_TYPE, a.kind)}
          onClick={() => store.setAmenityKind(a.kind)}
        >
          {a.emoji}
        </button>
      ))}
    </div>
  );
}

// ---------- checks ----------

export function Checks() {
  const { store, state } = useEditor();
  const issues = collectIssues(state.doc);
  const errors = issues.filter((i) => i.severity === 'error').length;
  return (
    <section>
      <h2>
        Checks{' '}
        {issues.length === 0 ? '✅' : `· ${errors} errors, ${issues.length - errors} warnings`}
      </h2>
      {issues.length === 0 ? (
        <p class="muted">No problems found. Try ▶ Test route.</p>
      ) : (
        <ul class="issues">
          {issues.slice(0, 40).map((issue, i) => (
            <li key={i}>
              <button
                type="button"
                class={`issue ${issue.severity}`}
                disabled={!issue.target}
                onClick={() => issue.target && store.focusOn(issue.target)}
                title={issue.target ? 'Show on the map' : undefined}
              >
                {issue.severity === 'error' ? '✖' : '⚠'} {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- ▶ test route ----------

export function TestRoutePanel() {
  const { store, state } = useEditor();
  const { doc, test } = state;
  const from = test.from ? doc.nodes.find((n) => n.id === test.from) : undefined;
  const result = testRoute(doc, test);
  const levels = new Map(doc.levels.map((l) => [l.id, l]));

  const destinations: Array<{ value: string; label: string; to: Destination }> = [
    ...sortedLevels(doc).flatMap((level) =>
      doc.rooms
        .filter((r) => doc.nodes.find((n) => n.id === r.doors[0])?.lvl === level.id)
        .map((r) => ({
          value: `room:${r.id}`,
          label: `${r.name}${r.number ? ` (${r.number})` : ''} — ${level.name}`,
          to: { type: 'room', roomId: r.id } as const,
        })),
    ),
    ...[...new Set(doc.amenities.map((a) => a.kind))].map((kind) => ({
      value: `amenity:${kind}`,
      label: `Nearest ${kind.replace(/-/g, ' ')}`,
      to: { type: 'amenity', kinds: [kind] } as const,
    })),
  ];
  const selected =
    test.to?.type === 'room'
      ? `room:${test.to.roomId}`
      : test.to?.type === 'amenity'
        ? `amenity:${test.to.kinds[0] ?? ''}`
        : '';

  return (
    <section class="test-panel">
      <h2>▶ Test route</h2>
      <p>
        <b>From:</b>{' '}
        {from ? (from.landmark ?? from.id) : <span class="muted">click a dot on the map</span>}
        {from && doc.qr.some((q) => q.node === from.id) && (
          <span class="muted"> (QR facing used)</span>
        )}
      </p>
      <label>
        To
        <select
          value={selected}
          onChange={(e) => {
            const value = (e.target as HTMLSelectElement).value;
            store.setTest({ to: destinations.find((d) => d.value === value)?.to ?? null });
          }}
        >
          <option value="">Choose a destination…</option>
          {destinations.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={test.stepFree}
          onChange={(e) => store.setTest({ stepFree: (e.target as HTMLInputElement).checked })}
        />
        ♿ Step-free
      </label>
      {result.error && <p class="error-text">{result.error}</p>}
      {result.steps.length > 0 && (
        <ol class="steps">
          {result.steps.map((step, i) => (
            <li key={i}>
              <button
                type="button"
                class="step"
                onClick={() => store.focusOn({ node: step.target })}
                title="Show on the map"
              >
                <span class={`floor-badge lvl-${levels.get(step.levelId)?.color ?? 'slate'}`}>
                  {step.levelName}
                </span>{' '}
                {step.text}
                {step.meters > 0 && <small class="muted"> · {step.meters} m</small>}
              </button>
            </li>
          ))}
        </ol>
      )}
      <button type="button" onClick={() => store.setTool('select')}>
        Done testing
      </button>
    </section>
  );
}

// ---------- print stickers & open on phone ----------

/** In development the visitor runs on localhost; a phone needs the laptop's Wi-Fi address. */
async function phoneReachableBase(base: string): Promise<string> {
  const host = new URL(base).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') return base;
  try {
    const response = await fetch(`${base}/__inner-map/lan`);
    const { urls } = (await response.json()) as { urls?: string[] };
    return urls?.[0] ?? base;
  } catch {
    return base;
  }
}

export function PrintStickersButton() {
  const { state } = useEditor();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy || state.doc.qr.length === 0}
      title={
        state.doc.qr.length === 0
          ? 'Add QR stickers with the QR tool first'
          : 'Print an A4 sheet of stickers'
      }
      onClick={() => {
        setBusy(true);
        void phoneReachableBase(savedVisitorUrl())
          .then((base) => printStickers(state.doc, base))
          .catch((e: unknown) => alert(e instanceof Error ? e.message : String(e)))
          .finally(() => setBusy(false));
      }}
    >
      🖨 Print QR ({state.doc.qr.length})
    </button>
  );
}

export function OpenOnPhoneButton() {
  const { state } = useEditor();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        📱 Open on phone
      </button>
      {open && <PhoneDialog doc={state.doc} onClose={() => setOpen(false)} />}
    </>
  );
}

function PhoneDialog({ doc, onClose }: { doc: MapFile; onClose: () => void }) {
  const [base, setBase] = useState(savedVisitorUrl());
  const [status, setStatus] = useState<
    | { kind: 'working' }
    | { kind: 'ready'; url: string; svg: string }
    | { kind: 'error'; message: string }
  >({ kind: 'working' });

  useEffect(() => {
    setStatus({ kind: 'working' });
    let cancelled = false;
    void (async () => {
      try {
        const urls = await publishToDevServer(base, doc);
        const url = `${urls[0] ?? base}/?site=${encodeURIComponent(doc.site.id)}`;
        const svg = await QRCode.toString(url, { type: 'svg', margin: 1 });
        if (!cancelled) setStatus({ kind: 'ready', url, svg });
      } catch {
        if (!cancelled)
          setStatus({
            kind: 'error',
            message: `Couldn't reach the visitor app at ${base}. Start it with "pnpm dev:visitor" (same laptop), or fix the address below.`,
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, doc]);

  return (
    <div class="dialog-backdrop" onClick={onClose}>
      <div
        class="dialog"
        role="dialog"
        aria-label="Open on phone"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>📱 Open on phone</h2>
        {status.kind === 'working' && <p>Publishing this map to the visitor app…</p>}
        {status.kind === 'error' && <p class="error-text">{status.message}</p>}
        {status.kind === 'ready' && (
          <>
            <p>
              Scan with a phone on the <b>same Wi-Fi</b>:
            </p>
            <div class="phone-qr" dangerouslySetInnerHTML={{ __html: status.svg }} />
            <p>
              <a href={status.url} target="_blank" rel="noreferrer">
                {status.url}
              </a>
            </p>
          </>
        )}
        <label>
          Visitor app address
          <input
            value={base}
            onChange={(e) => {
              const value = (e.target as HTMLInputElement).value.trim();
              saveVisitorUrl(value);
              setBase(value);
            }}
          />
        </label>
        <p class="muted small">
          Development only: the map is saved to the visitor dev server on this laptop. Real
          publishing comes in v0.
        </p>
        <button type="button" class="primary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
