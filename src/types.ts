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

export interface InkCoveragePage {
  page: number;
  width: number;
  height: number;
  maxTac: number;
  avgTac: number;
  pctOver280: number;
  pctOver320: number;
  heatmapUrl?: string;
}

export interface InkCoverageData {
  pages: InkCoveragePage[];
  scanned: number;
  total: number;
  tacLimit: number;
  method: 'mupdf' | 'pdfjs';
}

export interface PreflightReport {
  fileName: string;
  fileSize: number;
  fileType: 'pdf' | 'image' | 'unknown';
  mimeType: string;
  sections: ReportSection[];
  inkCoverage?: InkCoverageData;
}

export interface PreviewSource {
  kind: 'pdf' | 'image';
  url: string;
  pageCount?: number;
  buffer?: ArrayBuffer;
}
