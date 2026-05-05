import exifr from 'exifr';
import type { CheckRow, PreflightReport, ReportSection } from '../types';
import { getVips } from '../lib/vips';

interface JpegInfo {
  components?: number;
  bitsPerSample?: number;
  width?: number;
  height?: number;
  hasAdobeMarker?: boolean;
  adobeTransform?: number; // 0 = unknown/CMYK, 1 = YCbCr, 2 = YCCK
}

// Read the JPEG SOF (Start Of Frame) marker to determine real component count
// (3 = YCbCr/RGB, 4 = CMYK or YCCK, 1 = Greyscale) and check the Adobe APP14 marker.
function parseJpegMarkers(buf: ArrayBuffer): JpegInfo {
  const data = new DataView(buf);
  if (data.byteLength < 4 || data.getUint16(0) !== 0xffd8) return {};

  const info: JpegInfo = {};
  let offset = 2;
  while (offset < data.byteLength - 1) {
    if (data.getUint8(offset) !== 0xff) break;
    const marker = data.getUint8(offset + 1);
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS
    if (marker === 0xff) continue;
    if (offset + 2 > data.byteLength) break;
    const segLen = data.getUint16(offset);
    const isSOF =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF && offset + 7 < data.byteLength) {
      info.bitsPerSample = data.getUint8(offset + 2);
      info.height = data.getUint16(offset + 3);
      info.width = data.getUint16(offset + 5);
      info.components = data.getUint8(offset + 7);
    }
    if (marker === 0xee && offset + segLen <= data.byteLength) {
      const id = String.fromCharCode(
        data.getUint8(offset + 2),
        data.getUint8(offset + 3),
        data.getUint8(offset + 4),
        data.getUint8(offset + 5),
        data.getUint8(offset + 6),
      );
      if (id === 'Adobe' && offset + 13 <= data.byteLength) {
        info.hasAdobeMarker = true;
        info.adobeTransform = data.getUint8(offset + 13);
      }
    }
    offset += segLen;
  }
  return info;
}

// libvips interpretation -> friendly name
function interpretationLabel(interp: string, bands: number): string {
  switch (interp) {
    case 'srgb':
      return 'RGB (sRGB)';
    case 'rgb':
      return 'RGB';
    case 'rgb16':
      return 'RGB (16-bit)';
    case 'cmyk':
      return 'CMYK';
    case 'b-w':
      return 'Greyscale';
    case 'grey16':
      return 'Greyscale (16-bit)';
    case 'lab':
    case 'labq':
    case 'labs':
      return 'L*a*b*';
    case 'lch':
      return 'LCh';
    case 'xyz':
      return 'XYZ';
    case 'hsv':
      return 'HSV';
    case 'multiband':
      return `Multi-band (${bands})`;
    default:
      return `${interp} (${bands} bands)`;
  }
}

// Vips format -> bits per channel
function formatToBits(fmt: string): number {
  switch (fmt) {
    case 'uchar':
    case 'char':
      return 8;
    case 'ushort':
    case 'short':
      return 16;
    case 'uint':
    case 'int':
    case 'float':
      return 32;
    case 'double':
      return 64;
    default:
      return 0;
  }
}

interface VipsAnalysis {
  width: number;
  height: number;
  bands: number;
  bits: number;
  interpretation: string;
  colourSpaceLabel: string;
  isCmyk: boolean;
  isRgb: boolean;
  isGrey: boolean;
  xres?: number;
  yres?: number;
  iccDescription?: string;
  iccColourSpace?: string;
  hasAlpha: boolean;
  previewUrl?: string; // sRGB PNG blob URL for browsers that can't render the original
}

