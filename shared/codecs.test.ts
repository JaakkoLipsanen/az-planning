import { describe, expect, it } from 'vitest';

import { elevationGain, simplify, type LngLat } from './geo.ts';
import { escapeXml, parseTrackPoints, parseWaypoints, writeGpx } from './gpx.ts';
import { decodeIntegers, decodePolyline, encodeIntegers, encodePolyline } from './polyline.ts';
import { countTiles, fromTileRuns, tileAt, tileBounds, toTileRuns } from './tiles.ts';

describe('polyline', () => {
  it('round-trips coordinates at 1e-5 precision', () => {
    const points: LngLat[] = [
      [-111.99026, 33.44666],
      [-111.98, 33.4],
      [-110.5, 31.33497],
    ];
    expect(decodePolyline(encodePolyline(points))).toEqual(points);
  });

  it('matches the reference Google encoding', () => {
    expect(
      encodePolyline([
        [-120.2, 38.5],
        [-120.95, 40.7],
        [-126.453, 43.252],
      ]),
    ).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });

  it('round-trips integer series', () => {
    const values = [348, 352, 350, 2791, -12, 0];
    expect(decodeIntegers(encodeIntegers(values))).toEqual(values);
  });
});

describe('tiles', () => {
  it('compresses tile sets into runs and back', () => {
    const tiles = [
      { z: 12, x: 770, y: 1630 },
      { z: 12, x: 770, y: 1628 },
      { z: 12, x: 770, y: 1629 },
      { z: 12, x: 771, y: 1629 },
    ];
    const runs = toTileRuns(tiles);
    expect(runs).toEqual([
      [12, 770, 1628, 1630],
      [12, 771, 1629, 1629],
    ]);
    expect(countTiles(runs)).toBe(4);
    expect([...fromTileRuns(runs)]).toHaveLength(4);
  });

  it('finds the tile containing a point', () => {
    const tile = tileAt(-110.76, 32.445, 13);
    const [w, s, e, n] = tileBounds(tile);
    expect(-110.76).toBeGreaterThanOrEqual(w);
    expect(-110.76).toBeLessThan(e);
    expect(32.445).toBeGreaterThan(s);
    expect(32.445).toBeLessThanOrEqual(n);
  });
});

describe('geo', () => {
  it('drops points within the simplification tolerance', () => {
    const line: LngLat[] = [
      [0, 0],
      [0.00001, 0.000001],
      [0.001, 0],
    ];
    expect(simplify(line, 5)).toEqual([line[0], line[2]]);
  });

  it('counts climb with hysteresis', () => {
    expect(elevationGain([100, 102, 104, 106, 100, 120, null, 118], 5)).toBe(26);
  });
});

describe('gpx', () => {
  it('keeps track point text verbatim', () => {
    const points = [
      { lat: '33.446660', lon: '-111.990260', ele: '347.7' },
      { lat: '33.4467', lon: '-111.99', ele: '' },
    ];
    const xml = writeGpx({ name: 'Test & route', creator: 'test', tracks: [{ name: 'A', points }] });
    expect(parseTrackPoints(xml)).toEqual(points);
    expect(xml).toContain('Test &amp; route');
  });

  it('reads waypoints in either attribute order and decodes entities', () => {
    const xml =
      '<gpx><wpt lon="-110.75" lat="31.53"><name>Stage Stop Inn &amp; Café</name><desc><p>Rooms</p></desc></wpt></gpx>';
    expect(parseWaypoints(xml)).toEqual([
      { lat: 31.53, lng: -110.75, name: 'Stage Stop Inn & Café', description: 'Rooms' },
    ]);
  });

  it('escapes markup characters', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
  });
});
