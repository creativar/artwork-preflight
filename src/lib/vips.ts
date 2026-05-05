// Lazy-loader for wasm-vips. The module is large (~5 MB+), so only fetched
// when the first raster image is dropped.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let vipsPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getVips(): Promise<any> {
  if (!vipsPromise) {
    vipsPromise = import('wasm-vips').then((m) =>
      // wasm-vips default export is a factory; call it to get the runtime.
      // Pass dynamicLibraries: [] to skip optional codecs (HEIF, JXL) we don't need yet.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (m.default as any)({
        dynamicLibraries: [],
      }),
    );
  }
  return vipsPromise;
}
