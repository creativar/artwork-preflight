import type { PreflightReport, CheckRow } from '../types';

export type Verdict = 'pass' | 'review' | 'fail';

export interface VerdictResult {
  verdict: Verdict;
  blockers: { section: string; row: CheckRow }[];
  warnings: { section: string; row: CheckRow }[];
}

export function computeVerdict(report: PreflightReport): VerdictResult {
  const blockers: { section: string; row: CheckRow }[] = [];
  const warnings: { section: string; row: CheckRow }[] = [];

  for (const section of report.sections) {
    for (const row of section.rows) {
      if (row.status === 'fail') {
        blockers.push({ section: section.title, row });
      } else if (row.status === 'warn') {
        warnings.push({ section: section.title, row });
      }
    }
  }

  const verdict: Verdict = blockers.length > 0 ? 'fail' : warnings.length > 0 ? 'review' : 'pass';
  return { verdict, blockers, warnings };
}

export function verdictHeadline(v: Verdict): string {
  switch (v) {
    case 'pass':
      return 'Print-ready';
    case 'review':
      return 'Needs review before print';
    case 'fail':
      return 'NOT suitable for print';
  }
}

export function verdictSubline(v: Verdict): string {
  switch (v) {
    case 'pass':
      return 'All checks passed. Safe to send to press.';
    case 'review':
      return 'No blocking issues, but flagged items should be confirmed with the print spec.';
    case 'fail':
      return 'Blocking issues detected. Fix before submitting to press.';
  }
}
