---
name: static-html-site
description: Build a site whose pages are complete static HTML, readable by search engines and link-preview bots (WhatsApp, Slack, iMessage, social networks) without running JavaScript. Use this skill for landing pages and marketing sites, and always when the project is in static render mode. Covers the project shape, the required head/meta/Open Graph tags, progressive enhancement, and the deploy-time static HTML check.
---

# Static HTML sites

Crawlers and link-preview bots download the HTML of a URL and read it as-is. They do not run your JavaScript. A page whose HTML is `<div id="root"></div>` plus a script shows up empty in Google and as a blank card in WhatsApp. In a static site every page ships its real content in the HTML.

## Project shape

This is the "Pure static site" shape from `cloudflare-bundler-apps`: assets only, no server Worker.

```
/
├── wrangler.json
└── public/
    ├── index.html        # the landing, complete HTML
    ├── styles.css
    └── app.js            # optional progressive enhancement
```

`wrangler.json`:

```json
{
  "compatibility_date": "2025-04-01",
  "assets": {
    "directory": "./public",
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "404-page"
  }
}
```

- No `main` and no `src/index.ts`: the deploy ships the assets as an assets-only app.
- Add `main` (an `App` Durable Object) only if the site needs a backend, for example a form endpoint. The pages stay static HTML either way.
- Use `"404-page"` and a `public/404.html` for unknown paths. `single-page-application` is for client-routed apps and makes every unknown URL return the landing with status 200.
- Write files with absolute paths (`/wrangler.json`, `/public/index.html`).

## Every page

```html
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Arepas La Mona: arepas recién hechas a domicilio</title>
  <meta name="description" content="Arepas recién hechas, en tu puerta en 40 minutos. Pide por WhatsApp.">

  <meta property="og:type" content="website">
  <meta property="og:title" content="Arepas La Mona: arepas recién hechas a domicilio">
  <meta property="og:description" content="Arepas recién hechas, en tu puerta en 40 minutos. Pide por WhatsApp.">
  <meta property="og:image" content="https://images.example.com/arepas-1200x630.jpg">
  <meta property="og:locale" content="es_CO">
  <meta name="twitter:card" content="summary_large_image">

  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header>…</header>
  <main>
    <h1>Arepas recién hechas, en tu puerta en 40 minutos</h1>
    <p>…the real copy of the section…</p>
    …
  </main>
  <footer>…</footer>
  <script src="/app.js" defer></script>
</body>
</html>
```

Rules:

- One `<h1>` per page with the main promise. Sections use `<h2>`/`<h3>`.
- `<title>` and `og:title` say the same thing (60 characters or less). `description` and `og:description` match too (about 150 characters).
- `og:type` is `website` for a landing. Add `og:image` when there is an image: an absolute `https://` URL of a JPEG or PNG, ideally 1200x630. Preview bots ignore relative URLs and SVG.
- Write all copy, prices, FAQs, testimonials and calls to action in the HTML. Text inside `<script>`, `<template>` or JSON is invisible to a no-JS reader.
- Use semantic elements (`header`, `nav`, `main`, `section`, `footer`) and `alt` text on images.
- Links between pages are plain `<a href="/precios/">`, one HTML file per page (`public/precios/index.html` or `public/precios.html`).

## JavaScript: enhancement only

JavaScript may add behavior to content that is already there: a mobile menu toggle, reveal-on-scroll classes, a carousel over existing slides, form submission. Write it as plain browser JS (no JSX, no build step) and load it with `defer`.

Do not:

- render sections, lists or copy from JS arrays or `fetch` calls,
- mount React, Vue or Svelte into an empty element,
- hide content until JS runs (`opacity: 0` that only JS removes). Start visible and let JS add the animation class.

## Deploy check

In static render mode `deploy_space` checks every HTML page except `404.html` and fails with `Static HTML check failed` when one of these is missing:

- `public/index.html`
- a non-empty `<title>`
- `<meta name="description">`, `og:title` and `og:description` with content
- an `<h1>` with text
- at least 200 characters of body text outside `<script>`, `<style>`, `<template>` and `<noscript>`

Missing `og:type` or `og:image` is reported in `warnings` without failing. Fix the listed problems in the HTML and run `deploy_space` again.
