import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
// Dos entradas: la app (TPV + CRM) y la web pública de entradas, que no carga el TPV
export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { app: resolve(__dirname, "index.html"), publico: resolve(__dirname, "publico.html") } } },
});
