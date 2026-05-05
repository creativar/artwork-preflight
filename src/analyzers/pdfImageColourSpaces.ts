// Walk each page's /Resources/XObject and read every image's /ColorSpace
// directly. This is the authoritative source for "what colour space is this
// PDF". The operator list lies because pdf.js converts ops to their RGB
// equivalents for canvas rendering.

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

export interface ImageColourSpaceTally {
  DeviceCMYK: number;
  DeviceRGB: number;
  DeviceGray: number;
  ICCBasedCMYK: number;
  ICCBasedRGB: number;
  ICCBasedGray: number;
  Indexed: number;
  Separation: number;
  DeviceN: number;
  Lab: number;
  Pattern: number;
  Other: number;
}

export function emptyTally(): ImageColourSpaceTally {
  return {
    DeviceCMYK: 0,
    DeviceRGB: 0,
    DeviceGray: 0,
    ICCBasedCMYK: 0,
    ICCBasedRGB: 0,
    ICCBasedGray: 0,
    Indexed: 0,
    Separation: 0,
    DeviceN: 0,
    Lab: 0,
    Pattern: 0,
    Other: 0,
  };
}

interface NameLike {
  name?: string;
}
interface DictLike {
  get?: (k: string) => unknown;
  getKeys?: () => string[];
}
interface StreamLike {
  dict?: DictLike;
}

function isName(v: unknown): v is NameLike {
  return !!v && typeof v === 'object' && 'name' in (v as object);
}

function getDict(v: unknown): DictLike | null {
  if (!v || typeof v !== 'object') return null;
  const stream = v as StreamLike;
  if (stream.dict && typeof stream.dict === 'object') return stream.dict;
  const dict = v as DictLike;
  if (typeof dict.get === 'function') return dict;
  return null;
}

function classifyColourSpace(cs: unknown, tally: ImageColourSpaceTally): void {
  if (!cs) {
    tally.Other++;
    return;
  }

  // Name object: /DeviceRGB, /DeviceCMYK, /DeviceGray, /Pattern
  if (isName(cs)) {
    const n = cs.name;
    if (n === 'DeviceCMYK') tally.DeviceCMYK++;
    else if (n === 'DeviceRGB') tally.DeviceRGB++;
    else if (n === 'DeviceGray') tally.DeviceGray++;
    else if (n === 'Pattern') tally.Pattern++;
    else tally.Other++;
    return;
  }

  if (typeof cs === 'string') {
    if (cs === 'DeviceCMYK') tally.DeviceCMYK++;
    else if (cs === 'DeviceRGB') tally.DeviceRGB++;
    else if (cs === 'DeviceGray') tally.DeviceGray++;
    else tally.Other++;
    return;
  }

  if (Array.isArray(cs) && cs.length > 0) {
    const head = cs[0];
    const kind = isName(head) ? head.name : typeof head === 'string' ? head : '';
    switch (kind) {
      case 'ICCBased': {
        // Second item is a stream; its dict has /N (number of components)
        const dict = getDict(cs[1]);
        const n = dict?.get?.('N');
        if (n === 4) tally.ICCBasedCMYK++;
        else if (n === 3) tally.ICCBasedRGB++;
        else if (n === 1) tally.ICCBasedGray++;
        else tally.Other++;
        return;
      }
      case 'Indexed': {
        // Recurse into the base space; many indexed images mask underlying CMYK.
        const base = cs[1];
        const before = totalCount(tally);
        classifyColourSpace(base, tally);
        // If the recursion didn't classify, count as Indexed.
        if (totalCount(tally) === before) tally.Indexed++;
        return;
      }
      case 'Separation':
        tally.Separation++;
        return;
      case 'DeviceN':
      case 'NChannel':
        tally.DeviceN++;
        return;
      case 'CalRGB':
        tally.DeviceRGB++;
        return;
      case 'CalGray':
        tally.DeviceGray++;
        return;
      case 'Lab':
        tally.Lab++;
        return;
      case 'Pattern':
        tally.Pattern++;
        return;
      default:
        tally.Other++;
        return;
    }
  }

  tally.Other++;
}

function totalCount(t: ImageColourSpaceTally): number {
  return (
    t.DeviceCMYK +
    t.DeviceRGB +
    t.DeviceGray +
    t.ICCBasedCMYK +
    t.ICCBasedRGB +
    t.ICCBasedGray +
    t.Indexed +
    t.Separation +
    t.DeviceN +
    t.Lab +
    t.Pattern +
    t.Other
  );
}

function getPageDict(page: PDFPageProxy): DictLike | null {
  const p = page as unknown as { _pageDict?: DictLike; pageDict?: DictLike };
  return p._pageDict ?? p.pageDict ?? null;
}

export async function tallyImageColourSpaces(
  pdf: PDFDocumentProxy,
  maxPages: number,
): Promise<ImageColourSpaceTally> {
  const tally = emptyTally();

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    try {
      const pageDict = getPageDict(page);
      const resources = pageDict?.get?.('Resources') as DictLike | undefined;
      const xobj = resources?.get?.('XObject') as DictLike | undefined;
      if (!xobj?.getKeys) {
        page.cleanup();
        continue;
      }
      for (const key of xobj.getKeys()) {
        const obj = xobj.get?.(key);
        const dict = getDict(obj);
        if (!dict?.get) continue;
        const subtype = dict.get('Subtype');
        const subtypeName = isName(subtype) ? subtype.name : subtype;
        if (subtypeName !== 'Image') continue;
        const cs = dict.get('ColorSpace');
        classifyColourSpace(cs, tally);
      }
    } catch {
      /* per-page failure: keep going */
    }
    page.cleanup();
  }

  return tally;
}

export function summariseTally(t: ImageColourSpaceTally): {
  total: number;
  cmyk: number;
  rgb: number;
  gray: number;
  spot: number;
  other: number;
} {
  const cmyk = t.DeviceCMYK + t.ICCBasedCMYK;
  const rgb = t.DeviceRGB + t.ICCBasedRGB;
  const gray = t.DeviceGray + t.ICCBasedGray;
  const spot = t.Separation + t.DeviceN;
  const other = t.Indexed + t.Lab + t.Pattern + t.Other;
  return { total: cmyk + rgb + gray + spot + other, cmyk, rgb, gray, spot, other };
}
