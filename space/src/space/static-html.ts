// ─── Static HTML render mode ─────────────────────────────────────────────────
//
// A space can be created in "static" render mode. In that mode every HTML page
// the deploy ships must be readable without running JavaScript: crawlers and
// link-preview bots (Google, WhatsApp, Slack, iMessage) read the raw HTML and
// never execute the client bundle, so a React SPA that only ships
// `<div id="root"></div>` looks empty to them.
//
// `checkStaticHtml` inspects the built asset map of a deployment (the same map
// the preview and the Workers for Platforms publish serve) and reports what a
// no-JS reader would miss. The deploy engine turns problems into a build error
// so the agent fixes the page before it is previewed or published.

/** How a space's pages are rendered. `spa` keeps the default behavior. */
export type RenderMode = "spa" | "static"

export const RENDER_MODES: readonly RenderMode[] = ["spa", "static"]

export function isRenderMode(value: unknown): value is RenderMode {
  return typeof value === "string" && (RENDER_MODES as readonly string[]).includes(value)
}

/**
 * Minimum visible text (outside scripts/styles/templates) a page body must
 * carry. A real landing has far more; an SPA shell has close to zero.
 */
export const MIN_BODY_TEXT_LENGTH = 200

export interface StaticHtmlReport {
  /** Blocking issues, prefixed with the asset path (e.g. `/index.html: ...`). */
  problems: string[]
  /** Non-blocking recommendations for better link previews. */
  warnings: string[]
}

/** Pages that are exempt from the content/meta rules (error pages). */
const EXEMPT_PAGES = new Set(["/404.html"])

export function checkStaticHtml(assets: Record<string, string>): StaticHtmlReport {
  const problems: string[] = []
  const warnings: string[] = []

  if (!("/index.html" in assets)) {
    problems.push(
      "/index.html: missing. Static render mode serves the landing from the assets directory, so it needs an index.html at its root",
    )
  }

  const pages = Object.keys(assets)
    .filter((path) => path.toLowerCase().endsWith(".html") && !EXEMPT_PAGES.has(path))
    .sort((a, b) => (a === "/index.html" ? -1 : b === "/index.html" ? 1 : a.localeCompare(b)))

  for (const page of pages) {
    const report = checkPage(assets[page])
    for (const p of report.problems) problems.push(`${page}: ${p}`)
    for (const w of report.warnings) warnings.push(`${page}: ${w}`)
  }

  return { problems, warnings }
}

function checkPage(html: string): StaticHtmlReport {
  const problems: string[] = []
  const warnings: string[] = []

  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "")
  const head = extractElementInner(withoutComments, "head") ?? ""
  const body = extractElementInner(withoutComments, "body") ?? withoutComments

  const title = textOf(extractElementInner(head, "title") ?? "")
  if (!title) problems.push("missing a non-empty <title> in <head>")

  const metas = parseMetaTags(head)
  const metaContent = (key: string): string | undefined => {
    for (const m of metas) {
      const k = (m.property ?? m.name ?? "").toLowerCase()
      if (k === key && m.content && m.content.trim()) return m.content.trim()
    }
    return undefined
  }

  if (!metaContent("description")) problems.push('missing <meta name="description" content="..."> in <head>')
  if (!metaContent("og:title")) problems.push('missing <meta property="og:title" content="..."> in <head>')
  if (!metaContent("og:description")) problems.push('missing <meta property="og:description" content="..."> in <head>')
  if (!metaContent("og:type")) warnings.push('no <meta property="og:type"> (use "website" for a landing)')
  if (!metaContent("og:image")) warnings.push('no <meta property="og:image">; link previews will show no image')

  const visibleBody = stripNonContent(body)
  if (!/<h1\b[^>]*>[\s\S]*?<\/h1>/i.test(visibleBody) || !textOf(firstH1(visibleBody))) {
    problems.push("no <h1> with text in the HTML body")
  }

  const text = textOf(visibleBody)
  if (text.length < MIN_BODY_TEXT_LENGTH) {
    problems.push(
      `the HTML body has only ${text.length} characters of text outside <script>/<style>/<template> ` +
        `(minimum ${MIN_BODY_TEXT_LENGTH}). The content looks client-rendered (for example an empty ` +
        `<div id="root"> filled by JavaScript). Write the headings and copy directly in the HTML; ` +
        `use JavaScript only to enhance it`,
    )
  }

  return { problems, warnings }
}

function extractElementInner(html: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "i")
  const match = html.match(re)
  if (match) return match[1]
  // Unclosed <body>/<head> is valid HTML; take everything after the open tag.
  const open = html.match(new RegExp(`<${tag}\\b[^>]*>`, "i"))
  if (!open || open.index === undefined) return undefined
  return html.slice(open.index + open[0].length)
}

function stripNonContent(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template\s*>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, " ")
}

function firstH1(html: string): string {
  return html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? ""
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
}

interface MetaTag {
  name?: string
  property?: string
  content?: string
}

function parseMetaTags(html: string): MetaTag[] {
  const out: MetaTag[] = []
  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = parseAttributes(match[1])
    out.push({
      name: attrs.name,
      property: attrs.property,
      content: attrs.content !== undefined ? decodeEntities(attrs.content) : undefined,
    })
  }
  return out
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  for (const m of source.matchAll(re)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ""
  }
  return attrs
}
