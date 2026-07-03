import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// envDir: ".." so Vite reads the single root .env for VITE_* variables.
export default defineConfig({
  plugins: [react()],
  envDir: "..",
  server: { port: 5173 },
});
