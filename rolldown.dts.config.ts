import { defineConfig } from 'rolldown';
import { dts } from 'rolldown-plugin-dts';

// TypeScript 7 no longer exposes the compiler API that tsup's bundled
// rollup-plugin-dts needs. rolldown-plugin-dts drives the native tsgo
// declaration emitter instead and bundles the result into one .d.ts.
export default defineConfig({
  input: 'src/index.ts',
  plugins: [dts({ dtsOnly: true })],
  output: { dir: 'dist', format: 'es' },
});
