// Registry of CMS data types — one entry per list-page data table.
// The builder Data panel reads this config to know what fields to show.
//
// detail options:
//   'none'  — no detail view, cards only
//   'modal' — click card opens a modal with full record
//   'page'  — generates a SEO-friendly detail page at /:slug/:record-slug

// Empty for now — the source bundle's entries (service_bulletins,
// panther_completions) were specific to that project's aircraft-kit
// business and don't apply here. Add LIT-CRM's own dynamic data types
// as needed (e.g. case studies, client logos).
export const DATA_TYPES = {};
