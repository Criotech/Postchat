import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  define: {
    global: "globalThis"
  },
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    commonjsOptions: {
      transformMixedEsModules: true
    },
    cssCodeSplit: true,
    rollupOptions: {
      input: {
        sidebar: "index.html",
        requestTab: "request-tab.html"
      },
      output: {
        entryFileNames: "[name]/[name].js",
        chunkFileNames: "[name]/chunks/[name].js",
        assetFileNames: "[name]/assets/[name][extname]"
      }
    }
  }
});
