// Approximate Total Area Coverage (TAC) check for PDF pages.
//
// LIMITATION: pdf.js renders to sRGB only. For PDFs whose source content is
// already CMYK (most professional print files), the source CMYK values get
// flattened to RGB before we see them, and our reverse sRGB → CMYK can
// never recover the original ink levels. A 400 % rich-black region in the
// source becomes RGB(0,0,0) → naïve reverse → only 100 % TAC. So the numbers
// here under-report real CMYK source coverage. The check is best read as a
// *relative* density map, not an absolute press verdict.
//
// What it IS good at: spotting RGB content rendered into the PDF, finding
// the densest regions of a page (visually, via the heatmap), and flagging
// over-inking for RGB-source PDFs.

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

export interface PageInkResult {
  page: number;
  width: number;
  height: number;
  maxTac: number; // 0–400
  avgTac: number; // 0–400 (paper-white pixels excluded from average)
  pctOver280: number;
  pctOver320: number;
  heatmapUrl?: string;
}

export interface InkCoverageReport {
  pages: PageInkResult[];
  worst: PageInkResult | null;
  scanned: number;
  total: number;
  tacLimit: number;
}

interface Options {
  dpi?: number;
  tacLimit?: number;
  maxPages?: number;
}

export async function analyseInkCoverage(
  pdf: PDFDocumentProxy,
  options: Options = {},
): Promise<InkCoverageReport> {
  const dpi = options.dpi ?? 120;
  const tacLimit = options.tacLimit ?? 300;
  const maxPages = Math.min(options.maxPages ?? 5, pdf.numPages);

  const pages: PageInkResult[] = [];

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    try {
      const result = await analysePage(page, i, dpi, tacLimit);
      pages.push(result);
    } catch (e) {
      console.warn('ink-coverage page failed', i, e);
    } finally {
      page.cleanup();
    }
  }

  const worst =
    pages.length === 0
      ? null
      : pages.reduce((acc, p) => (p.maxTac > acc.maxTac ? p : acc), pages[0]);

  return {
    pages,
    worst,
    scanned: pages.length,
    total: pdf.numPages,
    tacLimit,
  };
}

async function analysePage(
  page: PDFPageProxy,
  pageNum: number,
  dpi: number,
  tacLimit: number,
): Promise<PageInkResult> {
  const viewport = page.getViewport({ scale: dpi / 72 });
  const w = Math.max(1, Math.ceil(viewport.width));
  const h = Math.max(1, Math.ceil(viewport.height));

  // Rendered page (sRGB)
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = w;
  baseCanvas.height = h;
  const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
  if (!baseCtx) throw new Error('Canvas 2D unavailable');
  baseCtx.fillStyle = '#ffffff';
  baseCtx.fillRect(0, 0, w, h);
  await page.render({ canvasContext: baseCtx, viewport }).promise;

  const imgData = baseCtx.getImageData(0, 0, w, h);
  const src = imgData.data;
  const total = w * h;

  let sumTac = 0;
  let inkPixels = 0;
  let maxTac = 0;
  let countOver280 = 0;
  let countOver320 = 0;

  // Heat layer: pre-multiplied red overlay with alpha proportional to TAC.
  // We composite this on top of the rendered page later, so users see *where*
  // ink is heavy rather than just over-limit binary spots.
  const heat = new Uint8ClampedArray(src.length);

  for (let i = 0; i < src.length; i += 4) {
    const r = src[i] / 255;
    const g = src[i + 1] / 255;
    const b = src[i + 2] / 255;

    let c = 0;
    let m = 0;
    let y = 0;
    let k = 1 - Math.max(r, g, b);
    if (k >= 1) {
      c = m = y = 0;
      k = 1;
    } else {
      const inv = 1 - k;
      c = (1 - r - k) / inv;
      m = (1 - g - k) / inv;
      y = (1 - b - k) / inv;
    }

    const tac = (c + m + y + k) * 100;

    // Skip near-paper-white pixels so the average reflects inked area only.
    if (tac > 5) {
      sumTac += tac;
      inkPixels++;
    }
    if (tac > maxTac) maxTac = tac;
    if (tac > 280) countOver280++;
    if (tac > 320) countOver320++;

    // Heat colour: cool (blue) at low coverage → warm (yellow) at mid →
    // hot (red) at high. Alpha rises with TAC so paper barely shows tint.
    if (tac > 5) {
      const t = Math.min(1, tac / 400); // 0..1 across full TAC range
      let hr: number;
      let hg: number;
      let hb: number;
      if (t < 0.5) {
        // Blue (0,80,255) → Yellow (255,220,0)
        const u = t / 0.5;
        hr = Math.round(0 + u * 255);
        hg = Math.round(80 + u * 140);
        hb = Math.round(255 - u * 255);
      } else {
        // Yellow → Red (220,30,30)
        const u = (t - 0.5) / 0.5;
        hr = Math.round(255 - u * 35);
        hg = Math.round(220 - u * 190);
        hb = Math.round(0 + u * 30);
      }
      // Boost alpha hard around the limit so violations stand out
      const alphaScale =
        tac > tacLimit ? 0.85 : tac > tacLimit - 60 ? 0.6 : 0.45;
      heat[i] = hr;
      heat[i + 1] = hg;
      heat[i + 2] = hb;
      heat[i + 3] = Math.round(alphaScale * 220 * Math.min(1, tac / 100));
    }
  }

  // Composite: page (slightly faded) + heat overlay
  const compCanvas = document.createElement('canvas');
  compCanvas.width = w;
  compCanvas.height = h;
  const compCtx = compCanvas.getContext('2d');
  if (!compCtx) throw new Error('Canvas 2D unavailable');
  // Fade the rendered page so the heat reads cleanly
  compCtx.globalAlpha = 0.55;
  compCtx.drawImage(baseCanvas, 0, 0);
  compCtx.globalAlpha = 1;

  const heatCanvas = document.createElement('canvas');
  heatCanvas.width = w;
  heatCanvas.height = h;
  const heatCtx = heatCanvas.getContext('2d');
  if (heatCtx) {
    heatCtx.putImageData(new ImageData(heat, w, h), 0, 0);
    compCtx.drawImage(heatCanvas, 0, 0);
  }

  const thumb = downsample(compCanvas, 360);
  const heatmapUrl = await canvasToBlobUrl(thumb);

  return {
    page: pageNum,
    width: w,
    height: h,
    maxTac,
    avgTac: inkPixels > 0 ? sumTac / inkPixels : 0,
    pctOver280: (countOver280 / total) * 100,
    pctOver320: (countOver320 / total) * 100,
    heatmapUrl,
  };
}

function downsample(src: HTMLCanvasElement, maxW: number): HTMLCanvasElement {
  if (src.width <= maxW) return src;
  const scale = maxW / src.width;
  const out = document.createElement('canvas');
  out.width = Math.round(src.width * scale);
  out.height = Math.round(src.height * scale);
  const ctx = out.getContext('2d');
  if (!ctx) return src;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

function canvasToBlobUrl(canvas: HTMLCanvasElement): Promise<string | undefined> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob ? URL.createObjectURL(blob) : undefined);
    }, 'image/png');
  });
}
