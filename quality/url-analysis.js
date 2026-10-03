// Adapted stream telemetry from Paramount Quality+ (ISC). See NOTICE.md.
// Read original requests only; never infer a selectable rendition from a URL.
import { extractResolutionFromPath } from './url-utils.js';
import { getRepresentations } from './state.js';
import { classifyMediaRequest, deriveStreamKey } from './stream-model.js';

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function analyzeUrl(url, { observationSequence } = {}) {
  try {
    const request = classifyMediaRequest(url);
    if (request.kind !== 'segment' || request.excluded || request.isInitialization) return;
    const pathname = request.url.pathname;
    const representations = getRepresentations().flatMap(rep => rep.variants || [rep]);
    const pathResolution = extractResolutionFromPath(pathname);
    const dashTier = pathname.match(/_(\d{2,6})\/(?:seg_|init)/i)?.[1];
    const hlsTier = pathname.match(/manifest(?:_video)?_(\d+)[_\/]/i)?.[1];
    const directoryMatches = representations.filter(rep =>
      (dashTier && rep.dashTier === dashTier) ||
      (hlsTier && rep.hlsTier === hlsTier) ||
      (rep.daiId && pathname.includes(`/variant/${rep.daiId}/`)));
    let bitrate = positiveNumber(request.cmcd.br);
    let bitrateSource = bitrate ? 'stream' : null;
    let matches = directoryMatches;
    if (!matches.length && pathResolution) {
      matches = representations.filter(rep => rep.height === Number.parseInt(pathResolution, 10));
    }
    const heights = [...new Set(matches.map(rep => rep.height))];
    let resolution = heights.length === 1 ? `${heights[0]}p` : pathResolution;
    let isEstimated = false;
    if (!resolution && bitrate) {
      // A rounded CMCD rate can identify a declared rendition, but its height
      // is still an estimate until the decoder reports the actual dimensions.
      const rateMatches = representations.filter(rep =>
        Math.abs(rep.bandwidth - bitrate * 1000) <= Math.max(75000, rep.bandwidth * 0.05));
      const rateHeights = [...new Set(rateMatches.map(rep => rep.height))];
      if (rateHeights.length === 1) { resolution = `${rateHeights[0]}p`; isEstimated = true; }
    }
    const bandwidths = [...new Set(matches.map(rep => rep.bandwidth))];
    const advertised = bandwidths.length === 1 ? bandwidths[0] / 1000 : null;
    if (advertised && (!bitrate || (directoryMatches.length &&
        Math.abs(advertised - bitrate) > Math.max(75, advertised * 0.05)))) {
      bitrate = advertised;
      bitrateSource = 'manifest';
    }
    if (!resolution && !bitrate) return;
    window.postMessage({ type: 'PMR_QUALITY_DATA', payload: {
      resolution, bitrate, bitrateSource, isEstimated,
      streamKey: deriveStreamKey(request.url), observationSequence, timestamp: Date.now()
    } }, location.origin);
  } catch { /* Telemetry failure must leave playback unchanged. */ }
}
