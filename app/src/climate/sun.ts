/**
 * Sunrise, sunset and twilight from the standard solar position formulas (accurate to about a minute).
 * Times are instants in ms; null when the sun does not cross that altitude on the date (polar day or night).
 */
const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
const J0 = 0.0009;
const OBLIQUITY = RAD * 23.4397;

/** Sun altitudes in degrees: the upper limb on the horizon with refraction, and civil twilight. */
const SUNRISE_ALTITUDE = -0.833;
const CIVIL_ALTITUDE = -6;

export interface SunTimes {
  dawn: number | null;
  sunrise: number | null;
  noon: number;
  sunset: number | null;
  dusk: number | null;
}

const toDays = (ms: number): number => ms / DAY_MS - 0.5 + J1970 - J2000;
const fromJulian = (j: number): number => (j + 0.5 - J1970) * DAY_MS;
const meanAnomaly = (d: number): number => RAD * (357.5291 + 0.98560028 * d);

function eclipticLongitude(m: number): number {
  const centre = RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  return m + centre + RAD * 102.9372 + Math.PI;
}

const transit = (ds: number, m: number, l: number): number =>
  J2000 + ds + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * l);

/** Sun times for a calendar date (YYYY-MM-DD) at a place. */
export function sunTimes(date: string, lat: number, lng: number): SunTimes {
  const lw = -lng * RAD;
  const phi = lat * RAD;
  const localNoon = Date.parse(`${date}T12:00:00Z`) - (lng / 15) * 3_600_000;
  const cycle = Math.round(toDays(localNoon) - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + cycle;
  const m = meanAnomaly(ds);
  const l = eclipticLongitude(m);
  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(l));
  const noon = transit(ds, m, l);

  const crossing = (altitude: number): [rise: number | null, set: number | null] => {
    const cos = (Math.sin(altitude * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
    if (cos < -1 || cos > 1) return [null, null];
    const set = transit(J0 + (Math.acos(cos) + lw) / (2 * Math.PI) + cycle, m, l);
    return [fromJulian(noon - (set - noon)), fromJulian(set)];
  };
  const [sunrise, sunset] = crossing(SUNRISE_ALTITUDE);
  const [dawn, dusk] = crossing(CIVIL_ALTITUDE);
  return { dawn, sunrise, noon: fromJulian(noon), sunset, dusk };
}

/** Sun altitude in degrees at an instant, for checks. */
export function sunAltitude(instant: number, lat: number, lng: number): number {
  const d = toDays(instant);
  const m = meanAnomaly(d);
  const l = eclipticLongitude(m);
  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(l));
  const ra = Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY), Math.cos(l));
  const sidereal = RAD * (280.16 + 360.9856235 * d) + lng * RAD;
  const hourAngle = sidereal - ra;
  const phi = lat * RAD;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle)) / RAD;
}
