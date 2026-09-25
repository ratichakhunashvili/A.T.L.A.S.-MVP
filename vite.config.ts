import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    host: true,
  },
  build: {
    target: "es2022",
    // mapbox-gl alone is ~1.9 MB minified. It is the application, not bloat,
    // and it is already isolated in its own chunk below.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // mapbox-gl is by far the heaviest dependency; keeping it in its own
        // chunk lets the shell paint while the map engine is still arriving.
        manualChunks: { mapbox: ["mapbox-gl"] },
      },
    },
  },
});
