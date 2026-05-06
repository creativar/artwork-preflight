import { useState } from 'react';
import type { InkCoverageData, CheckStatus } from '../types';

interface Props {
  data: InkCoverageData;
}

function statusForMaxTac(v: number): CheckStatus {
  if (v <= 320) return 'pass';
  if (v <= 340) return 'warn';
  return 'fail';
}

function statusFor280(v: number): CheckStatus {
  if (v < 5) return 'info';
  if (v < 15) return 'warn';
  return 'fail';
}

function statusFor320(v: number): CheckStatus {
  if (v < 0.5) return 'pass';
  if (v < 3) return 'warn';
  return 'fail';
}

function statusBadge(s: CheckStatus): string {
  if (s === 'pass') return '✓';
  if (s === 'warn') return '!';
  if (s === 'fail') return '✗';
  return 'i';
}

export function InkCoverageSection({ data }: Props) {
  const isPressGrade = data.method === 'mupdf';
  // Default to the worst page so the user lands where the eyeball test matters.
  const worstIndex = data.pages.reduce(
    (best, p, i, arr) => (p.maxTac > arr[best].maxTac ? i : best),
    0,
  );
  const [selectedPage, setSelectedPage] = useState<number>(
    data.pages[worstIndex]?.page ?? 1,
  );
  const current = data.pages.find((p) => p.page === selectedPage) ?? data.pages[0];
  if (!current) return null;

  return (
    <section className="report__section ink-section">
      <div className="ink-section__header">
        <h3>Ink coverage</h3>
        <div className="ink-section__sub">
          Scanned {data.scanned} of {data.total} pages
        </div>
      </div>

      {data.pages.length > 1 && (
        <div className="ink-section__pager">
          <span className="ink-section__pager-label">Page</span>
          {data.pages.map((p) => {
            const verdict = statusForMaxTac(p.maxTac);
            const isWorst = p.page === data.pages[worstIndex].page;
            return (
              <button
                key={p.page}
                type="button"
                className={`ink-pill ink-pill--${verdict} ${
                  p.page === selectedPage ? 'ink-pill--active' : ''
                }`}
                onClick={() => setSelectedPage(p.page)}
                title={`Page ${p.page} — max TAC ${p.maxTac.toFixed(0)} %${isWorst ? ' (worst)' : ''}`}
              >
                {p.page}
                {isWorst && <span className="ink-pill__star">★</span>}
              </button>
            );
          })}
        </div>
      )}

      <table>
        <tbody>
          <tr className={`row row--${statusForMaxTac(current.maxTac)}`}>
            <td className="row__label">Max TAC</td>
            <td className="row__value">
              {current.maxTac.toFixed(0)} %
              {current.maxTac > 340 && (
                <div className="row__detail">
                  Peak ink coverage exceeds typical press limits — risk of drying issues, smearing, paper curl.
                </div>
              )}
              {current.maxTac > 320 && current.maxTac <= 340 && (
                <div className="row__detail">
                  Above the conservative 320 % sheetfed limit — confirm with the press.
                </div>
              )}
            </td>
            <td className="row__status">
              <span className={`badge badge--${statusForMaxTac(current.maxTac)}`}>
                {statusBadge(statusForMaxTac(current.maxTac))}
              </span>
            </td>
          </tr>
          <tr className="row row--info">
            <td className="row__label">Average TAC</td>
            <td className="row__value">{current.avgTac.toFixed(0)} %</td>
            <td className="row__status">
              <span className="badge badge--info">i</span>
            </td>
          </tr>
          <tr className={`row row--${statusFor280(current.pctOver280)}`}>
            <td className="row__label">Area over 280 %</td>
            <td className="row__value">
              {current.pctOver280.toFixed(2)} % of page
              {current.pctOver280 >= 15 && (
                <div className="row__detail">
                  Large area in rich-ink territory — review for solid CMYK coverage that should be rich black instead.
                </div>
              )}
            </td>
            <td className="row__status">
              <span className={`badge badge--${statusFor280(current.pctOver280)}`}>
                {statusBadge(statusFor280(current.pctOver280))}
              </span>
            </td>
          </tr>
          <tr className={`row row--${statusFor320(current.pctOver320)}`}>
            <td className="row__label">Area over 320 %</td>
            <td className="row__value">
              {current.pctOver320.toFixed(2)} % of page
              {current.pctOver320 >= 3 && (
                <div className="row__detail">
                  Significant area exceeds 320 % — likely to smear or set off on press.
                </div>
              )}
              {current.pctOver320 >= 0.5 && current.pctOver320 < 3 && (
                <div className="row__detail">
                  Some area exceeds 320 % — usually drop shadows or rich black; confirm intentional.
                </div>
              )}
            </td>
            <td className="row__status">
              <span className={`badge badge--${statusFor320(current.pctOver320)}`}>
                {statusBadge(statusFor320(current.pctOver320))}
              </span>
            </td>
          </tr>
          <tr className={`row row--${isPressGrade ? 'pass' : 'warn'}`}>
            <td className="row__label">Method</td>
            <td className="row__value">
              {isPressGrade
                ? 'MuPDF → CMYK pixmap (press-grade)'
                : 'pdf.js render → reverse CMYK (approx.)'}
              <div className="row__detail">
                {isPressGrade
                  ? 'Pages rendered directly to a CMYK pixmap by MuPDF — values are true per-pixel C+M+Y+K from the same colour engine used by Ghostscript.'
                  : "pdf.js renders to sRGB only, so source CMYK values can't be recovered. Reported TAC is a LOWER BOUND — real ink coverage will be higher."}
              </div>
            </td>
            <td className="row__status">
              <span className={`badge badge--${isPressGrade ? 'pass' : 'warn'}`}>
                {statusBadge(isPressGrade ? 'pass' : 'warn')}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      {current.heatmapUrl && (
        <figure className="report__figure">
          <img src={current.heatmapUrl} alt={`Ink coverage heatmap for page ${current.page}`} />
          <figcaption>
            Page {current.page} — coverage heatmap (blue = light, yellow = mid, red = dense).{' '}
            {isPressGrade
              ? 'Press-grade values via MuPDF.'
              : 'Approximate; real CMYK coverage will be higher.'}
          </figcaption>
        </figure>
      )}
    </section>
  );
}
