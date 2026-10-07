import type { SurfaceIndex, TripBundle } from '#shared/bundle.ts';

import type { DayPlan } from '../plan/dayPlan.ts';
import type { ColorMode } from '../state/tripStore.ts';
import {
  CATEGORY_COLORS,
  cssVar,
  dayColor,
  GPS_COLOR,
  SURFACE_COLORS,
  TEMPERATURE_COLORS,
} from '../theme.ts';
import type { RouteProfile } from '../trip/profile.ts';

const PADDING = { left: 44, right: 12, top: 34, bottom: 20 };

export interface ProfileColors {
  fg: string;
  muted: string;
  line: string;
  accent: string;
  paved: string;
  fontBody: string;
  fontDisplay: string;
}

export function profileColors(): ProfileColors {
  return {
    fg: cssVar('--fg'),
    muted: cssVar('--muted'),
    line: cssVar('--line'),
    accent: cssVar('--accent'),
    paved: cssVar('--profile-paved'),
    fontBody: cssVar('--font-body'),
    fontDisplay: cssVar('--font-display'),
  };
}

/** Typical daily low and high per profile sample; NaN where there is no data. */
export interface TemperatureSeries {
  tMin: Float32Array;
  tMax: Float32Array;
}

export interface ProfileScene {
  width: number;
  height: number;
  colors: ProfileColors;
  bundle: TripBundle;
  profile: RouteProfile;
  plan: DayPlan;
  colorMode: ColorMode;
  dayOfSample: Int16Array;
  selectedDay: number | null;
  hoverIndex: number | null;
  gpsKm: number | null;
  /** Draw temperatures instead of elevation. */
  temperature: TemperatureSeries | null;
}

/** Pixel mapping of one drawing: km to x, the value axis (metres or °C) to y. */
interface Frame {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  x: (km: number) => number;
  y: (value: number) => number;
  axis: [min: number, max: number, step: number];
  bandTop: number;
  bandHeight: number;
}

function niceStep(range: number, maxTicks: number): number {
  if (!(range > 0)) return 1;
  const raw = range / Math.max(1, maxTicks);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
}

function niceAxis(lo: number, hi: number): [min: number, max: number, step: number] {
  const step = niceStep(hi - lo, 5);
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step, step];
}

