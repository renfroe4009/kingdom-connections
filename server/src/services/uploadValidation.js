// =============================================================================
// Upload content validation (security remediation H-11)
//
// multer's fileFilter only ever sees the CLIENT-DECLARED Content-Type — a
// multipart header the uploader controls entirely, not the actual file
// bytes. This does real magic-byte sniffing (via `file-type`, ESM-only,
// hence the dynamic import from this CJS codebase) and rejects anything
// whose real content doesn't match an explicitly allowed type.
//
// image/svg+xml is deliberately never in an allowlist that reaches this
// validator — SVG is active content (can embed <script>), and unlike the
// raster/PDF/video types below, `file-type` cannot magic-byte-detect it at
// all (it's XML text, no fixed byte signature), so there would be nothing
// to validate against anyway. If SVG support is ever genuinely needed,
// don't just add it back here — sanitize it server-side (DOMPurify's SVG
// profile) and always serve it as an attachment with nosniff.
// =============================================================================

async function detectFileType(buffer) {
  const { fileTypeFromBuffer } = await import('file-type');
  return fileTypeFromBuffer(buffer);
}

/**
 * Verifies a multer-buffered file's real content matches one of
 * `allowedMimes` (the real allowlist — not just what the client claimed).
 * Returns { ok: true } or { ok: false, error } — never throws, so callers
 * can respond with a clean 400 either way.
 */
async function validateUploadedFile(file, allowedMimes) {
  if (!file?.buffer?.length) return { ok: false, error: 'Empty upload' };
  const detected = await detectFileType(file.buffer);
  if (!detected || !allowedMimes.includes(detected.mime)) {
    return {
      ok: false,
      error: detected
        ? `File content is ${detected.mime}, not an allowed type`
        : 'Could not verify file content — the file may be corrupt or of an unsupported type',
    };
  }
  return { ok: true, detectedMime: detected.mime };
}

module.exports = { validateUploadedFile };
