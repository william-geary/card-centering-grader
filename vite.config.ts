import { readFileSync } from "node:fs";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

// GitHub Pages serves the site from /<repo>/; Tauri and local previews serve it
// from the root. The Pages workflow sets PAGES_BASE.
const base = process.env.PAGES_BASE ?? "./";
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true }, // the port tauri.conf.json expects
  build: { target: "es2022", sourcemap: true },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false, // registered from main.ts, and skipped inside Tauri
      includeAssets: ["favicon.svg", "apple-touch-icon.png", "samples/*.png"],
      manifest: {
        name: "Card Centering Grader",
        short_name: "Centering",
        description: "Measure trading card centering, front and back, with a grade ceiling.",
        theme_color: "#1e1f22",
        background_color: "#1e1f22",
        display: "standalone",
        orientation: "any",
        start_url: ".",
        scope: ".",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
