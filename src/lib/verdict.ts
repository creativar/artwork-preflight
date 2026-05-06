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

  // Ink coverage isn't in sections — it's its own interactive component.
  // Find the worst page and roll its findings into the verdict.
  if (report.inkCoverage && report.inkCoverage.pages.length > 0) {
    const worst = report.inkCoverage.pages.reduce((acc, p) =>
      p.maxTac > acc.maxTac ? p : acc,
    );
    if (worst.maxTac > 340) {
      blockers.push({
        section: 'Ink coverage',
        row: {
          label: `Max TAC (page ${worst.page})`,
          value: `${worst.maxTac.toFixed(0)} %`,
          status: 'fail',
          detail: 'Peak ink coverage exceeds typical press limits.',
        },
      });
    } else if (worst.maxTac > 320) {
      warnings.push({
        section: 'Ink coverage',
        row: {
          label: `Max TAC (page ${worst.page})`,
          value: `${worst.maxTac.toFixed(0)} %`,
          status: 'warn',
        },
      });
    }
    if (worst.pctOver320 >= 3) {
      blockers.push({
        section: 'Ink coverage',
        row: {
          label: `Area over 320 % (page ${worst.page})`,
          value: `${worst.pctOver320.toFixed(2)} % of page`,
          status: 'fail',
          detail: 'Significant area exceeds 320 % — likely to smear or set off on press.',
        },
      });
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
