import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tsconfigPaths(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    host: true,
    port: 3040,
    // the app calls /api/...; Vite forwards it to the ticketing backend
    proxy: { "/api": { target: "http://localhost:8090", changeOrigin: true, secure: false } },
  },
  esbuild: { target: "esnext" },
});
