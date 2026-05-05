// Authoritative PDF analysis via MuPDF.
//
// pdf.js's operator-list and private-API resource walks are unreliable: it
// converts CMYK ops to RGB equivalents during evaluation and the page-dict
// internals shift between minor releases. MuPDF gives us:
//
//   - page.getBounds(box) — public API for MediaBox/CropBox/TrimBox/BleedBox/ArtBox
//   - A custom Device whose callbacks fire for every fill/stroke/text/image,
//     each receiving the *original* ColorSpace, untouched by any rendering
//     conversion. This is the same data that drives Acrobat's preflight.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mupdfPromise: Promise<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMupdf(): Promise<any> {
  if (!mupdfPromise) mupdfPromise = import('mupdf');
  return mupdfPromise;
}

export interface PageBoxes {
  mediaBox?: [number, number, number, number];
  cropBox?: [number, number, number, number];
  trimBox?: [number, number, number, number];
  bleedBox?: [number, number, number, number];
  artBox?: [number, number, number, number];
}

export interface ColourSpaceTally {
  cmykOps: number;
  rgbOps: number;
  greyOps: number;
  spotOps: number;
  spotNames: Set<string>;
  labOps: number;
  otherOps: number;
  cmykImages: number;
  rgbImages: number;
  greyImages: number;
  spotImages: number;
  otherImages: number;
}

export interface MupdfAnalysis {
  pageCount: number;
  firstPageBoxes: PageBoxes;
  tally: ColourSpaceTally;
  outputIntent?: string;
  scannedPages: number;
}

function emptyTally(): ColourSpaceTally {
  return {
    cmykOps: 0,
    rgbOps: 0,
    greyOps: 0,
    spotOps: 0,
    spotNames: new Set<string>(),
    labOps: 0,
    otherOps: 0,
    cmykImages: 0,
    rgbImages: 0,
    greyImages: 0,
    spotImages: 0,
    otherImages: 0,
  };
}

interface ColourSpaceLike {
  getName(): string;
  isGray?(): boolean;
  isRGB?(): boolean;
  isCMYK?(): boolean;
  isDeviceN?(): boolean;
  getNumberOfComponents(): number;
}

function classifyOp(cs: ColourSpaceLike, tally: ColourSpaceTally): void {
  if (!cs) {
    tally.otherOps++;
    return;
  }
  try {
    if (cs.isCMYK?.()) {
      tally.cmykOps++;
      return;
    }
    if (cs.isRGB?.()) {
      tally.rgbOps++;
      return;
    }
    if (cs.isGray?.()) {
      tally.greyOps++;
      return;
    }
    if (cs.isDeviceN?.()) {
      tally.spotOps++;
      try {
        const name = cs.getName();
        if (name) tally.spotNames.add(name);
      } catch {
        /* ignore */
      }
      return;
    }
  } catch {
    /* fall through */
  }
  // Distinguish Lab via component count, otherwise mark as other.
  try {
    if (cs.getNumberOfComponents() === 3 && /lab/i.test(cs.getName())) {
      tally.labOps++;
      return;
    }
  } catch {
    /* ignore */
  }
  tally.otherOps++;
}

interface ImageLike {
  getColorSpace?(): ColourSpaceLike | null;
}

function classifyImage(image: ImageLike, tally: ColourSpaceTally): void {
  let cs: ColourSpaceLike | null | undefined;
  try {
    cs = image.getColorSpace?.();
  } catch {
    cs = null;
  }
  if (!cs) {
    tally.otherImages++;
    return;
  }
  try {
    if (cs.isCMYK?.()) {
      tally.cmykImages++;
      return;
    }
    if (cs.isRGB?.()) {
      tally.rgbImages++;
      return;
    }
    if (cs.isGray?.()) {
      tally.greyImages++;
      return;
    }
    if (cs.isDeviceN?.()) {
      tally.spotImages++;
      return;
    }
  } catch {
    /* ignore */
  }
  tally.otherImages++;
}

