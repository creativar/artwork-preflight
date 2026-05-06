import { useCallback, useState } from 'react';
import { DropZone } from './components/DropZone';
import { PdfSeparationsPreview } from './components/PdfSeparationsPreview';
import { ImagePreview } from './components/ImagePreview';
import { ReportTable } from './components/ReportTable';
import { analysePdf } from './analyzers/pdf';
import { analyseImage } from './analyzers/image';
import type { PreflightReport, PreviewSource } from './types';
import './App.css';

export default function App() {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string>('');
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [preview, setPreview] = useState<PreviewSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    setReport(null);
    setStage('Starting');
    setPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    try {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      if (isPdf) {
        const buffer = await file.arrayBuffer();
        const { report, url, pageCount } = await analysePdf(file, setStage);
        setReport(report);
        setPreview({ kind: 'pdf', url, pageCount, buffer });
      } else if (/^image\//.test(file.type) || /\.(jpe?g|png|tiff?|webp)$/i.test(file.name)) {
        const { report, url } = await analyseImage(file, setStage);
        setReport(report);
        setPreview({ kind: 'image', url });
      } else {
        setError(`Unsupported file type: ${file.type || 'unknown'}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStage('');
    }
  }, []);

  // Pre-warm mupdf when the user starts dragging — the wasm download begins
  // before they drop, so most of the load latency is hidden.
  const prewarm = useCallback(() => {
    void import('mupdf').catch(() => {});
    void import('wasm-vips').catch(() => {});
  }, []);

  return (
    <div className="app">
      <header className="app__header">
        <h1>PDF Preflight</h1>
        <div className="app__sub">Browser-based check for incoming PDF and image artwork</div>
      </header>
      <div className="app__attribution">
        Powered by <a href="https://mupdf.com" target="_blank" rel="noreferrer">MuPDF</a> (
        <a
          href="https://www.gnu.org/licenses/agpl-3.0.en.html"
          target="_blank"
          rel="noreferrer"
        >
          AGPL-3.0
        </a>
        ), <a href="https://mozilla.github.io/pdf.js/" target="_blank" rel="noreferrer">pdf.js</a>{' '}
        and <a href="https://github.com/kleisauke/wasm-vips" target="_blank" rel="noreferrer">wasm-vips</a>.
        Open source under{' '}
        <a href="https://www.gnu.org/licenses/agpl-3.0.en.html" target="_blank" rel="noreferrer">
          AGPL-3.0
        </a>
        —{' '}
        <a
          href="https://github.com/creativar/artwork-preflight"
          target="_blank"
          rel="noreferrer"
        >
          source on GitHub
        </a>
        .
      </div>
      <main className="app__main">
        <section className="app__left">
          {!preview ? (
            <DropZone onFile={handleFile} busy={busy} stage={stage} onPrewarm={prewarm} />
          ) : (
            <>
              {preview.kind === 'pdf' && preview.buffer ? (
                <PdfSeparationsPreview
                  buffer={preview.buffer}
                  pageCount={preview.pageCount ?? 1}
                  onClear={() => {
                    if (preview.url) URL.revokeObjectURL(preview.url);
                    setPreview(null);
                    setReport(null);
                    setError(null);
                  }}
                />
              ) : (
                <>
                  <ImagePreview url={preview.url} alt={report?.fileName ?? 'preview'} />
                  <button
                    className="reset"
                    onClick={() => {
                      if (preview.url) URL.revokeObjectURL(preview.url);
                      setPreview(null);
                      setReport(null);
                      setError(null);
                    }}
                  >
                    Clear
                  </button>
                </>
              )}
            </>
          )}
          {error && <div className="error">{error}</div>}
        </section>
        <aside className="app__right">
          {report ? (
            <ReportTable report={report} />
          ) : (
            <div className="placeholder">
              <p>Drop a file to see colour space, fonts, DPI, page boxes, ICC profile and more.</p>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
