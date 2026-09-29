// Keep the static document and HTTP deployment policy together. The meta policy
// protects the document only; normal URL workers require response headers.
export const DOCUMENT_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self' blob:; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
export const SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": `${DOCUMENT_CSP}; frame-ancestors 'none'`,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
});

export function checkDocumentPolicy(html) {
  const metas = [...html.matchAll(/<meta\b[^>]*http-equiv\s*=\s*"Content-Security-Policy"[^>]*>/gi)];
  if (metas.length !== 1 || !metas[0][0].includes(`content="${DOCUMENT_CSP}"`)) {
    throw new Error("index.html must declare the reviewed Content Security Policy exactly once.");
  }
  const before = html.slice(0, metas[0].index);
  if (!/<head\s*>/i.test(before) || /<(?:script|link|style|base|body)\b/i.test(before)) {
    throw new Error("The document policy must precede every resource in the head.");
  }
  if (!html.includes('<meta name="referrer" content="no-referrer"')) {
    throw new Error("index.html must suppress outgoing referrers.");
  }
}

// Cloudflare Pages static-asset format. GitHub Pages does not activate this
// file; an actual deployment must be verified before claiming header coverage.
export function securityHeadersFile() {
  return "# Apply to ALL static responses, including module workers.\n/*\n"
    + Object.entries(SECURITY_HEADERS).map(([name, value]) => `  ${name}: ${value}\n`).join("");
}
