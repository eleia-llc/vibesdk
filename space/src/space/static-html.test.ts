import { describe, expect, it } from "vitest"
import { checkStaticHtml, isRenderMode } from "./static-html"

const COPY =
  "Arepas recién hechas en budare, rellenas al momento y empacadas para que lleguen calientes. " +
  "Pide por WhatsApp, pagas al recibir y en 40 minutos estás comiendo. Cubrimos todo el Poblado y Laureles."

function page(opts: { head?: string; body?: string } = {}): string {
  const head =
    opts.head ??
    `<title>Arepas La Mona</title>
     <meta name="description" content="Arepas a domicilio en 40 minutos">
     <meta property="og:title" content="Arepas La Mona">
     <meta property="og:description" content="Arepas a domicilio en 40 minutos">
     <meta property="og:type" content="website">
     <meta property="og:image" content="https://example.com/a.jpg">`
  const body = opts.body ?? `<h1>Arepas en tu puerta en 40 minutos</h1><p>${COPY}</p>`
  return `<!doctype html><html lang="es"><head>${head}</head><body>${body}</body></html>`
}

describe("checkStaticHtml", () => {
  it("accepts a complete static landing", () => {
    expect(checkStaticHtml({ "/index.html": page(), "/styles.css": "body{}" })).toEqual({
      problems: [],
      warnings: [],
    })
  })

  it("rejects a client-rendered SPA shell", () => {
    const spa = page({
      head: "<title>Vite + React</title>",
      body: '<div id="root"></div><script type="module" src="/assets/index-abc123.js"></script>',
    })
    const { problems } = checkStaticHtml({ "/index.html": spa })
    expect(problems).toEqual([
      '/index.html: missing <meta name="description" content="..."> in <head>',
      '/index.html: missing <meta property="og:title" content="..."> in <head>',
      '/index.html: missing <meta property="og:description" content="..."> in <head>',
      "/index.html: no <h1> with text in the HTML body",
      expect.stringContaining("/index.html: the HTML body has only 0 characters of text"),
    ])
  })

  it("does not count text inside scripts or templates as content", () => {
    const body = `<h1>Hola</h1><script>const copy = ${JSON.stringify(COPY.repeat(3))}</script><template><p>${COPY}</p></template>`
    const { problems } = checkStaticHtml({ "/index.html": page({ body }) })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/^\/index\.html: the HTML body has only \d+ characters/)
  })

  it("requires an index.html", () => {
    expect(checkStaticHtml({ "/about.html": page() }).problems).toEqual([
      expect.stringContaining("/index.html: missing"),
    ])
  })

  it("checks every page except 404.html and reports missing og:image as a warning", () => {
    const noImage = page({
      head: `<title>Precios</title><meta name="description" content="d"><meta property="og:title" content="t"><meta property="og:description" content="d">`,
    })
    const report = checkStaticHtml({
      "/index.html": page(),
      "/precios/index.html": noImage,
      "/404.html": "<html><body>No existe</body></html>",
    })
    expect(report.problems).toEqual([])
    expect(report.warnings).toEqual([
      '/precios/index.html: no <meta property="og:type"> (use "website" for a landing)',
      '/precios/index.html: no <meta property="og:image">; link previews will show no image',
    ])
  })

  it("ignores empty meta content and accepts single-quoted attributes", () => {
    const head = `<title>T</title><meta name='description' content=''><meta property='og:title' content='T'><meta property='og:description' content='D'>`
    const { problems } = checkStaticHtml({ "/index.html": page({ head }) })
    expect(problems).toEqual(['/index.html: missing <meta name="description" content="..."> in <head>'])
  })
})

describe("isRenderMode", () => {
  it("only accepts the known modes", () => {
    expect(isRenderMode("static")).toBe(true)
    expect(isRenderMode("spa")).toBe(true)
    expect(isRenderMode("ssr")).toBe(false)
    expect(isRenderMode(undefined)).toBe(false)
  })
})
