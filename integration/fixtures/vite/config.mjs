export default {
  build: {
    // SSR mode produces a single CJS bundle with full control over the filename.
    emptyOutDir: false,
    target: 'node24',
    // rolldownOptions is the Vite 6+ API; rollupOptions is deprecated.
    rolldownOptions: {
      output: {
        format: 'cjs',
        entryFileNames: 'index.js',
      },
    },
  },
};
