// Press-grade Total Area Coverage via MuPDF.
//
// Unlike the pdf.js-based analyser (which can only see the post-render sRGB
// image), MuPDF renders each page directly into a CMYK pixmap using its own
// colour engine. Per-pixel TAC is therefore the *real* sum of C + M + Y + K,
// not a reverse-engineered approximation.

import type { PageInkResult, InkCoverageReport } from './pdfInkCoverage';

interface Options {
  dpi?: number;
  tacLimit?: number;
  maxPages?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mupdfPromise: Promise<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMupdf(): Promise<any> {
  if (!mupdfPromise) {
    mupdfPromise = import('mupdf');
  }
  return mupdfPromise;
}

export async function analyseInkCoverageMupdf(
  buffer: ArrayBuffer,
  options: Options = {},
): Promise<InkCoverageReport> {
  const dpi = options.dpi ?? 120;
  const tacLimit = options.tacLimit ?? 300;
  const mupdf = await getMupdf();

  const doc = mupdf.Document.openDocument(new Uint8Array(buffer), 'application/pdf');
  const totalPages: number = doc.countPages();
  const maxPages = Math.min(options.maxPages ?? 5, totalPages);
  const pages: PageInkResult[] = [];

  const cmykSpace = mupdf.ColorSpace.DeviceCMYK;
  const matrix = mupdf.Matrix.scale(dpi / 72, dpi / 72);

  for (let i = 0; i < maxPages; i++) {
    let page = null;
    let cmykPixmap = null;
    let rgbPixmap = null;
    try {
      page = doc.loadPage(i);
      cmykPixmap = page.toPixmap(matrix, cmykSpace, false);
      const w = cmykPixmap.getWidth();
      const h = cmykPixmap.getHeight();
      const n = cmykPixmap.getNumberOfComponents();
      const samples: Uint8ClampedArray = cmykPixmap.getPixels();

      // For the heatmap base, render the same page as RGB at the same matrix
      rgbPixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
      const rgbPng: Uint8Array = rgbPixmap.asPNG();
      const rgbBlob = new Blob([rgbPng], { type: 'image/png' });
      const rgbUrl = URL.createObjectURL(rgbBlob);

      const result = analyseSamples(samples, w, h, n, i + 1, tacLimit);
      const heatmapUrl = await composeHeatmap(rgbUrl, samples, w, h, n, tacLimit);
      URL.revokeObjectURL(rgbUrl);

      pages.push({ ...result, heatmapUrl });
    } catch (e) {
      console.warn('mupdf page failed', i + 1, e);
    } finally {
      try {
        cmykPixmap?.destroy?.();
      } catch {
        /* ignore */
      }
      try {
        rgbPixmap?.destroy?.();
      } catch {
        /* ignore */
      }
      try {
        page?.destroy?.();
      } catch {
        /* ignore */
      }
    }
  }
  try {
    doc.destroy?.();
  } catch {
    /* ignore */
  }

  const worst =
    pages.length === 0
      ? null
      : pages.reduce((acc, p) => (p.maxTac > acc.maxTac ? p : acc), pages[0]);

  return { pages, worst, scanned: pages.length, total: totalPages, tacLimit };
}

function analyseSamples(
  samples: Uint8ClampedArray,
  w: number,
  h: number,
  n: number,
  pageNum: number,
  _tacLimit: number,
): Omit<PageInkResult, 'heatmapUrl'> {
  const total = w * h;
  let sumTac = 0;
  let inkPixels = 0;
  let maxTac = 0;
  let countOver280 = 0;
  let countOver320 = 0;

  for (let i = 0; i < samples.length; i += n) {
    // CMYK pixmap layout: bytes are C, M, Y, K (each 0–255). Some MuPDF
    // builds may include alpha or extra channels — n tells us the stride.
    const c = samples[i];
    const m = samples[i + 1];
    const y = samples[i + 2];
    const k = samples[i + 3];
    const tacPercent = ((c + m + y + k) / 255) * 100; // 0–400

    if (tacPercent > 5) {
      sumTac += tacPercent;
      inkPixels++;
    }
    if (tacPercent > maxTac) maxTac = tacPercent;
    if (tacPercent > 280) countOver280++;
    if (tacPercent > 320) countOver320++;
  }

  return {
    page: pageNum,
    width: w,
    height: h,
    maxTac,
    avgTac: inkPixels > 0 ? sumTac / inkPixels : 0,
    pctOver280: (countOver280 / total) * 100,
    pctOver320: (countOver320 / total) * 100,
  };
}

async function composeHeatmap(
  baseUrl: string,
  samples: Uint8ClampedArray,
  w: number,
  h: number,
  n: number,
  tacLimit: number,
): Promise<string | undefined> {
  const heat = new Uint8ClampedArray(w * h * 4);

  for (let p = 0; p < w * h; p++) {
    const off = p * n;
    const c = samples[off];
    const m = samples[off + 1];
    const y = samples[off + 2];
    const k = samples[off + 3];
    const tac = ((c + m + y + k) / 255) * 100;

    const o = p * 4;
    if (tac > 5) {
      const t = Math.min(1, tac / 400);
      let hr: number;
      let hg: number;
      let hb: number;
      if (t < 0.5) {
        const u = t / 0.5;
        hr = Math.round(0 + u * 255);
        hg = Math.round(80 + u * 140);
        hb = Math.round(255 - u * 255);
      } else {
        const u = (t - 0.5) / 0.5;
        hr = Math.round(255 - u * 35);
        hg = Math.round(220 - u * 190);
        hb = Math.round(0 + u * 30);
      }
      const alphaScale = tac > tacLimit ? 0.85 : tac > tacLimit - 60 ? 0.6 : 0.4;
      heat[o] = hr;
      heat[o + 1] = hg;
      heat[o + 2] = hb;
      heat[o + 3] = Math.round(alphaScale * 220 * Math.min(1, tac / 100));
    }
  }

  const baseImg = await loadImage(baseUrl);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.globalAlpha = 0.55;
  ctx.drawImage(baseImg, 0, 0, w, h);
  ctx.globalAlpha = 1;

  const heatCanvas = document.createElement('canvas');
  heatCanvas.width = w;
  heatCanvas.height = h;
  const heatCtx = heatCanvas.getContext('2d');
  if (heatCtx) {
    heatCtx.putImageData(new ImageData(heat, w, h), 0, 0);
    ctx.drawImage(heatCanvas, 0, 0);
  }

  const thumb = downsample(canvas, 360);
  return canvasToBlobUrl(thumb);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
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
