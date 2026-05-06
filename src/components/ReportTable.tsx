import type { PreflightReport } from '../types';
import { computeVerdict } from '../lib/verdict';
import { VerdictBanner } from './VerdictBanner';
import { InkCoverageSection } from './InkCoverageSection';

interface Props {
  report: PreflightReport;
}

export function ReportTable({ report }: Props) {
  const verdict = computeVerdict(report);
  return (
    <div className="report">
      <header className="report__header">
        <h2>{report.fileName}</h2>
        <div className="report__meta">
          {report.mimeType} · {formatBytes(report.fileSize)}
        </div>
      </header>
      <VerdictBanner result={verdict} />
      {report.sections.map((section) => (
        <section key={section.title} className="report__section">
          <h3>{section.title}</h3>
          <table>
            <tbody>
              {section.rows.map((row, i) => (
                <tr key={`${row.label}-${i}`} className={`row row--${row.status}`}>
                  <td className="row__label">{row.label}</td>
                  <td className="row__value">
                    {row.value}
                    {row.detail && <div className="row__detail">{row.detail}</div>}
                  </td>
                  <td className="row__status">
                    <span className={`badge badge--${row.status}`}>{statusLabel(row.status)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {section.imageUrl && (
            <figure className="report__figure">
              <img src={section.imageUrl} alt={section.imageCaption ?? section.title} />
              {section.imageCaption && <figcaption>{section.imageCaption}</figcaption>}
            </figure>
          )}
        </section>
      ))}
      {report.inkCoverage && <InkCoverageSection data={report.inkCoverage} />}
    </div>
  );
}

function statusLabel(s: 'pass' | 'warn' | 'fail' | 'info'): string {
  if (s === 'pass') return '✓';
  if (s === 'warn') return '!';
  if (s === 'fail') return '✗';
  return 'i';
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
