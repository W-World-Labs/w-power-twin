import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backend = process.env.POWER_TWIN_BACKEND ?? "http://127.0.0.1:18470";
const cargoToml = readFileSync(new URL("../server/Cargo.toml", import.meta.url), "utf8");
const release = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if (!release) throw new Error("Could not read server release from server/Cargo.toml");
let buildMode = "production";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "radar-build-metadata",
      configResolved(config) {
        buildMode = config.mode;
      },
      transformIndexHtml() {
        if (process.env.POWER_TWIN_BROWSER_TELEMETRY !== "1") return;
        for (const name of ["POWER_TWIN_RADAR_ENDPOINT", "W_RADAR_WORKSPACE_ID", "W_RADAR_PROJECT_ID"]) {
          if (!process.env[name]?.trim()) throw new Error(`Missing browser telemetry configuration: ${name}`);
        }
        const endpoint = new URL(process.env.POWER_TWIN_RADAR_ENDPOINT!);
        if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
          throw new Error("Browser telemetry requires an operator-supplied HTTP(S) endpoint without credentials");
        }
        return [{ tag: "script", attrs: {
          async: true,
          src: new URL("/platform/bootstrap.js", endpoint).href,
          referrerpolicy: "no-referrer",
          "data-workspace-id": process.env.W_RADAR_WORKSPACE_ID!,
          "data-project-id": process.env.W_RADAR_PROJECT_ID!,
          "data-client-kind": "paas-platform",
          "data-release": `w-power-twin-${release}`,
          "data-environment": buildMode,
        } }];
      },
    },
  ],
  build: { assetsDir: "static" },
  server: {
    port: 5180,
    // The credits panel imports ../data/sources.json.
    fs: { allow: [".."] },
    proxy: { "/api": backend, "/assets": backend },
  },
});
