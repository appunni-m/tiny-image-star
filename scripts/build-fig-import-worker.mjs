import { build } from 'esbuild';

await build({
  entryPoints: ['src/workers/fig-import.worker.js'],
  outfile: 'src/workers/fig-import-worker.bundle.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  legalComments: 'eof',
  sourcemap: false,
  minify: true,
  metafile: false
});