async function analyseWithVips(buffer: ArrayBuffer): Promise<VipsAnalysis | null> {
  try {
    const vips = await getVips();
    const u8 = new Uint8Array(buffer);
    const img = vips.Image.newFromBuffer(u8);

    const interpretation: string = img.interpretation;
    const bands: number = img.bands;
    const format: string = img.format;
    const xres: number | undefined = img.xres ? img.xres * 25.4 : undefined; // px/mm -> dpi
    const yres: number | undefined = img.yres ? img.yres * 25.4 : undefined;
    const hasAlpha: boolean = img.hasAlpha?.() ?? false;

    const isCmyk = interpretation === 'cmyk';
    const isRgb = interpretation === 'srgb' || interpretation === 'rgb' || interpretation === 'rgb16';
    const isGrey = interpretation === 'b-w' || interpretation === 'grey16';

    // ICC profile fields
    let iccDescription: string | undefined;
    let iccColourSpace: string | undefined;
    try {
      const iccBuf: Uint8Array | undefined = img.getBlob?.('icc-profile-data');
      if (iccBuf && iccBuf.length > 132) {
        // Bytes 16..20 of an ICC profile are the colour space signature ('RGB ', 'CMYK', 'GRAY', 'Lab ', etc.)
        iccColourSpace = String.fromCharCode(iccBuf[16], iccBuf[17], iccBuf[18], iccBuf[19]).trim();
        iccDescription = readIccDescription(iccBuf);
      }
    } catch {
      /* no ICC */
    }

    // Build a browser-renderable preview if the source isn't directly displayable.
    // Browsers can't decode CMYK JPEGs, 16-bit TIFFs, or anything non-RGB.
    let previewUrl: string | undefined;
    const needsConversion = !isRgb || format !== 'uchar' || interpretation === 'rgb';
    if (needsConversion) {
      try {
        let preview = img;
        if (interpretation !== 'srgb') {
          preview = preview.colourspace('srgb');
        }
        if (preview.format !== 'uchar') {
          preview = preview.cast('uchar');
        }
        const png: Uint8Array = preview.writeToBuffer('.png');
        previewUrl = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
        preview.delete?.();
      } catch (e) {
        console.warn('vips preview conversion failed', e);
      }
    }

    const result: VipsAnalysis = {
      width: img.width,
      height: img.height,
      bands,
      bits: formatToBits(format),
      interpretation,
      colourSpaceLabel: interpretationLabel(interpretation, bands),
      isCmyk,
      isRgb,
      isGrey,
      xres,
      yres,
      iccDescription,
      iccColourSpace,
      hasAlpha,
      previewUrl,
    };

    img.delete?.();
    return result;
  } catch (e) {
    console.warn('wasm-vips failed, falling back', e);
    return null;
  }
}

