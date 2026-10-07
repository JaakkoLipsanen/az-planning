import type { Map as MapLibreMap } from 'maplibre-gl';

import { POI_CATEGORIES, type PoiCategory } from '#shared/bundle.ts';

import { CATEGORY_COLORS, DAY_HIGHLIGHT_STROKE } from '../theme.ts';

const GLYPHS: Record<PoiCategory, string> = {
  water: '<path d="M12 2.5C12 2.5 5.5 10 5.5 14.8a6.5 6.5 0 0 0 13 0C18.5 10 12 2.5 12 2.5z"/>',
  camp: '<path fill-rule="evenodd" d="M12 3.5 1.5 20.5h21L12 3.5zm0 6.2 4.1 8.3h-2.6L12 14.6 10.5 18H7.9L12 9.7z"/>',
  resupply:
    '<path fill-rule="evenodd" d="M7.5 8V6.5a4.5 4.5 0 0 1 9 0V8h3l-1 13h-13L4.5 8h3zm2 0h5V6.5a2.5 2.5 0 0 0-5 0V8z"/>',
  bike: '<g style="fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 9.5 8h4.5M9.5 8l4 8.5M14 8l1.5-3h2.5M14 8l4.5 8.5M9.5 8H7"/></g>',
  lodging:
    '<path d="M2 18.5V6h2.2v6h7.2V8.2h6.4A4.2 4.2 0 0 1 22 12.4v6.1h-2.2v-2.6H4.2v2.6H2zM5.2 11a2.3 2.3 0 1 1 4.6 0 2.3 2.3 0 0 1-4.6 0z"/>',
  info: '<path d="M10.6 6h2.8v2.8h-2.8zM10.6 10.5h2.8V18h-2.8z"/>',
};

const PIXEL_RATIO = 2;

function context(size: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return ctx;
}

function disc(ctx: CanvasRenderingContext2D, color: string, lineWidth: number): void {
  const c = ctx.canvas.width / 2;
  ctx.beginPath();
  ctx.arc(c, c, c - lineWidth / 2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
}

function loadSvg(svg: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', () => resolve(null));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

async function poiIcon(category: PoiCategory, small: boolean): Promise<ImageData> {
  const size = (small ? 20 : 27) * PIXEL_RATIO;
  const ctx = context(size);
  disc(ctx, CATEGORY_COLORS[category], small ? 3 : 4);
  const glyph = await loadSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}"><g fill="#fff">${GLYPHS[category]}</g></svg>`,
  );
  if (glyph) {
    const inner = size * 0.68;
    ctx.drawImage(glyph, (size - inner) / 2, (size - inner) / 2, inner, inner);
  }
  return ctx.getImageData(0, 0, size, size);
}

function nightIcon(): ImageData {
  const ctx = context(26 * PIXEL_RATIO);
  disc(ctx, CATEGORY_COLORS.plan, 4);
  return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function pill(stroke: string, lineWidth: number): ImageData {
  const size = 48;
  const r = 14;
  const ctx = context(size);
  ctx.beginPath();
  ctx.roundRect(2, 2, size - 4, size - 4, r);
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fill();
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

function peakIcon(): ImageData {
  const size = 9 * PIXEL_RATIO;
  const ctx = context(size);
  ctx.beginPath();
  ctx.moveTo(size / 2, 1);
  ctx.lineTo(size - 1, size - 2);
  ctx.lineTo(1, size - 2);
  ctx.closePath();
  ctx.fillStyle = '#5a4634';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

export async function addMapIcons(map: MapLibreMap): Promise<void> {
  const stretch = {
    pixelRatio: PIXEL_RATIO,
    stretchX: [[16, 32]] as [number, number][],
    stretchY: [[16, 32]] as [number, number][],
    content: [10, 10, 38, 38] as [number, number, number, number],
  };
  map.addImage('night', nightIcon(), { pixelRatio: PIXEL_RATIO });
  map.addImage('pill', pill('rgba(0,0,0,0.28)', 2), stretch);
  map.addImage('pill-selected', pill(DAY_HIGHLIGHT_STROKE, 5), stretch);
  map.addImage('peak', peakIcon(), { pixelRatio: PIXEL_RATIO });
  await Promise.all(
    POI_CATEGORIES.flatMap((category) => [
      poiIcon(category, false).then((image) =>
        map.addImage(`poi-${category}`, image, { pixelRatio: PIXEL_RATIO }),
      ),
      poiIcon(category, true).then((image) =>
        map.addImage(`poi-${category}-small`, image, { pixelRatio: PIXEL_RATIO }),
      ),
    ]),
  );
}
