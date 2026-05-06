import { useEffect, useRef, useState } from 'react';

interface Props {
  buffer: ArrayBuffer;
  pageCount: number;
  onClear?: () => void;
}

interface Channels {
  c: boolean;
  m: boolean;
  y: boolean;
  k: boolean;
}

const ALL_ON: Channels = { c: true, m: true, y: true, k: true };

interface CachedPage {
  width: number;
  height: number;
  samples: Uint8ClampedArray;
  components: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mupdfPromise: Promise<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMupdf(): Promise<any> {
  if (!mupdfPromise) mupdfPromise = import('mupdf');
  return mupdfPromise;
}

export function PdfSeparationsPreview({ buffer, pageCount, onClear }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<Map<number, CachedPage>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docRef = useRef<any>(null);
  const [page, setPage] = useState(1);
  const [channels, setChannels] = useState<Channels>(ALL_ON);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Open the document once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const mupdf = await getMupdf();
        if (cancelled) return;
        const doc = mupdf.Document.openDocument(new Uint8Array(buffer.slice(0)), 'application/pdf');
        docRef.current = doc;
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      try {
        docRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      docRef.current = null;
      cacheRef.current.clear();
    };
  }, [buffer]);

  // Render page when page or channels change
  useEffect(() => {
    if (loading || !docRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const cached = await ensurePage(docRef.current, page, cacheRef.current, containerRef.current);
        if (cancelled) return;
        renderToCanvas(cached, channels, canvasRef.current);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, channels, loading]);

  const toggle = (key: keyof Channels) =>
    setChannels((prev) => ({ ...prev, [key]: !prev[key] }));
  const allOn = channels.c && channels.m && channels.y && channels.k;

  return (
    <div className="preview pdf-preview" ref={containerRef}>
      <div className="seps__bar">
        <div className="seps__plates">
          <PlateButton label="C" colour="#00aeef" active={channels.c} onClick={() => toggle('c')} />
          <PlateButton label="M" colour="#ec008c" active={channels.m} onClick={() => toggle('m')} />
          <PlateButton label="Y" colour="#ffd400" active={channels.y} onClick={() => toggle('y')} />
          <PlateButton label="K" colour="#1a1a1a" active={channels.k} onClick={() => toggle('k')} />
          <button
            type="button"
            className="seps__reset"
            onClick={() => setChannels(ALL_ON)}
            disabled={allOn}
            title="Show all plates"
          >
            All
          </button>
          {onClear && (
            <button
              type="button"
              className="seps__clear"
              onClick={onClear}
              title="Clear and analyse a different file"
            >
              Clear
            </button>
          )}
        </div>
        {pageCount > 1 && (
          <div className="seps__pager">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
              ‹
            </button>
            <span>
              {page} / {pageCount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page === pageCount}
            >
              ›
            </button>
          </div>
        )}
      </div>
      {loading && <div className="preview__error">Loading page…</div>}
      {error && <div className="preview__error">{error}</div>}
      <canvas ref={canvasRef} />
    </div>
  );
}

interface PlateProps {
  label: string;
  colour: string;
  active: boolean;
  onClick: () => void;
}

function PlateButton({ label, colour, active, onClick }: PlateProps) {
  return (
    <button
      type="button"
      className={`plate ${active ? 'plate--on' : 'plate--off'}`}
      onClick={onClick}
      aria-pressed={active}
      title={`Toggle ${label} plate`}
    >
      <span className="plate__swatch" style={{ background: active ? colour : 'transparent', borderColor: colour }} />
      {label}
    </button>
  );
}

async function ensurePage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  pageNum: number,
  cache: Map<number, CachedPage>,
  container: HTMLDivElement | null,
): Promise<CachedPage> {
  const existing = cache.get(pageNum);
  if (existing) return existing;

  const mupdf = await getMupdf();
  // Render at a scale that fits the container reasonably (cap ~1500 px wide)
  const containerW = container?.clientWidth ?? 800;
  // Probe page size via getBounds
  const probePage = doc.loadPage(pageNum - 1);
  let scale = 2;
  try {
    const bounds = probePage.getBounds('CropBox');
    const widthPt = bounds[2] - bounds[0];
    const desiredWidth = Math.min(1500, Math.max(600, containerW * 2));
    scale = desiredWidth / widthPt;
  } catch {
    /* fall back */
  }
  const matrix = mupdf.Matrix.scale(scale, scale);
  const pixmap = probePage.toPixmap(matrix, mupdf.ColorSpace.DeviceCMYK, false);
  // CRITICAL: copy the pixel samples BEFORE destroying the pixmap.
  // pixmap.getPixels() returns a view into wasm heap memory; once the pixmap
  // is destroyed (or the next page's pixmap is allocated), that heap region
  // may be reused and the cached view shows the wrong data.
  const cached: CachedPage = {
    width: pixmap.getWidth(),
    height: pixmap.getHeight(),
    samples: new Uint8ClampedArray(pixmap.getPixels()),
    components: pixmap.getNumberOfComponents(),
  };
  pixmap.destroy?.();
  probePage.destroy?.();
  cache.set(pageNum, cached);
  return cached;
}

function renderToCanvas(
  page: CachedPage,
  channels: Channels,
  canvas: HTMLCanvasElement | null,
): void {
  if (!canvas) return;
  const { width, height, samples, components } = page;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const rgba = new Uint8ClampedArray(width * height * 4);
  const total = width * height;
  for (let p = 0; p < total; p++) {
    const off = p * components;
    const c = channels.c ? samples[off] / 255 : 0;
    const m = channels.m ? samples[off + 1] / 255 : 0;
    const y = channels.y ? samples[off + 2] / 255 : 0;
    const k = channels.k ? samples[off + 3] / 255 : 0;
    // Standard CMYK → RGB simulation
    const r = (1 - c) * (1 - k);
    const g = (1 - m) * (1 - k);
    const b = (1 - y) * (1 - k);
    const o = p * 4;
    rgba[o] = Math.round(r * 255);
    rgba[o + 1] = Math.round(g * 255);
    rgba[o + 2] = Math.round(b * 255);
    rgba[o + 3] = 255;
  }

  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);

  // Scale display width via CSS so the canvas fits its container
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
}
