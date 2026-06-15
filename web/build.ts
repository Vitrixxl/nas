/**
 * Build de production du frontend via l'API Bun.build.
 * - point d'entree HTML (Bun bundle automatiquement le script et le CSS references)
 * - Tailwind v4 via bun-plugin-tailwind
 * - minification activee (JS + CSS)
 * - publicPath "/" : les assets sont references en absolu pour fonctionner
 *   sur toutes les routes SPA (/folder/..., /files, /share/...)
 *
 * Usage : bun run build.ts
 */
import { rm } from "node:fs/promises"
import tailwind from "bun-plugin-tailwind"

const outdir = "./dist"

await rm(outdir, { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: ["./index.html"],
  outdir,
  target: "browser",
  minify: true,
  sourcemap: "none",
  publicPath: "/",
  naming: {
    entry: "[dir]/[name].[ext]",
    chunk: "assets/[name]-[hash].[ext]",
    asset: "assets/[name]-[hash].[ext]",
  },
  plugins: [tailwind],
})

if (!result.success) {
  console.error("Echec du build :")
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const total = result.outputs.reduce((sum, output) => sum + output.size, 0)
console.log(`Build OK : ${result.outputs.length} fichiers, ${(total / 1024).toFixed(1)} kB -> ${outdir}`)