function finiteRange(...series: Float32Array[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) {
    for (const v of s) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return [min, max];
}

export function sampleAtX(profile: RouteProfile, x: number, width: number): number {
  const km = ((x - PADDING.left) / (width - PADDING.left - PADDING.right)) * profile.totalKm;
  return Math.max(0, Math.min(profile.length - 1, profile.indexAt('km', km)));
}

export function daysOfSamples(profile: RouteProfile, plan: DayPlan): Int16Array {
  const out = new Int16Array(profile.length);
  let d = 0;
  for (let i = 0; i < profile.length; i++) {
    while (d < plan.days.length - 1 && profile.data.km[i] > plan.days[d].endKm + 1e-6) d++;
    out[i] = plan.days[d].number;
  }
  return out;
}

function drawAxes(f: Frame, scene: ProfileScene, unit: string): void {
  const { ctx, w, h, x, y } = f;
  const [min, max, step] = f.axis;
  ctx.font = `11px ${scene.colors.fontBody}`;
  ctx.fillStyle = scene.colors.muted;
  ctx.strokeStyle = scene.colors.line;
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  for (let v = min + step; v < max; v += step) {
    ctx.beginPath();
    ctx.moveTo(PADDING.left, y(v));
    ctx.lineTo(w - PADDING.right, y(v));
    ctx.stroke();
    ctx.fillText(`${v < 0 ? '−' : ''}${Math.abs(v)} ${unit}`, PADDING.left - 4, y(v) + 4);
  }
  ctx.textAlign = 'center';
  const kmStep = niceStep(scene.profile.totalKm, Math.floor(w / 70));
  for (let k = 0; k <= scene.profile.totalKm; k += kmStep) ctx.fillText(String(Math.round(k)), x(k), h - 6);
}

function drawDayBands(f: Frame, scene: ProfileScene): void {
  if (!scene.bundle.plan) return;
  for (const day of scene.plan.days) {
    const selected = day.number === scene.selectedDay;
    if (!selected && day.number % 2 === 1) continue;
    f.ctx.fillStyle = selected ? 'rgba(255,210,31,0.32)' : 'rgba(127,127,127,0.07)';
    f.ctx.fillRect(f.x(day.startKm), f.bandTop, f.x(day.endKm) - f.x(day.startKm), f.bandHeight);
  }
}

/** A line through the finite values of a series; samples without data break it. */
function strokeSeries(
  f: Frame,
  profile: RouteProfile,
  values: ArrayLike<number>,
  color: string,
  width: number,
): void {
  const { ctx, x, y } = f;
  ctx.beginPath();
  let drawing = false;
  for (let i = 0; i < profile.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      drawing = false;
      continue;
    }
    if (drawing) ctx.lineTo(x(profile.data.km[i]), y(v));
    else ctx.moveTo(x(profile.data.km[i]), y(v));
    drawing = true;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawElevation(f: Frame, scene: ProfileScene): void {
  const { ctx, x, y } = f;
  const { profile, colorMode, dayOfSample, bundle, colors } = scene;
  const { km, ele } = profile.data;
  const floor = f.axis[0];
  const sectionColor = (s: number): string =>
    bundle.kinds[bundle.sections[s]?.kind ?? '']?.color ?? '#888888';
  const keyAt = (i: number): number =>
    colorMode === 'surface'
      ? profile.data.surface[i]
      : colorMode === 'day'
        ? dayOfSample[i]
        : profile.data.section[i];
  const colorOf = (key: number): string =>
    colorMode === 'surface'
      ? key === 2
        ? colors.paved
        : SURFACE_COLORS[key as SurfaceIndex]
      : colorMode === 'day'
        ? dayColor(key)
        : sectionColor(key);
  for (let i = 0; i < profile.length;) {
    const key = keyAt(i);
    let j = i;
    while (j + 1 < profile.length && keyAt(j + 1) === key) j++;
    const end = Math.min(j + 1, profile.length - 1);
    ctx.beginPath();
    ctx.moveTo(x(km[i]), y(floor));
    for (let q = i; q <= end; q++) ctx.lineTo(x(km[q]), y(ele[q]));
    ctx.lineTo(x(km[end]), y(floor));
    ctx.closePath();
    ctx.fillStyle = colorOf(key);
    ctx.globalAlpha = colorMode === 'surface' ? 0.7 : 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
    i = j + 1;
  }
  strokeSeries(f, profile, ele, colors.fg, 1.1);
}

function drawTemperature(f: Frame, scene: ProfileScene, series: TemperatureSeries): void {
  const { ctx, x, y } = f;
  const { profile } = scene;
  const { km } = profile.data;
  ctx.fillStyle = TEMPERATURE_COLORS.band;
  for (let i = 1; i < profile.length; i++) {
    const [a, b] = [i - 1, i];
    if (![series.tMin[a], series.tMax[a], series.tMin[b], series.tMax[b]].every(Number.isFinite)) continue;
    ctx.beginPath();
    ctx.moveTo(x(km[a]), y(series.tMax[a]));
    ctx.lineTo(x(km[b]), y(series.tMax[b]));
    ctx.lineTo(x(km[b]), y(series.tMin[b]));
    ctx.lineTo(x(km[a]), y(series.tMin[a]));
    ctx.closePath();
    ctx.fill();
  }
  if (f.axis[0] < 0 && f.axis[1] > 0) {
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = TEMPERATURE_COLORS.freezing;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PADDING.left, y(0));
    ctx.lineTo(f.w - PADDING.right, y(0));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  strokeSeries(f, profile, series.tMax, TEMPERATURE_COLORS.high, 1.4);
  strokeSeries(f, profile, series.tMin, TEMPERATURE_COLORS.low, 1.4);
}

function drawDayMarks(f: Frame, scene: ProfileScene): void {
  if (!scene.bundle.plan) return;
  const { ctx, x } = f;
  const { fg, fontDisplay } = scene.colors;
  const planColor = CATEGORY_COLORS.plan;
  ctx.fillStyle = planColor;
  for (const night of scene.plan.nights) ctx.fillRect(x(night.km) - 0.5, f.bandTop, 1, f.bandHeight);
  ctx.textAlign = 'center';
  for (const day of scene.plan.days) {
    const x0 = x(day.startKm);
    const x1 = x(day.endKm);
    if (x1 - x0 < 11) continue;
    const selected = day.number === scene.selectedDay;
    ctx.fillStyle = selected ? fg : planColor;
    ctx.font = `${selected ? '700 11px' : '600 10px'} ${fontDisplay}`;
    ctx.fillText(`${x1 - x0 > 34 ? 'D' : ''}${day.number}`, (x0 + x1) / 2, PADDING.top - 4);
  }
}

function drawCursors(f: Frame, scene: ProfileScene, valueAt: (i: number) => number): void {
  const { ctx, x, y, h } = f;
  const { profile } = scene;
  if (scene.gpsKm !== null) {
    const gx = x(scene.gpsKm);
    const value = valueAt(profile.indexAt('km', scene.gpsKm));
    ctx.strokeStyle = GPS_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gx, f.bandTop);
    ctx.lineTo(gx, h - PADDING.bottom);
    ctx.stroke();
    if (Number.isFinite(value)) {
      ctx.fillStyle = GPS_COLOR;
      ctx.beginPath();
      ctx.arc(gx, y(value), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  if (scene.hoverIndex !== null) {
    const hx = x(profile.data.km[scene.hoverIndex]);
    const value = valueAt(scene.hoverIndex);
    ctx.strokeStyle = scene.colors.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hx, PADDING.top);
    ctx.lineTo(hx, h - PADDING.bottom);
    ctx.stroke();
    if (Number.isFinite(value)) {
      ctx.fillStyle = scene.colors.accent;
      ctx.beginPath();
      ctx.arc(hx, y(value), 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawProfile(canvas: HTMLCanvasElement, scene: ProfileScene): void {
  const { profile, temperature } = scene;
  const dpr = window.devicePixelRatio || 1;
  const { width: w, height: h } = scene;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx || w === 0 || h === 0 || !(profile.totalKm > 0)) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const axis = temperature
    ? niceAxis(...finiteRange(temperature.tMin, temperature.tMax))
    : niceAxis(...profile.elevationRange());
  const [min, max] = axis;
  const f: Frame = {
    ctx,
    w,
    h,
    axis,
    x: (km) => PADDING.left + (km / profile.totalKm) * (w - PADDING.left - PADDING.right),
    y: (v) => PADDING.top + (1 - (v - min) / (max - min || 1)) * (h - PADDING.top - PADDING.bottom),
    bandTop: PADDING.top - 14,
    bandHeight: h - PADDING.top - PADDING.bottom + 14,
  };
  drawAxes(f, scene, temperature ? '°C' : 'm');
  drawDayBands(f, scene);
  if (temperature) drawTemperature(f, scene, temperature);
  else drawElevation(f, scene);
  drawDayMarks(f, scene);
  drawCursors(f, scene, (i) => (temperature ? temperature.tMax[i] : profile.data.ele[i]));
}
