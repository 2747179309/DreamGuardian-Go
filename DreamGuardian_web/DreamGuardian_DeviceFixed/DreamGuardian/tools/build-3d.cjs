const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
esbuild.buildSync({
  entryPoints: [path.join(root, 'static', 'scene3d.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  outfile: path.join(root, 'static', 'scene3d.bundle.js')
});
