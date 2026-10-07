/** Moon position and phase from the standard low-precision formulas (good to a few minutes for rise and set). */
const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
const OBLIQUITY = RAD * 23.4397;
const SUN_DISTANCE_KM = 149_598_000;
/** Altitude of the moon's centre at rise and set, with refraction and its radius. */
const HORIZON = RAD * 0.133;
const STEP_MS = 10 * 60_000;

const toDays = (ms: number): number => ms / DAY_MS - 0.5 + J1970 - J2000;

function equatorial(l: number, b: number): { ra: number; dec: number } {
  return {
    ra: Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l)),
    dec: Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l)),
  };
}

function sunCoords(d: number): { ra: number; dec: number } {
  const m = RAD * (357.5291 + 0.98560028 * d);
  const centre = RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  return equatorial(m + centre + RAD * 102.9372 + Math.PI, 0);
}

function moonCoords(d: number): { ra: number; dec: number; distanceKm: number } {
  const l = RAD * (218.316 + 13.176396 * d);
  const m = RAD * (134.963 + 13.064993 * d);
  const f = RAD * (93.272 + 13.22935 * d);
  return {
    ...equatorial(l + RAD * 6.289 * Math.sin(m), RAD * 5.128 * Math.sin(f)),
    distanceKm: 385_001 - 20_905 * Math.cos(m),
  };
}

function moonAltitude(instant: number, lat: number, lng: number): number {
  const d = toDays(instant);
  const { ra, dec } = moonCoords(d);
  const hourAngle = RAD * (280.16 + 360.9856235 * d) + lng * RAD - ra;
  const phi = lat * RAD;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle));
}

/** Lit share of the disc (0-1), and whether the moon is waxing. */
export function moonIllumination(instant: number): { fraction: number; waxing: boolean } {
  const d = toDays(instant);
  const s = sunCoords(d);
  const m = moonCoords(d);
  const elongation = Math.acos(
    Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra),
  );
  const inclination = Math.atan2(
    SUN_DISTANCE_KM * Math.sin(elongation),
    m.distanceKm - SUN_DISTANCE_KM * Math.cos(elongation),
  );
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra),
  );
  return { fraction: (1 + Math.cos(inclination)) / 2, waxing: angle < 0 };
}

export interface MoonNight {
  /** Lit share of the disc in the middle of the night, 0-1. */
  fraction: number;
  waxing: boolean;
  /** Up at the start and the end of the night, and when it rises or sets in between (instants). */
  upAtStart: boolean;
  upAtEnd: boolean;
  rises: number | null;
  sets: number | null;
}

/** The moon between two instants (usually dusk and the next dawn) at a place. */
export function moonNight(from: number, to: number, lat: number, lng: number): MoonNight {
  const up = (t: number): boolean => moonAltitude(t, lat, lng) > HORIZON;
  let rises: number | null = null;
  let sets: number | null = null;
  let previous = up(from);
  for (let t = from + STEP_MS; t <= to; t += STEP_MS) {
    const now = up(t);
    if (now && !previous && rises === null) rises = t - STEP_MS / 2;
    if (!now && previous && sets === null) sets = t - STEP_MS / 2;
    previous = now;
  }
  return { ...moonIllumination((from + to) / 2), upAtStart: up(from), upAtEnd: up(to), rises, sets };
}