export async function analysePdfWithMupdf(
  buffer: ArrayBuffer,
  options: { maxPages?: number } = {},
): Promise<MupdfAnalysis> {
  const mupdf = await getMupdf();
  const doc = mupdf.Document.openDocument(new Uint8Array(buffer), 'application/pdf');
  const totalPages: number = doc.countPages();
  const maxPages = Math.min(options.maxPages ?? 20, totalPages);

  const tally = emptyTally();

  // First-page boxes — they're what determines page size and bleed for most
  // print artwork (multi-page PDFs are rare in artwork submission).
  const firstPageBoxes: PageBoxes = {};
  try {
    const firstPage = doc.loadPage(0);
    for (const [key, propName] of [
      ['MediaBox', 'mediaBox'],
      ['CropBox', 'cropBox'],
      ['TrimBox', 'trimBox'],
      ['BleedBox', 'bleedBox'],
      ['ArtBox', 'artBox'],
    ] as const) {
      try {
        const r = firstPage.getBounds(key);
        if (r && r.length >= 4) {
          firstPageBoxes[propName] = [r[0], r[1], r[2], r[3]];
        }
      } catch {
        /* box not present or unsupported */
      }
    }
    firstPage.destroy?.();
  } catch (e) {
    console.warn('mupdf box read failed', e);
  }

  // Walk content of every (or scanned) page through a custom Device.
  for (let i = 0; i < maxPages; i++) {
    let page = null;
    try {
      page = doc.loadPage(i);
      const callbacks = {
        fillPath: (
          _path: unknown,
          _evenOdd: boolean,
          _ctm: unknown,
          cs: ColourSpaceLike,
        ) => classifyOp(cs, tally),
        strokePath: (
          _path: unknown,
          _stroke: unknown,
          _ctm: unknown,
          cs: ColourSpaceLike,
        ) => classifyOp(cs, tally),
        fillText: (
          _text: unknown,
          _ctm: unknown,
          cs: ColourSpaceLike,
        ) => classifyOp(cs, tally),
        strokeText: (
          _text: unknown,
          _stroke: unknown,
          _ctm: unknown,
          cs: ColourSpaceLike,
        ) => classifyOp(cs, tally),
        fillImage: (image: ImageLike) => classifyImage(image, tally),
        fillImageMask: (
          _image: unknown,
          _ctm: unknown,
          cs: ColourSpaceLike,
        ) => classifyOp(cs, tally),
      };
      const device = new mupdf.Device(callbacks);
      try {
        page.run(device, mupdf.Matrix.identity);
      } finally {
        device.destroy?.();
      }
    } catch (e) {
      console.warn('mupdf page walk failed', i + 1, e);
    } finally {
      page?.destroy?.();
    }
  }

  // Output intent — best-effort dig through trailer
  let outputIntent: string | undefined;
  try {
    const pdfDoc = doc as { getTrailer?: () => unknown };
    const trailer = pdfDoc.getTrailer?.() as
      | { get?: (k: string) => unknown }
      | undefined;
    const root = trailer?.get?.('Root') as { get?: (k: string) => unknown } | undefined;
    const intents = root?.get?.('OutputIntents') as
      | { length?: number; get?: (i: number) => unknown }
      | undefined;
    if (intents && (intents.length ?? 0) > 0) {
      const first = intents.get?.(0) as { get?: (k: string) => unknown } | undefined;
      const ident = first?.get?.('OutputConditionIdentifier');
      const cond = first?.get?.('OutputCondition');
      const idStr = stringify(ident) ?? stringify(cond);
      if (idStr) outputIntent = idStr;
    }
  } catch {
    /* ignore */
  }

  doc.destroy?.();

  return {
    pageCount: totalPages,
    firstPageBoxes,
    tally,
    outputIntent,
    scannedPages: maxPages,
  };
}

function stringify(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && 'toString' in (v as object)) {
    try {
      const s = (v as { toString: () => string }).toString();
      // PDFObject.toString can wrap names in slashes or strings in parens
      return s.replace(/^\//, '').replace(/^\((.*)\)$/, '$1');
    } catch {
      return undefined;
    }
  }
  return String(v);
}
