import type { VerdictResult } from '../lib/verdict';
import { verdictHeadline, verdictSubline } from '../lib/verdict';

interface Props {
  result: VerdictResult;
}

export function VerdictBanner({ result }: Props) {
  const { verdict, blockers, warnings } = result;
  return (
    <div className={`verdict verdict--${verdict}`}>
      <div className="verdict__headline">
        <span className="verdict__icon" aria-hidden>
          {verdict === 'pass' ? '✓' : verdict === 'review' ? '!' : '✗'}
        </span>
        <span>{verdictHeadline(verdict)}</span>
      </div>
      <div className="verdict__sub">{verdictSubline(verdict)}</div>
      {blockers.length > 0 && (
        <ul className="verdict__list verdict__list--blockers">
          {blockers.map((b, i) => (
            <li key={`b-${i}`}>
              <strong>{b.row.label}</strong> — {b.row.value}
              {b.row.detail && <span className="verdict__detail"> {b.row.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {blockers.length === 0 && warnings.length > 0 && (
        <ul className="verdict__list verdict__list--warnings">
          {warnings.slice(0, 6).map((w, i) => (
            <li key={`w-${i}`}>
              <strong>{w.row.label}</strong> — {w.row.value}
            </li>
          ))}
          {warnings.length > 6 && <li>+ {warnings.length - 6} more</li>}
        </ul>
      )}
    </div>
  );
}
