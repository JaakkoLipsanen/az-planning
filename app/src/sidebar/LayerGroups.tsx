import { formatInt } from '../lib/format.ts';
import { DETAIL_LAYERS, useTripState, type DetailLayer } from '../state/tripStore.ts';
import { POI_GROUPS } from '../theme.ts';
import { usePlan, useTripModel } from '../trip/TripContext.tsx';
import { LayerGroup, type GroupEntry, type LayerItem } from './LayerGroup.tsx';

const DETAILS: Record<DetailLayer, { name: string; color: string; swatch?: LayerItem['swatch'] }> = {
  relief: { name: 'Terrain shading & elevation tint', color: '#c9b98f' },
  roadsMajor: { name: 'Major roads (motorway, trunk, primary)', color: '#8a6a4a' },
  roadsMinor: { name: 'Secondary & tertiary roads (zoom 9+)', color: '#9c8468' },
  rail: { name: 'Railways', color: '#6d6460', swatch: 'dash' },
  water: { name: 'Rivers & lakes', color: '#4f8fb3' },
  places: { name: 'Place names & named peaks (by zoom)', color: '#3b3129' },
  forests: { name: 'National forests (faint green)', color: '#5d8a4a' },
  border: { name: 'International border', color: '#b02020', swatch: 'dash' },
  tribal: { name: 'Indigenous land boundaries', color: '#8a3fa0', swatch: 'dash' },
  protected: { name: 'Wilderness areas & national parks', color: '#2f7a3a', swatch: 'dash' },
};

function RouteSections() {
  const model = useTripModel();
  const { bundle } = model;
  const hidden = useTripState((s) => s.hiddenSections);
  const toggle = useTripState((s) => s.toggleInList);
  const surfaceMode = useTripState((s) => s.colorMode === 'surface');
  const entries: GroupEntry[] = bundle.sections.map((section, i) => ({
    id: section.id,
    name: `${section.id} ${section.name}`,
    checked: !hidden.includes(section.id),
    onChange: (on) => toggle('hiddenSections', section.id, !on),
    color: bundle.kinds[section.kind]?.color ?? '#888888',
    swatch: surfaceMode ? 'surface' : 'block',
    detail: `${section.km} km`,
    bounds: model.sectionBounds[i],
  }));
  return (
    <LayerGroup
      title={`Final route (${formatInt(bundle.stats.distanceKm)} km)`}
      entries={entries}
      note="Each section can be hidden on its own. Click a line for details (section, length, climbing, surface)."
    />
  );
}

function Sources() {
  const model = useTripModel();
  const visible = useTripState((s) => s.sources);
  const toggle = useTripState((s) => s.toggleInList);
  const sources = model.bundle.sources ?? [];
  if (sources.length === 0) return null;
  const entries: GroupEntry[] = sources.map((line) => ({
    id: line.id,
    name: line.name,
    checked: visible.includes(line.id),
    onChange: (on) => toggle('sources', line.id, on),
    color: line.color,
    detail: `${line.km} km`,
    bounds: model.lines.get(line.id)?.bounds,
  }));
  return <LayerGroup title="Source routes (complete GPX tracks)" entries={entries} />;
}

function Alternatives() {
  const model = useTripModel();
  const visible = useTripState((s) => s.alternatives);
  const toggle = useTripState((s) => s.toggleInList);
  const groups = model.bundle.alternatives ?? [];
  if (groups.length === 0) return null;
  const entries: GroupEntry[] = groups.flatMap((group) => [
    { heading: group.name },
    ...group.items.map((alt) => ({
      id: alt.id,
      name: alt.name,
      checked: visible.includes(alt.id),
      onChange: (on: boolean) => toggle('alternatives', alt.id, on),
      color: alt.color,
      swatch: 'dash' as const,
      detail: `${alt.km} km`,
      bounds: model.lines.get(alt.id)?.bounds,
    })),
  ]);
  return (
    <LayerGroup
      title="Alternatives considered (not in the final route)"
      entries={entries}
      note="Dashed lines. Short dashes = a published section the final route skips; long dashes = a link option that was not chosen. Click a line to read why."
    />
  );
}

function Points() {
  const model = useTripModel();
  const plan = usePlan();
  const groups = useTripState((s) => s.poiGroups);
  const toggle = useTripState((s) => s.toggleInList);
  const layer = model.bundle.pois;
  if (!layer) return null;
  const counts = new Map<string, number>();
  for (const p of layer.items) {
    const group = p.osm ? 'osm' : p.category;
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  counts.set('plan', plan.nights.length);
  const entries: GroupEntry[] = POI_GROUPS.filter((g) => g.id !== 'plan' || model.bundle.plan).map((g) => ({
    id: g.id,
    name:
      g.id === 'plan'
        ? `Overnights of the ${plan.count}-day plan (${plan.nights.length})`
        : `${g.label} (${counts.get(g.id) ?? 0})`,
    checked: groups.includes(g.id),
    onChange: (on) => toggle('poiGroups', g.id, on),
    color: g.color,
    swatch: 'dot',
  }));
  return (
    <LayerGroup
      title="Points"
      entries={entries}
      note={
        <>
          {layer.note}
          {layer.link && (
            <>
              {' '}
              <a href={layer.link.url} target="_blank" rel="noopener noreferrer">
                {layer.link.label}
              </a>
            </>
          )}
        </>
      }
    />
  );
}

function Land() {
  const { bundle } = useTripModel();
  const visible = useTripState((s) => s.land);
  const toggle = useTripState((s) => s.toggleInList);
  const land = bundle.land;
  if (!land) return null;
  const entries: GroupEntry[] = land.categories.map((c) => ({
    id: c.id,
    name: c.label,
    checked: visible.includes(c.id),
    onChange: (on) => toggle('land', c.id, on),
    color: c.color,
    detail: c.areaKm2 ? `${formatInt(c.areaKm2)} km²` : undefined,
  }));
  return (
    <LayerGroup
      title="Land ownership"
      entries={entries}
      note={`Who manages the surface: ${land.source}. ${land.note ?? ''}`}
    />
  );
}

function MapDetails() {
  const { bundle } = useTripModel();
  const details = useTripState((s) => s.details);
  const setDetail = useTripState((s) => s.setDetail);
  const layers = bundle.basemap ? DETAIL_LAYERS : DETAIL_LAYERS.filter((l) => l === 'relief');
  const entries: GroupEntry[] = layers.map((layer) => ({
    id: layer,
    ...DETAILS[layer],
    checked: details[layer],
    onChange: (on) => setDetail(layer, on),
  }));
  return (
    <LayerGroup
      title="Map details"
      entries={entries}
      note="The basemap and 3D are chosen with the buttons on the map. Over topo or satellite maps the overlay's roads, water and names give way from zoom 11. Drag with the right mouse button (or Ctrl-drag / two fingers) to rotate and tilt; the compass button resets."
    />
  );
}

export function LayerGroups() {
  return (
    <>
      <RouteSections />
      <Sources />
      <Alternatives />
      <Points />
      <Land />
      <MapDetails />
    </>
  );
}