// Pull the human-readable description out of an ICC profile (the 'desc' tag).
function readIccDescription(icc: Uint8Array): string | undefined {
  try {
    const view = new DataView(icc.buffer, icc.byteOffset, icc.byteLength);
    const tagCount = view.getUint32(128);
    for (let i = 0; i < tagCount; i++) {
      const base = 132 + i * 12;
      if (base + 12 > icc.byteLength) break;
      const tag = String.fromCharCode(
        icc[base],
        icc[base + 1],
        icc[base + 2],
        icc[base + 3],
      );
      if (tag === 'desc') {
        const offset = view.getUint32(base + 4);
        const size = view.getUint32(base + 8);
        if (offset + size > icc.byteLength) return undefined;
        const sig = String.fromCharCode(
          icc[offset],
          icc[offset + 1],
          icc[offset + 2],
          icc[offset + 3],
        );
        if (sig === 'desc') {
          // ICC v2 'desc' type: ascii length at +8, ascii string starts at +12
          const len = view.getUint32(offset + 8);
          if (len > 1 && offset + 12 + len <= icc.byteLength) {
            return new TextDecoder().decode(icc.subarray(offset + 12, offset + 12 + len - 1));
          }
        } else if (sig === 'mluc') {
          // ICC v4 multi-localised unicode
          const recCount = view.getUint32(offset + 8);
          if (recCount > 0) {
            const recSize = view.getUint32(offset + 12);
            const strLen = view.getUint32(offset + 16 + 0 + 4);
            const strOff = view.getUint32(offset + 16 + 0 + 8);
            if (offset + strOff + strLen <= icc.byteLength && recSize >= 12) {
              const bytes = icc.subarray(offset + strOff, offset + strOff + strLen);
              return new TextDecoder('utf-16be').decode(bytes).replace(/\0+$/, '');
            }
          }
        }
        return undefined;
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

export async function analyseImage(
  file: File,
): Promise<{ report: PreflightReport; url: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const sourceUrl = URL.createObjectURL(file);

  const sections: ReportSection[] = [];

  // File info
  sections.push({
    title: 'File',
    rows: [
      { label: 'File name', value: file.name, status: 'info' },
      { label: 'MIME type', value: file.type || 'unknown', status: 'info' },
      { label: 'File size', value: formatBytes(file.size), status: 'info' },
    ],
  });

  // Run all three sources in parallel
  const [vipsResult, exifMeta, jpegInfo] = await Promise.all([
    analyseWithVips(arrayBuffer),
    exifr
      .parse(arrayBuffer, {
        icc: true,
        ihdr: true,
        jfif: true,
        tiff: true,
        exif: true,
        xmp: false,
      })
      .catch(() => null),
    Promise.resolve(
      file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name)
        ? parseJpegMarkers(arrayBuffer)
        : ({} as JpegInfo),
    ),
  ]);

  // Resolve key facts: prefer vips, then EXIF, then JPEG markers
  const width = vipsResult?.width ?? exifMeta?.ImageWidth ?? exifMeta?.PixelXDimension ?? jpegInfo.width;
  const height =
    vipsResult?.height ?? exifMeta?.ImageHeight ?? exifMeta?.PixelYDimension ?? jpegInfo.height;
  let dpi = vipsResult?.xres ?? exifMeta?.XResolution;
  const resUnit = exifMeta?.ResolutionUnit;
  if (dpi && !vipsResult?.xres && resUnit === 3) dpi = dpi * 2.54; // EXIF cm -> inch

  // Colour space resolution: vips wins when present
  let colourSpace: string;
  let isCmyk = false;
  let isRgb = false;
  if (vipsResult) {
    colourSpace = vipsResult.colourSpaceLabel;
    isCmyk = vipsResult.isCmyk;
    isRgb = vipsResult.isRgb;
  } else if (jpegInfo.components) {
    if (jpegInfo.components === 4) {
      colourSpace = jpegInfo.adobeTransform === 2 ? 'YCCK (CMYK)' : 'CMYK';
      isCmyk = true;
    } else if (jpegInfo.components === 3) {
      colourSpace = 'RGB';
      isRgb = true;
    } else if (jpegInfo.components === 1) {
      colourSpace = 'Greyscale';
    } else {
      colourSpace = 'Unknown';
    }
  } else {
    colourSpace = 'Unknown';
  }

  const bits = vipsResult?.bits || jpegInfo.bitsPerSample || (exifMeta?.BitsPerSample as number) || 0;

  // Image section
  const imgRows: CheckRow[] = [];
  imgRows.push({
    label: 'Dimensions',
    value: width && height ? `${width} × ${height} px` : '—',
    status: 'info',
  });
  if (width && height && dpi) {
    const wMm = (width / dpi) * 25.4;
    const hMm = (height / dpi) * 25.4;
    const wMm300 = (width / 300) * 25.4;
    const hMm300 = (height / 300) * 25.4;
    imgRows.push({
      label: 'Print size',
      value: `${wMm.toFixed(1)} × ${hMm.toFixed(1)} mm @ ${Math.round(dpi)} dpi`,
      status: dpi >= 300 ? 'pass' : dpi >= 200 ? 'warn' : 'fail',
      detail:
        dpi < 300
          ? `Below 300 dpi at the metadata size. Maximum print size at 300 dpi: ${wMm300.toFixed(1)} × ${hMm300.toFixed(1)} mm. Anything larger will look soft.`
          : undefined,
    });
  } else if (width && height) {
    const wMm300 = (width / 300) * 25.4;
    const hMm300 = (height / 300) * 25.4;
    imgRows.push({
      label: 'Max print size at 300 dpi',
      value: `${wMm300.toFixed(1)} × ${hMm300.toFixed(1)} mm`,
      status: 'info',
      detail: 'No DPI metadata in file. The size shown is the largest the image can print at 300 dpi.',
    });
  } else {
    imgRows.push({
      label: 'DPI',
      value: '—',
      status: 'warn',
      detail: 'No DPI metadata. DPI is meaningless without a target print size.',
    });
  }
  imgRows.push({
    label: 'Colour space',
    value: colourSpace,
    status: isCmyk ? 'pass' : isRgb ? 'fail' : 'warn',
    detail: isRgb
      ? 'RGB image — must be converted to CMYK for offset print. Bright greens, reds and blues will shift on press.'
      : isCmyk
        ? 'CMYK — appropriate for offset print.'
        : `Colour space is ${colourSpace}, not CMYK — confirm with the press before submission.`,
  });
  if (vipsResult) {
    imgRows.push({
      label: 'Channels',
      value: `${vipsResult.bands}${vipsResult.hasAlpha ? ' (with alpha)' : ''}`,
      status: 'info',
    });
  }
  imgRows.push({
    label: 'Bits / channel',
    value: bits ? String(bits) : '—',
    status: 'info',
  });
  sections.push({ title: 'Image', rows: imgRows });

  // ICC section — prefer vips's parsed bytes, fall back to exifr
  const iccDesc = vipsResult?.iccDescription ?? exifMeta?.icc?.ProfileDescription;
  const iccSpace = vipsResult?.iccColourSpace ?? exifMeta?.icc?.ColorSpaceData?.trim?.();
  const iccRows: CheckRow[] = [];
  if (iccDesc || iccSpace) {
    iccRows.push({
      label: 'ICC profile',
      value: iccDesc ?? '(present, no description)',
      status: 'pass',
    });
    if (iccSpace) {
      const expected =
        (isCmyk && /CMYK/i.test(iccSpace)) ||
        (isRgb && /RGB/i.test(iccSpace)) ||
        (vipsResult?.isGrey && /GRAY/i.test(iccSpace));
      iccRows.push({
        label: 'ICC space',
        value: iccSpace,
        status: expected ? 'pass' : 'warn',
        detail: expected ? undefined : 'ICC profile space does not match image colour space.',
      });
    }
    if (exifMeta?.icc?.RenderingIntent !== undefined) {
      iccRows.push({
        label: 'Rendering intent',
        value: String(exifMeta.icc.RenderingIntent),
        status: 'info',
      });
    }
  } else {
    iccRows.push({
      label: 'ICC profile',
      value: 'None embedded',
      status: isCmyk ? 'fail' : 'warn',
      detail: isCmyk
        ? 'CMYK image without an ICC profile — colour will be guessed by the receiver.'
        : 'No ICC profile — colour will be interpreted by the receiver.',
    });
  }
  sections.push({ title: 'Colour profile', rows: iccRows });

  // Use vips's converted preview if needed (CMYK / 16-bit / non-sRGB) so the
  // browser can actually display it; otherwise show the original file.
  const previewUrl = vipsResult?.previewUrl ?? sourceUrl;
  if (vipsResult?.previewUrl) {
    URL.revokeObjectURL(sourceUrl);
  }

  return {
    url: previewUrl,
    report: {
      fileName: file.name,
      fileSize: file.size,
      fileType: 'image',
      mimeType: file.type,
      sections,
    },
  };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
