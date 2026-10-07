export function formatHours(hours: number): string {
  let h = Math.floor(hours);
  let m = Math.round((hours - h) * 60);
  if (m === 60) {
    h++;
    m = 0;
  }
  return `${h} h ${String(m).padStart(2, '0')}`;
}

export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
}

export function formatGrade(percent: number): string {
  const sign = percent > 0.05 ? '+' : percent < -0.05 ? '−' : '';
  return `${sign}${Math.abs(Math.round(percent * 10) / 10).toFixed(1)} %`;
}

/** "−3 °C", with a real minus sign. */
export function formatTemperature(celsius: number): string {
  const rounded = Math.round(celsius);
  return `${rounded < 0 ? '−' : ''}${Math.abs(rounded)} °C`;
}

/** "17–22 °C", or "−3 to 5 °C" when a minus sign would make a dash ambiguous. */
export function formatTemperatureRange(low: number, high: number): string {
  const [a, b] = [Math.round(low), Math.round(high)];
  if (a === b) return formatTemperature(a);
  return a < 0
    ? `${formatTemperature(a).replace(' °C', '')} to ${formatTemperature(b)}`
    : `${a}–${formatTemperature(b)}`;
}

export function formatInt(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Short FNV-1a hash, for cache keys that must change with a value without revealing it. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(36);
}

/** "Mt Lemmon (FR 38)" -> "Mt Lemmon": the part of a label before the first parenthesis. */
export function shortLabel(text: string): string {
  return text.split(' (')[0];
}

/** "Arizona Trail (AZT300) - Kelvin -> Hwy 77" -> "Arizona Trail": a route name without details. */
export function shortName(name: string): string {
  return name
    .split(' - ')[0]
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .trim();
}
