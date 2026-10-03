// Local policy: narrow advertised video choices, then let the player switch itself.
export function videoCodecFamily(codecs) {
  const value = String(codecs || '').toLowerCase();
  if (/\b(?:avc1|avc3)\b/.test(value)) return 'avc';
  if (/\b(?:hvc1|hev1)\b/.test(value)) return 'hevc';
  if (/\b(?:dvhe|dvh1)\b/.test(value)) return 'dolby-vision';
  if (/\bav01\b/.test(value)) return 'av1';
  if (/\bvp0?9\b/.test(value)) return 'vp9';
  return null;
}

function supportedVideo(quality) {
  if (!Number.isFinite(quality.height) || quality.height <= 0 ||
      !Number.isFinite(quality.bandwidth) || quality.bandwidth <= 0 || !videoCodecFamily(quality.codecs)) return false;
  // HLS CODECS may include a separate audio track; check only the video codecs.
  const codecs = quality.codecs.split(',').map(value => value.trim()).filter(videoCodecFamily);
  if (typeof MediaSource === 'undefined' || typeof MediaSource.isTypeSupported !== 'function') return false;
  try {
    return MediaSource.isTypeSupported(`${quality.mimeType || 'video/mp4'}; codecs="${codecs.join(',')}"`);
  } catch { return false; }
}

export function selectManifestEntries(entries, config) {
  const keep = new Set(entries);
  if (!config.forceMax && !config.forcedHeight) return { keep, changed: false, applied: false, reason: 'auto' };
  const groups = new Map();
  for (const entry of entries) {
    const group = groups.get(entry.quality.compatibilityKey) || [];
    group.push(entry);
    groups.set(entry.quality.compatibilityKey, group);
  }
  let selectedGroups = 0;
  for (const group of groups.values()) {
    // Dependent representations must remain together (for example tiled video).
    if (group.some(({ quality }) => quality.dependent ||
      !Number.isFinite(quality.height) || quality.height <= 0 ||
      !Number.isFinite(quality.bandwidth) || quality.bandwidth <= 0)) continue;
    const candidates = group.filter(entry => supportedVideo(entry.quality) &&
      (config.forceMax || entry.quality.height === config.forcedHeight));
    candidates.sort((a, b) => {
      if (config.forceMax) return b.quality.height - a.quality.height || b.quality.bandwidth - a.quality.bandwidth;
      return config.forcedBandwidth
        ? Math.abs(a.quality.bandwidth - config.forcedBandwidth) - Math.abs(b.quality.bandwidth - config.forcedBandwidth)
        : b.quality.bandwidth - a.quality.bandwidth;
    });
    if (!candidates.length) continue;
    selectedGroups++;
    for (const entry of group) if (entry !== candidates[0]) keep.delete(entry);
  }
  return {
    keep, changed: keep.size !== entries.length, applied: selectedGroups > 0,
    reason: !selectedGroups ? 'unsupported' : selectedGroups < groups.size ? 'partial' : 'selected'
  };
}
