// Match a PDF page's trim (or media) box against known print sizes.
// All values are in millimetres. Tolerance ±2 mm covers minor rounding,
// imposition slop, and metric/imperial conversion drift.

export interface KnownSize {
  name: string;
  wMm: number;
  hMm: number;
}

const SIZES: KnownSize[] = [
  // ISO A series
  { name: 'A3', wMm: 297, hMm: 420 },
  { name: 'A4', wMm: 210, hMm: 297 },
  { name: 'A5', wMm: 148, hMm: 210 },
  { name: 'A6', wMm: 105, hMm: 148 },
  { name: 'A7', wMm: 74, hMm: 105 },
  // ISO B
  { name: 'B5', wMm: 176, hMm: 250 },
  // ISO C / DL
  { name: 'DL', wMm: 99, hMm: 210 },
  { name: 'C5', wMm: 162, hMm: 229 },
  { name: 'C6', wMm: 114, hMm: 162 },
  // US sizes
  { name: 'US Letter', wMm: 215.9, hMm: 279.4 },
  { name: 'US Legal', wMm: 215.9, hMm: 355.6 },
  { name: 'US Half Letter', wMm: 139.7, hMm: 215.9 },
  { name: 'US Tabloid (11×17)', wMm: 279.4, hMm: 431.8 },
  // Postcards
  { name: 'Postcard 4×6', wMm: 101.6, hMm: 152.4 },
  { name: 'Postcard 5×7', wMm: 127, hMm: 177.8 },
  { name: 'Postcard 5.5×8.5', wMm: 139.7, hMm: 215.9 },
  { name: 'Postcard 6×9', wMm: 152.4, hMm: 228.6 },
  { name: 'Postcard 6×11', wMm: 152.4, hMm: 279.4 },
  // EDDM
  { name: 'EDDM 6.5×9', wMm: 165.1, hMm: 228.6 },
  { name: 'EDDM 6.25×11', wMm: 158.75, hMm: 279.4 },
  { name: 'EDDM 6×11', wMm: 152.4, hMm: 279.4 },
  // Business cards
  { name: 'Business card (US)', wMm: 88.9, hMm: 50.8 },
  { name: 'Business card (EU)', wMm: 85, hMm: 55 },
];

const TOLERANCE_MM = 2;

export function matchPageSize(wMm: number, hMm: number): KnownSize | null {
  const within = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE_MM;
  for (const size of SIZES) {
    if (
      (within(wMm, size.wMm) && within(hMm, size.hMm)) ||
      (within(wMm, size.hMm) && within(hMm, size.wMm))
    ) {
      return size;
    }
  }
  return null;
}
