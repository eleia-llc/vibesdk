import { describe, expect, it, vi } from "vitest"

// esbuild-wasm cannot start inside the Workers test pool, so the bundler is
// mocked. The static-site path must not call it at all.
const createApp = vi.fn(async (opts: { assets: Record<string, string>; server?: string; assetConfig?: unknown }) => ({
  mainModule: "bundle.js",
  modules: { "bundle.js": `// bundled from ${opts.server}` },
  assets: opts.assets,
  assetConfig: opts.assetConfig,
}))
const createWorker = vi.fn()
vi.mock("@cloudflare/worker-bundler", () => ({ createApp, createWorker }))

const {
  ASSETS_ONLY_MAIN_MODULE,
  buildDeploymentFromFiles,
  isAssetsOnlyDeployment,
  resolveServerEntry,
} = await import("./deploy-engine")

const LANDING = `<!doctype html><html lang="es"><head>
<title>Arepas La Mona</title>
<meta name="description" content="Arepas a domicilio en 40 minutos">
<meta property="og:title" content="Arepas La Mona">
<meta property="og:description" content="Arepas a domicilio en 40 minutos">
<meta property="og:type" content="website">
<meta property="og:image" content="https://example.com/a.jpg">
</head><body><h1>Arepas en tu puerta</h1>
<p>${"Arepas recién hechas en budare, rellenas al momento y empacadas calientes. ".repeat(4)}</p>
</body></html>`

// The exact wrangler.json a think build wrote for a static landing
// (vibesdk-eval run arepas-glm, 2026-10-01): assets, no `main`.
const STATIC_WRANGLER = JSON.stringify({
  compatibility_date: "2025-04-01",
  assets: {
    directory: "./public",
    html_handling: "auto-trailing-slash",
    not_found_handling: "single-page-application",
  },
})

describe("buildDeploymentFromFiles: static site (no server entry)", () => {
  it("builds an assets-only deployment instead of failing to find a server entry", async () => {
    const bundle = await buildDeploymentFromFiles({
      "wrangler.json": STATIC_WRANGLER,
      "public/index.html": LANDING,
      "public/styles.css": "body { color: #222 }",
      "public/app.js": "document.documentElement.classList.add('js')",
      ".think/space.json": "{}",
    })

    expect(isAssetsOnlyDeployment(bundle)).toBe(true)
    expect(bundle.mainModule).toBe(ASSETS_ONLY_MAIN_MODULE)
    expect(bundle.modules).toEqual({})
    expect(Object.keys(bundle.assets).sort()).toEqual(["/app.js", "/index.html", "/styles.css"])
    expect(bundle.assets["/index.html"]).toBe(LANDING)
    expect(bundle.assetConfig).toEqual({
      not_found_handling: "single-page-application",
      html_handling: "auto-trailing-slash",
    })
    expect(bundle.compatibilityDate).toBe("2025-04-01")
    expect(createApp).not.toHaveBeenCalled()
    expect(createWorker).not.toHaveBeenCalled()
  })

  it("reads wrangler.toml static configs too", async () => {
    const bundle = await buildDeploymentFromFiles({
      "wrangler.toml": 'compatibility_date = "2025-04-01"\n\n[assets]\ndirectory = "./public"\n',
      "public/index.html": LANDING,
    })
    expect(isAssetsOnlyDeployment(bundle)).toBe(true)
    expect(Object.keys(bundle.assets)).toEqual(["/index.html"])
  })
})

describe("buildDeploymentFromFiles: assets plus a server entry", () => {
  it("still bundles the conventional src/index.ts when main is omitted", async () => {
    const bundle = await buildDeploymentFromFiles({
      "wrangler.json": STATIC_WRANGLER,
      "public/index.html": LANDING,
      "src/index.ts":
        'import { DurableObject } from "cloudflare:workers"\nexport class App extends DurableObject { async fetch() { return new Response("api") } }\n',
    })
    expect(isAssetsOnlyDeployment(bundle)).toBe(false)
    expect(bundle.mainModule).toBe("bundle.js")
    expect(createApp).toHaveBeenCalledWith(expect.objectContaining({ server: "src/index.ts" }))
    expect(Object.keys(bundle.assets)).toEqual(["/index.html"])
  })
})

describe("resolveServerEntry", () => {
  it("prefers wrangler main and strips a leading ./", () => {
    expect(resolveServerEntry({ "src/app.ts": "" }, { main: "./src/app.ts" })).toBe("src/app.ts")
  })

  it("falls back to the bundler's conventional entries", () => {
    expect(resolveServerEntry({ "src/index.ts": "", "index.js": "" }, {})).toBe("src/index.ts")
    expect(resolveServerEntry({ "index.js": "" }, {})).toBe("index.js")
  })

  it("returns undefined for a static site, even with a package.json main", () => {
    expect(
      resolveServerEntry(
        { "package.json": JSON.stringify({ name: "landing", main: "index.js" }), "public/index.html": "" },
        { assets: { directory: "./public" } },
      ),
    ).toBeUndefined()
  })
})

describe("buildDeploymentFromFiles: static render mode", () => {
  it("fails the build when a page is not readable without JavaScript", async () => {
    await expect(
      buildDeploymentFromFiles(
        {
          "wrangler.json": STATIC_WRANGLER,
          "public/index.html":
            '<!doctype html><html><head><title>Vite + React</title></head><body><div id="root"></div><script type="module" src="/main.js"></script></body></html>',
        },
        { renderMode: "static" },
      ),
    ).rejects.toThrow(/^Static HTML check failed: .*\/index\.html: missing <meta name="description"/)
  })

  it("passes a static landing and does not check SPA-mode builds", async () => {
    const files = { "wrangler.json": STATIC_WRANGLER, "public/index.html": LANDING }
    const bundle = await buildDeploymentFromFiles(files, { renderMode: "static" })
    expect(bundle.warnings).toBeUndefined()

    const shell = {
      "wrangler.json": STATIC_WRANGLER,
      "public/index.html": '<html><body><div id="root"></div></body></html>',
    }
    await expect(buildDeploymentFromFiles(shell, { renderMode: "spa" })).resolves.toMatchObject({
      mainModule: ASSETS_ONLY_MAIN_MODULE,
    })
  })
})
