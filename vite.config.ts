import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      configPath: "./wrangler.jsonc",
      auxiliaryWorkers: [],
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@client": path.resolve(__dirname, "./src/client"),
      "@worker": path.resolve(__dirname, "./src/worker"),
      "@shared": path.resolve(__dirname, "./src/shared"),
    },
  },
});
