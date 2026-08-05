# @extractor/core

Private, runtime-portable extraction package for extractor.sh.

It owns URL validation, source selection, public GET fetching, source adapters,
HTML-to-Markdown conversion, metadata extraction, schema validation, and cache
TTL policy. Hosting applications inject optional expensive rendering through
`ExtractionDependencies.renderPageHtml`; the package does not import Cloudflare
bindings, Astro, rate limiters, or edge-cache orchestration.

The package exports TypeScript source directly inside the Bun workspace. It is
not published and does not require a separate build or versioning workflow.

Query-first capabilities are portable too: `searchWeb`, `searchNews`,
`searchImages`, and `searchPlaces` accept injected fetch implementations and
return the same schema-v1 feed contract as URL extraction.
