import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface Props {
  url: string;
  pageCount: number;
}

export function PdfPreview({ url, pageCount }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;

    async function render() {
      try {
        setError(null);
        const pdf = await pdfjsLib.getDocument(url).promise;
        if (cancelled) return;
        const p = await pdf.getPage(page);
        if (cancelled) return;
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const containerW = container.clientWidth - 24;
        const containerH = container.clientHeight - 24;
        const viewport1 = p.getViewport({ scale: 1 });
        const scale = Math.min(containerW / viewport1.width, containerH / viewport1.height);
        const viewport = p.getViewport({ scale });
        const dpr = window.devicePixelRatio || 1;
        canvas.width = viewport.width * dpr;
        canvas.height = viewport.height * dpr;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        renderTask = p.render({ canvasContext: ctx, viewport });
        // @ts-expect-error - render task has a promise
        await renderTask.promise;
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [url, page]);

  return (
    <div className="preview pdf-preview" ref={containerRef}>
      {pageCount > 1 && (
        <div className="pdf-preview__controls">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            ‹
          </button>
          <span>
            {page} / {pageCount}
          </span>
          <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page === pageCount}>
            ›
          </button>
        </div>
      )}
      {error && <div className="preview__error">{error}</div>}
      <canvas ref={canvasRef} />
    </div>
  );
}
