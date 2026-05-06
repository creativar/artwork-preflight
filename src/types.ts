export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface CheckRow {
  label: string;
  value: string;
  status: CheckStatus;
  detail?: string;
}

export interface ReportSection {
  title: string;
  rows: CheckRow[];
  imageUrl?: string;
  imageCaption?: string;
}

export interface PreflightReport {
  fileName: string;
  fileSize: number;
  fileType: 'pdf' | 'image' | 'unknown';
  mimeType: string;
  sections: ReportSection[];
}

export interface PreviewSource {
  kind: 'pdf' | 'image';
  url: string;
  pageCount?: number;
  buffer?: ArrayBuffer;
}
