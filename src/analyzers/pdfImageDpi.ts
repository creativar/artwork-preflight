// Walk a PDF page's operator list, tracking the current transformation matrix,
// and compute the effective DPI of every painted image XObject.
//
// PDF images are drawn into a 1×1 unit box transformed by the CTM, so the
// rendered width/height in points are the magnitudes of the column vectors.

import * as pdfjsLib from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';

export interface ImagePaint {
  name: string;
  pixelW: number;
  pixelH: number;
  pointsW: number;
  pointsH: number;
  effectiveDpi: number;
  page: number;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

// PDF cm operator: matrix multiply M' = inputMatrix × M (right-multiplied).
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

function getObjSync(objs: { has: (n: string) => boolean; get: (n: string) => unknown }, name: string): unknown {
  try {
    if (typeof objs.has === 'function' && objs.has(name)) {
      return objs.get(name);
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function extractImagePaints(page: PDFPageProxy, pageNum: number): Promise<ImagePaint[]> {
  const ops = await page.getOperatorList();
  const OPS = pdfjsLib.OPS;
  const paints: ImagePaint[] = [];

  let ctm: Matrix = [...IDENTITY];
  const stack: Matrix[] = [];

  // pdf.js stores image XObjects per page on `page.objs`.
  // For inline images, the data is the second arg of paintInlineImageXObject.
  const objs = (page as unknown as { objs: { has: (n: string) => boolean; get: (n: string) => unknown } }).objs;

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];

    if (fn === OPS.save) {
      stack.push([...ctm] as Matrix);
    } else if (fn === OPS.restore) {
      const popped = stack.pop();
      if (popped) ctm = popped;
    } else if (fn === OPS.transform) {
      const m = (args as number[]).slice(0, 6) as Matrix;
      ctm = multiply(m, ctm);
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintImageMaskXObject) {
      const name = (args as unknown[])[0] as string;
      const obj = getObjSync(objs, name) as { width?: number; height?: number; bitmap?: ImageBitmap } | null;
      if (obj && obj.width && obj.height) {
        paints.push(buildPaint(name, obj.width, obj.height, ctm, pageNum));
      }
    } else if (fn === OPS.paintInlineImageXObject) {
      const img = (args as unknown[])[0] as { width?: number; height?: number } | undefined;
      if (img && img.width && img.height) {
        paints.push(buildPaint('(inline)', img.width, img.height, ctm, pageNum));
      }
    }
  }

  return paints;
}

function buildPaint(
  name: string,
  pixelW: number,
  pixelH: number,
  ctm: Matrix,
  pageNum: number,
): ImagePaint {
  // Width vector: M·(1,0) − M·(0,0) = (a, b). Height vector: (c, d).
  const wPt = Math.hypot(ctm[0], ctm[1]);
  const hPt = Math.hypot(ctm[2], ctm[3]);
  const dpiX = wPt > 0 ? pixelW / (wPt / 72) : 0;
  const dpiY = hPt > 0 ? pixelH / (hPt / 72) : 0;
  return {
    name,
    pixelW,
    pixelH,
    pointsW: wPt,
    pointsH: hPt,
    effectiveDpi: Math.min(dpiX, dpiY),
    page: pageNum,
  };
}
