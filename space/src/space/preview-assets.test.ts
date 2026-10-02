import { describe, expect, it } from "vitest"
import { buildAssetManifest, createMemoryStorage } from "@cloudflare/worker-bundler"
import { servePreviewAssets, type PreviewAssetsDeployment } from "./preview-assets"

const INDEX = "<!doctype html><html><head><title>Panadería El Trigal</title></head><body><h1>Pan del día</h1></body></html>"
const NOT_FOUND =
  '<!doctype html><html><head><title>Página no encontrada</title></head><body><h1>Esta página no existe</h1><a href="/">Volver</a></body></html>'

function staticSite(overrides: Partial<PreviewAssetsDeployment> = {}): PreviewAssetsDeployment {
  return {
    mainModule: "",
    assets: { "/index.html": INDEX, "/404.html": NOT_FOUND, "/styles.css": "h1{}" },
    assetConfig: { html_handling: "auto-trailing-slash", not_found_handling: "404-page" },
    ...overrides,
  }
}

async function serve(dep: PreviewAssetsDeployment, path: string, accept = "*/*") {
  const request = new Request(`https://preview.example${path}`, { headers: { Accept: accept } })
  return servePreviewAssets(request, dep, async () => ({
    manifest: await buildAssetManifest(dep.assets),
    storage: createMemoryStorage(dep.assets),
  }))
}

describe("servePreviewAssets", () => {
  it("serves the landing and its assets", async () => {
    const home = await serve(staticSite(), "/", "text/html")
    expect(home?.status).toBe(200)
    expect(await home?.text()).toBe(INDEX)
    expect((await serve(staticSite(), "/styles.css"))?.status).toBe(200)
  })

  it("answers unknown URLs of a 404-page static site with 404.html and status 404", async () => {
    for (const accept of ["text/html,application/xhtml+xml", "*/*"]) {
      const response = await serve(staticSite(), "/no-existe", accept)
      expect(response?.status).toBe(404)
      expect(response?.headers.get("content-type")).toMatch(/^text\/html/)
      expect(await response?.text()).toBe(NOT_FOUND)
    }
    const nested = await serve(staticSite(), "/blog/no-existe", "text/html")
    expect(nested?.status).toBe(404)
    expect(await nested?.text()).toBe(NOT_FOUND)
  })

  it("returns a plain 404 for an assets-only site with nothing to fall back to", async () => {
    const response = await serve(staticSite({ assetConfig: {} }), "/no-existe", "text/html")
    expect(response?.status).toBe(404)
    expect(await response?.text()).toBe("Not Found")
  })

  it("hands unmatched requests of a server app to the App", async () => {
    const app = staticSite({ mainModule: "bundle.js", assetConfig: {} })
    expect(await serve(app, "/api/menu")).toBeNull()
  })
})
