import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { CheckRow, PreflightReport, ReportSection } from '../types';
import { matchPageSize } from '../lib/pageSizes';
import { extractImagePaints, type ImagePaint } from './pdfImageDpi';
import { analyseInkCoverage } from './pdfInkCoverage';
import { analyseInkCoverageMupdf } from './pdfInkCoverageMupdf';
import { analysePdfWithMupdf, type MupdfAnalysis } from './pdfMupdfAnalysis';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const PT_PER_MM = 2.83464567;
const fmtMm = (pt: number) => (pt / PT_PER_MM).toFixed(1) + ' mm';

interface PageBoxes {
  mediaBox?: number[];
  cropBox?: number[];
  bleedBox?: number[];
  trimBox?: number[];
  artBox?: number[];
}

function boxToSize(box?: number[]): string {
  if (!box || box.length < 4) return '—';
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  return `${fmtMm(w)} × ${fmtMm(h)}`;
}

export async function analysePdf(file: File): Promise<{
  report: PreflightReport;
  url: string;
  pageCount: number;
}> {
  const arrayBuffer = await file.arrayBuffer();
  const url = URL.createObjectURL(new Blob([arrayBuffer], { type: 'application/pdf' }));

  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
  const pdf = await loadingTask.promise;

  const sections: ReportSection[] = [];

  // --- Document info ---
  const meta = await pdf.getMetadata().catch(() => null);
  const info: Record<string, unknown> = (meta?.info ?? {}) as Record<string, unknown>;
  const docRows: CheckRow[] = [
    { label: 'Pages', value: String(pdf.numPages), status: 'info' },
    { label: 'PDF version', value: String(info.PDFFormatVersion ?? '—'), status: 'info' },
    { label: 'Producer', value: String(info.Producer ?? '—'), status: 'info' },
    { label: 'Creator', value: String(info.Creator ?? '—'), status: 'info' },
    { label: 'Title', value: String(info.Title ?? '—'), status: 'info' },
    {
      label: 'Linearised',
      value: info.IsLinearized ? 'Yes' : 'No',
      status: 'info',
    },
    {
      label: 'Encrypted',
      value: info.IsAcroFormPresent ? 'AcroForm present' : info.EncryptFilterName ? 'Yes' : 'No',
      status: info.EncryptFilterName ? 'warn' : 'info',
    },
  ];
  sections.push({ title: 'Document', rows: docRows });

  // --- Page boxes (first page) and authoritative colour-space audit
  // via MuPDF. pdf.js's private-API resource walk is unreliable on
  // real-world PDFs (silent fail on /TrimBox, image XObjects, etc.).
  let mupdfResult: MupdfAnalysis | null = null;
  try {
    mupdfResult = await analysePdfWithMupdf(arrayBuffer, { maxPages: 20 });
  } catch (e) {
    console.warn('MuPDF analysis failed, falling back to pdf.js for boxes', e);
  }

  const firstPage = await pdf.getPage(1);
  const pdfjsView = firstPage.view as number[] | undefined;
  // Prefer MuPDF's boxes; fall back to pdf.js MediaBox.
  const boxes: PageBoxes = {
    mediaBox: mupdfResult?.firstPageBoxes.mediaBox ?? pdfjsView,
    cropBox: mupdfResult?.firstPageBoxes.cropBox,
    trimBox: mupdfResult?.firstPageBoxes.trimBox,
    bleedBox: mupdfResult?.firstPageBoxes.bleedBox,
    artBox: mupdfResult?.firstPageBoxes.artBox,
  };

  const pageRows: CheckRow[] = [];

  // Page-size match: prefer trim, then media
  const sizeBox = boxes.trimBox ?? boxes.mediaBox;
  if (sizeBox) {
    const wMm = (sizeBox[2] - sizeBox[0]) / PT_PER_MM;
    const hMm = (sizeBox[3] - sizeBox[1]) / PT_PER_MM;
    const match = matchPageSize(wMm, hMm);
    pageRows.push({
      label: 'Page size',
      value: match
        ? `${match.name} (${wMm.toFixed(1)} × ${hMm.toFixed(1)} mm)`
        : `${wMm.toFixed(1)} × ${hMm.toFixed(1)} mm`,
      status: match ? 'pass' : 'info',
      detail: match
        ? undefined
        : 'Custom size — confirm with the print spec sheet.',
    });
  }

  pageRows.push(
    { label: 'MediaBox', value: boxToSize(boxes.mediaBox), status: 'info' },
    { label: 'CropBox', value: boxToSize(boxes.cropBox), status: 'info' },
    {
      label: 'TrimBox',
      value: boxToSize(boxes.trimBox),
      status: boxes.trimBox ? 'pass' : 'warn',
      detail: boxes.trimBox ? undefined : 'No TrimBox set — required for print PDF/X workflows.',
    },
    {
      label: 'BleedBox',
      value: boxToSize(boxes.bleedBox),
      status: boxes.bleedBox ? 'pass' : 'warn',
      detail: boxes.bleedBox ? undefined : 'No BleedBox set — bleed cannot be verified.',
    },
    { label: 'ArtBox', value: boxToSize(boxes.artBox), status: 'info' },
  );

  // Bleed amount, if both trim and bleed exist
  if (boxes.trimBox && boxes.bleedBox) {
    const bleedL = boxes.trimBox[0] - boxes.bleedBox[0];
    const bleedB = boxes.trimBox[1] - boxes.bleedBox[1];
    const bleedR = boxes.bleedBox[2] - boxes.trimBox[2];
    const bleedT = boxes.bleedBox[3] - boxes.trimBox[3];
    const minBleed = Math.min(bleedL, bleedR, bleedT, bleedB);
    const minMm = minBleed / PT_PER_MM;
    // 0.125" = 3.175 mm is the de-facto US print standard; 3 mm is the EU
    // standard. We pass at the higher of the two so files satisfy both.
    pageRows.push({
      label: 'Bleed (min)',
      value: minMm.toFixed(2) + ' mm',
      status: minMm >= 3.175 ? 'pass' : minMm >= 1 ? 'warn' : 'fail',
      detail:
        minMm < 3.175
          ? 'Print typically expects ≥ 3.175 mm (0.125") bleed on all sides.'
          : undefined,
    });
  }

  sections.push({ title: 'Page 1 boxes', rows: pageRows });

  // --- Fonts ---
  // pdf.js loads fonts as we render or via getOperatorList. Walk pages.
  const fontMap = new Map<string, { name: string; type: string; embedded: boolean; subset: boolean }>();
  const maxScan = Math.min(pdf.numPages, 20);
  for (let i = 1; i <= maxScan; i++) {
    const p = await pdf.getPage(i);
    try {
      await p.getOperatorList();
    } catch {
      /* ignore */
    }
    // commonObjs holds resolved font objects after operator list
    // @ts-expect-error - private API
    const commonObjs = p.commonObjs?._objs ?? {};
    for (const key of Object.keys(commonObjs)) {
      if (!key.startsWith('g_')) continue;
      const entry = commonObjs[key];
      const data = entry?.data ?? entry;
      if (!data || typeof data !== 'object') continue;
      // pdf.js font data has: name, loadedName, mimetype, isType3Font, missingFile, etc.
      const name: string | undefined = data.name ?? data.loadedName;
      if (!name) continue;
      const embedded = !data.missingFile;
      const subset = /^[A-Z]{6}\+/.test(name);
      const type = data.type ?? data.subtype ?? 'unknown';
      fontMap.set(name, { name, type, embedded, subset });
    }
    p.cleanup();
  }

  const fontRows: CheckRow[] = [];
  if (fontMap.size === 0) {
    fontRows.push({ label: 'Fonts', value: 'None detected', status: 'info' });
  } else {
    for (const f of fontMap.values()) {
      const cleanName = f.name.replace(/^[A-Z]{6}\+/, '');
      fontRows.push({
        label: cleanName,
        value: `${f.type}${f.subset ? ' (subset)' : ''}${f.embedded ? '' : ' — NOT embedded'}`,
        status: f.embedded ? 'pass' : 'fail',
        detail: f.embedded ? undefined : 'Font is not embedded — output will substitute.',
      });
    }
  }
  sections.push({
    title: `Fonts (scanned ${maxScan} of ${pdf.numPages} pages)`,
    rows: fontRows,
  });

  // --- Effective image DPI + transparency detection (still pdf.js-based) ---
  const imagePaints: ImagePaint[] = [];
  let imageCount = 0;
  let hasTransparency = false;

  for (let i = 1; i <= maxScan; i++) {
    const p = await pdf.getPage(i);
    try {
      const paints = await extractImagePaints(p, i);
      imagePaints.push(...paints);
    } catch {
      /* ignore */
    }
    try {
      const ops = await p.getOperatorList();
      const OPS = pdfjsLib.OPS;
      for (let j = 0; j < ops.fnArray.length; j++) {
        const fn = ops.fnArray[j];
        if (
          fn === OPS.paintImageXObject ||
          fn === OPS.paintInlineImageXObject ||
          fn === OPS.paintXObject
        ) {
          imageCount++;
        }
        if (fn === OPS.setGState) {
          const arr = ops.argsArray[j]?.[0];
          if (Array.isArray(arr)) {
            for (const pair of arr) {
              if (Array.isArray(pair) && (pair[0] === 'CA' || pair[0] === 'ca')) {
                if (typeof pair[1] === 'number' && pair[1] < 1) hasTransparency = true;
              }
              if (Array.isArray(pair) && pair[0] === 'SMask' && pair[1]) hasTransparency = true;
            }
          }
        }
      }
    } catch {
      /* ignore page */
    }
    p.cleanup();
  }

  // --- Authoritative colour-space verdict via MuPDF Device callback ---
  const csRows: CheckRow[] = [];
  if (mupdfResult) {
    const t = mupdfResult.tally;
    const totalOps = t.cmykOps + t.rgbOps + t.greyOps + t.spotOps + t.labOps + t.otherOps;
    const totalImgs =
      t.cmykImages + t.rgbImages + t.greyImages + t.spotImages + t.otherImages;

    // Verdict: any RGB content in a print-bound PDF gets flagged.
    const hasRgb = t.rgbOps > 0 || t.rgbImages > 0;
    const hasCmyk = t.cmykOps > 0 || t.cmykImages > 0;
    const hasOnlyCmyk = hasCmyk && !hasRgb;

    csRows.push({
      label: 'Document colour',
      value: hasRgb && hasCmyk
        ? 'Mixed CMYK + RGB'
        : hasOnlyCmyk
          ? 'CMYK'
          : hasRgb
            ? 'RGB'
            : t.greyOps + t.greyImages > 0
              ? 'Greyscale'
              : 'Unknown',
      status: hasRgb ? 'fail' : hasOnlyCmyk ? 'pass' : 'warn',
      detail: hasRgb
        ? 'RGB content present — needs conversion to CMYK before press; bright greens, reds and blues will shift.'
        : hasOnlyCmyk
          ? 'All content uses CMYK or compatible spaces.'
          : 'No CMYK content found — confirm intent for print.',
    });

    if (mupdfResult.outputIntent) {
      csRows.push({
        label: 'Output intent',
        value: mupdfResult.outputIntent,
        status: 'pass',
        detail: 'PDF/X output intent declared — receiver knows the target press condition.',
      });
    }

    if (totalOps > 0) {
      const opParts: string[] = [];
      if (t.cmykOps) opParts.push(`${t.cmykOps} CMYK`);
      if (t.rgbOps) opParts.push(`${t.rgbOps} RGB`);
      if (t.greyOps) opParts.push(`${t.greyOps} Grey`);
      if (t.spotOps) opParts.push(`${t.spotOps} Spot/DeviceN`);
      if (t.labOps) opParts.push(`${t.labOps} Lab`);
      if (t.otherOps) opParts.push(`${t.otherOps} other`);
      csRows.push({
        label: 'Vector / text ops',
        value: opParts.join(', '),
        status: t.rgbOps > 0 ? 'fail' : t.cmykOps > 0 ? 'pass' : 'info',
      });
    }

    if (totalImgs > 0) {
      const imgParts: string[] = [];
      if (t.cmykImages) imgParts.push(`${t.cmykImages} CMYK`);
      if (t.rgbImages) imgParts.push(`${t.rgbImages} RGB`);
      if (t.greyImages) imgParts.push(`${t.greyImages} Grey`);
      if (t.spotImages) imgParts.push(`${t.spotImages} Spot`);
      if (t.otherImages) imgParts.push(`${t.otherImages} other`);
      csRows.push({
        label: 'Images',
        value: imgParts.join(', '),
        status: t.rgbImages > 0 ? 'fail' : t.cmykImages > 0 ? 'pass' : 'info',
      });
    } else {
      csRows.push({ label: 'Images', value: 'None placed', status: 'info' });
    }

    if (t.spotNames.size > 0) {
      csRows.push({
        label: 'Spot colours',
        value: Array.from(t.spotNames).join(', '),
        status: 'warn',
        detail: 'Spot/separation inks detected — confirm with the press whether these should print as spot or convert to process.',
      });
    } else if (t.spotOps + t.spotImages > 0) {
      csRows.push({
        label: 'Spot colours',
        value: 'Present (unnamed)',
        status: 'warn',
      });
    } else {
      csRows.push({ label: 'Spot colours', value: 'None', status: 'info' });
    }
  } else {
    csRows.push({
      label: 'Colour audit',
      value: 'Unavailable — MuPDF engine failed to load',
      status: 'warn',
    });
  }

  // --- Effective image DPI ---
  if (imagePaints.length > 0) {
    // Group multiple paints of the same image (placed several times) and
    // report the worst-case DPI for each. Worst-case = lowest effective DPI.
    const worstByImage = new Map<string, ImagePaint>();
    for (const p of imagePaints) {
      const key = `${p.name}_${p.pixelW}x${p.pixelH}`;
      const existing = worstByImage.get(key);
      if (!existing || p.effectiveDpi < existing.effectiveDpi) {
        worstByImage.set(key, p);
      }
    }
    const dpiRows: CheckRow[] = [];
    let belowCount = 0;
    for (const p of worstByImage.values()) {
      const dpi = Math.round(p.effectiveDpi);
      const status = dpi >= 300 ? 'pass' : dpi >= 200 ? 'warn' : 'fail';
      if (dpi < 300) belowCount++;
      dpiRows.push({
        label: `${p.pixelW}×${p.pixelH} px (page ${p.page})`,
        value: `${dpi} dpi at ${(p.pointsW / PT_PER_MM).toFixed(0)}×${(p.pointsH / PT_PER_MM).toFixed(0)} mm`,
        status,
        detail:
          dpi < 200
            ? 'Well below 300 dpi — will look pixelated in print.'
            : dpi < 300
              ? 'Below 300 dpi at placed size — may look soft.'
              : undefined,
      });
    }
    if (belowCount > 0) {
      dpiRows.unshift({
        label: 'Summary',
        value: `${belowCount} of ${worstByImage.size} images below 300 dpi`,
        status: 'fail',
      });
    } else {
      dpiRows.unshift({
        label: 'Summary',
        value: `All ${worstByImage.size} images ≥ 300 dpi at placed size`,
        status: 'pass',
      });
    }
    sections.push({ title: 'Effective image DPI', rows: dpiRows });
  }

  csRows.push({
    label: 'Transparency',
    value: hasTransparency ? 'Yes' : 'No',
    status: hasTransparency ? 'warn' : 'info',
    detail: hasTransparency ? 'Transparency present — flatten for legacy print workflows.' : undefined,
  });
  sections.push({ title: 'Colour & content', rows: csRows });

  // --- Ink coverage / TAC ---
  // Primary path: MuPDF renders directly to a CMYK pixmap, giving real
  // per-pixel C/M/Y/K values (press-grade).
  // Fallback: pdf.js render + naive sRGB → CMYK reverse (under-reports).
  let inkMethod: 'mupdf' | 'pdfjs' | null = null;
  let ink: Awaited<ReturnType<typeof analyseInkCoverage>> | null = null;
  try {
    ink = await analyseInkCoverageMupdf(arrayBuffer, { dpi: 120, tacLimit: 300, maxPages: 5 });
    inkMethod = 'mupdf';
  } catch (e) {
    console.warn('mupdf ink coverage failed, falling back to pdf.js', e);
  }
  if (!ink) {
    try {
      ink = await analyseInkCoverage(pdf, { dpi: 120, tacLimit: 300, maxPages: 5 });
      inkMethod = 'pdfjs';
    } catch (e) {
      console.warn('pdf.js ink coverage failed too', e);
    }
  }
  if (ink && ink.worst) {
    const w = ink.worst;
    const isPressGrade = inkMethod === 'mupdf';
    const inkRows: CheckRow[] = [];
    inkRows.push({ label: 'Worst page', value: `Page ${w.page}`, status: 'info' });
    inkRows.push({
      label: 'Max TAC',
      value: `${w.maxTac.toFixed(0)} %`,
      status: w.maxTac <= 300 ? 'pass' : w.maxTac <= 320 ? 'warn' : 'fail',
      detail:
        w.maxTac > 320
          ? 'Ink coverage exceeds typical press limits — risk of drying issues, smearing, paper curl.'
          : w.maxTac > 300
            ? 'Above the conservative 300 % limit — confirm with the press.'
            : undefined,
    });
    inkRows.push({
      label: 'Average TAC',
      value: `${w.avgTac.toFixed(0)} %`,
      status: 'info',
    });
    inkRows.push({
      label: 'Area over 280 %',
      value: `${w.pctOver280.toFixed(2)} % of page`,
      status: w.pctOver280 < 0.1 ? 'pass' : w.pctOver280 < 1 ? 'warn' : 'fail',
    });
    inkRows.push({
      label: 'Area over 320 %',
      value: `${w.pctOver320.toFixed(2)} % of page`,
      status: w.pctOver320 < 0.05 ? 'pass' : w.pctOver320 < 0.5 ? 'warn' : 'fail',
    });
    inkRows.push({
      label: 'Method',
      value: isPressGrade ? 'MuPDF → CMYK pixmap (press-grade)' : 'pdf.js render → reverse CMYK (approx.)',
      status: isPressGrade ? 'pass' : 'warn',
      detail: isPressGrade
        ? 'Page rendered directly to a CMYK pixmap by MuPDF — values are true per-pixel C+M+Y+K from the same colour engine used by Ghostscript.'
        : 'pdf.js renders to sRGB only, so source CMYK values can\'t be recovered. Reported TAC is a LOWER BOUND — real ink coverage will be higher. (MuPDF engine failed to load.)',
    });
    sections.push({
      title: `Ink coverage (scanned ${ink.scanned} of ${ink.total} pages)`,
      rows: inkRows,
      imageUrl: w.heatmapUrl,
      imageCaption: isPressGrade
        ? `Page ${w.page} — true CMYK coverage heatmap (blue = light, yellow = mid, red = dense). Press-grade values via MuPDF.`
        : `Page ${w.page} — approximate coverage heatmap. Real CMYK source coverage will be higher.`,
    });
  }

  return {
    url,
    pageCount: pdf.numPages,
    report: {
      fileName: file.name,
      fileSize: file.size,
      fileType: 'pdf',
      mimeType: file.type || 'application/pdf',
      sections,
    },
  };
}
