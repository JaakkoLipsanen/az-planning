import type { SurfaceIndex, TripBundle } from '#shared/bundle.ts';

import type { DayPlan } from '../plan/dayPlan.ts';
import type { ColorMode } from '../state/tripStore.ts';
import { CATEGORY_COLORS, cssVar, dayColor, GPS_COLOR, SURFACE_COLORS } from '../theme.ts';
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
}

function niceStep(range: number, maxTicks: number): number {
  if (!(range > 0)) return 1;
  const raw = range / Math.max(1, maxTicks);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
}

function elevationAxis(profile: RouteProfile): [min: number, max: number, step: number] {
  const [lo, hi] = profile.elevationRange();
  const step = niceStep(hi - lo, 5);
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step, step];
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

export function drawProfile(canvas: HTMLCanvasElement, scene: ProfileScene): void {
  const { profile, plan, colorMode, dayOfSample, bundle } = scene;
  const { km, ele } = profile.data;
  const dpr = window.devicePixelRatio || 1;
  const { width: w, height: h, colors } = scene;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx || w === 0 || h === 0 || !(profile.totalKm > 0)) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const [eMin, eMax, eStep] = elevationAxis(profile);
  const x = (value: number): number =>
    PADDING.left + (value / profile.totalKm) * (w - PADDING.left - PADDING.right);
  const y = (value: number): number =>
    PADDING.top + (1 - (value - eMin) / (eMax - eMin || 1)) * (h - PADDING.top - PADDING.bottom);
  const { fg, muted, fontBody, fontDisplay } = colors;
  const planColor = CATEGORY_COLORS.plan;
  const bandTop = PADDING.top - 14;
  const bandHeight = h - PADDING.top - PADDING.bottom + 14;

  ctx.font = `11px ${fontBody}`;
  ctx.fillStyle = muted;
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  for (let e = eMin + eStep; e < eMax; e += eStep) {
    ctx.beginPath();
    ctx.moveTo(PADDING.left, y(e));
    ctx.lineTo(w - PADDING.right, y(e));
    ctx.stroke();
    ctx.fillText(`${e} m`, PADDING.left - 4, y(e) + 4);
  }
  ctx.textAlign = 'center';
  const kmStep = niceStep(profile.totalKm, Math.floor(w / 70));
  for (let k = 0; k <= profile.totalKm; k += kmStep) ctx.fillText(String(Math.round(k)), x(k), h - 6);

  const days = bundle.plan ? plan.days : [];
  for (const day of days) {
    const selected = day.number === scene.selectedDay;
    if (!selected && day.number % 2 === 1) continue;
    ctx.fillStyle = selected ? 'rgba(255,210,31,0.32)' : 'rgba(127,127,127,0.07)';
    ctx.fillRect(x(day.startKm), bandTop, x(day.endKm) - x(day.startKm), bandHeight);
  }

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
    ctx.moveTo(x(km[i]), y(eMin));
    for (let q = i; q <= end; q++) ctx.lineTo(x(km[q]), y(ele[q]));
    ctx.lineTo(x(km[end]), y(eMin));
    ctx.closePath();
    ctx.fillStyle = colorOf(key);
    ctx.globalAlpha = colorMode === 'surface' ? 0.7 : 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
    i = j + 1;
  }

  ctx.beginPath();
  ctx.strokeStyle = fg;
  ctx.lineWidth = 1.1;
  for (let i = 0; i < profile.length; i++) {
    if (i === 0) ctx.moveTo(x(km[i]), y(ele[i]));
    else ctx.lineTo(x(km[i]), y(ele[i]));
  }
  ctx.stroke();

  ctx.fillStyle = planColor;
  for (const night of plan.nights) ctx.fillRect(x(night.km) - 0.5, bandTop, 1, bandHeight);
  for (const day of days) {
    const x0 = x(day.startKm);
    const x1 = x(day.endKm);
    if (x1 - x0 < 11) continue;
    const selected = day.number === scene.selectedDay;
    ctx.fillStyle = selected ? fg : planColor;
    ctx.font = `${selected ? '700 11px' : '600 10px'} ${fontDisplay}`;
    ctx.fillText(`${x1 - x0 > 34 ? 'D' : ''}${day.number}`, (x0 + x1) / 2, PADDING.top - 4);
  }

  if (scene.gpsKm !== null) {
    const gx = x(scene.gpsKm);
    const gy = y(profile.interpolate('km', scene.gpsKm, 'ele'));
    ctx.strokeStyle = GPS_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gx, bandTop);
    ctx.lineTo(gx, h - PADDING.bottom);
    ctx.stroke();
    ctx.fillStyle = GPS_COLOR;
    ctx.beginPath();
    ctx.arc(gx, gy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  if (scene.hoverIndex !== null) {
    const hx = x(km[scene.hoverIndex]);
    const { accent } = colors;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hx, PADDING.top);
    ctx.lineTo(hx, h - PADDING.bottom);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(hx, y(ele[scene.hoverIndex]), 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
