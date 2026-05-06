# Artwork Preflight

Browser-based preflight checker for incoming PDF and image artwork. Drop a file
and it reports colour space, fonts, page boxes, bleed, effective image DPI,
spot colours, ICC profile, and per-pixel CMYK ink coverage with a heatmap.

Runs entirely in the browser — no upload, no server, no account.

## Engines

- **[MuPDF](https://mupdf.com)** (AGPL-3.0) — press-grade CMYK rendering for
  ink coverage analysis.
- **[pdf.js](https://mozilla.github.io/pdf.js/)** (Apache-2.0) — page preview,
  resource walk, font detection, fallback rendering.
- **[wasm-vips](https://github.com/kleisauke/wasm-vips)** (MIT) — raster image
  decoding, including CMYK JPEGs and 16-bit TIFFs, plus ICC profile reading.
- **[exifr](https://github.com/MikeKovarik/exifr)** (MIT) — EXIF / IPTC / XMP
  metadata extraction.

## Licence

This project is licensed under the **GNU Affero General Public License v3.0
or later** (AGPL-3.0-or-later). See [`LICENSE`](./LICENSE) for the full text.

The AGPL applies because MuPDF is AGPL. If you host this tool on a public
network, AGPL §13 requires you to offer source to your users. The hosted UI
links to this repository in its footer:

<https://github.com/creativar/artwork-preflight>

## Develop

```bash
npm install
npm run dev
```

Open <http://localhost:5173/>.

## Deploy

Any static host works, but the page MUST be served with these headers so
SharedArrayBuffer is available (wasm-vips and MuPDF need it):

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```
