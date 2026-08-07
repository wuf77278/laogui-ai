import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  base: "/map-portfolio/",
  envPrefix: ["VITE_", "CESIUM_"],
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: "node_modules/cesium/Build/Cesium/Workers", dest: "cesium" },
        { src: "node_modules/cesium/Build/Cesium/ThirdParty", dest: "cesium" },
        { src: "node_modules/cesium/Build/Cesium/Assets", dest: "cesium" },
        { src: "node_modules/cesium/Build/Cesium/Widgets", dest: "cesium" }
      ]
    })
  ],
  define: {
    CESIUM_BASE_URL: JSON.stringify("/map-portfolio/cesium/")
  },
  test: {
    include: ["tests/unit/**/*.test.ts"]
  },
  server: { host: "127.0.0.1", port: 4178 }
});
