// Adapted from Paramount Quality+ (ISC). See NOTICE.md.
import { MANIFEST_EXTENSIONS, RESOLUTION_REGEX } from './constants.js';

// Small helpers to classify streaming URLs and extract resolution hints from
// path segments for observed playback statistics.
export function isManifestUrl(url) {
  if (!url) return false;
  return MANIFEST_EXTENSIONS.some(ext => url.includes(ext));
}

export function extractResolutionFromPath(pathname) {
  const resMatch = pathname.match(RESOLUTION_REGEX);
  return resMatch ? resMatch[1] : null;
}
