import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../src"),
    },
  },
  build: {
    outDir: "../dist/static",
    emptyOutDir: true,
    rollupOptions: {
      external: [
        "react",
        "react/jsx-runtime",
        "react-dom/client",
        "@monaco-editor/react",
        "monaco-editor",
      ],
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:3000",
        ws: true,
      },
    },
  },
});
