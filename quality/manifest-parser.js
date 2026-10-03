// Adapted manifest discovery from Paramount Quality+ (ISC). See NOTICE.md.
// Selection changes the manifest view only; every media URL remains original.
import { getConfig, setRepresentations, getRepresentations, getStreamSession } from './state.js';
import { classifyMediaRequest, deriveStreamKey, getDeliveryFamily, getHlsTier,
  isAdReference, normalizeRepresentations, resolveVariantUrl } from './stream-model.js';
import { selectManifestEntries, videoCodecFamily } from './manifest-policy.js';
import { recordPlaybackCheckpoint } from './diagnostics.js';

let ladderSignature = null;

function unchanged(text, reason = 'unsupported', selection = false) {
  return { text, changed: false, selection, policy: { applied: false, reason } };
}

function publishQualities(qualities, requestUrl, family) {
  const streamKey = deriveStreamKey(requestUrl, family);
  const previousKey = getStreamSession().key;
  const byHeight = new Map();
  for (const quality of qualities) {
    if (!Number.isFinite(quality.height) || quality.height <= 0 ||
        !Number.isFinite(quality.bandwidth) || quality.bandwidth <= 0 || quality.isAd) continue;
    const variants = byHeight.get(quality.height) || [];
    variants.push(quality);
    byHeight.set(quality.height, variants);
  }
  const grouped = normalizeRepresentations(Array.from(byHeight.values()).map(variants => {
    const preferred = variants.slice().sort((a, b) => b.bandwidth - a.bandwidth)[0];
    return { ...preferred, variants };
  }), { manifestUrl: requestUrl, streamKey });
  if (streamKey !== previousKey) {
    window.postMessage({ type: 'PMR_QUALITY_STREAM_RESET', payload: { streamKey } }, location.origin);
  }
  setRepresentations(grouped, { manifestUrl: requestUrl, family, streamKey });
  window.postMessage({ type: 'PMR_QUALITY_MANIFEST_DATA', payload: qualities.filter(q => !q.isAd) }, location.origin);
  const signature = JSON.stringify([streamKey, qualities.map(q => [q.id, q.height, q.bandwidth])]);
  if (signature !== ladderSignature) {
    ladderSignature = signature;
    recordPlaybackCheckpoint('ladder_ready', { family, representationCount: qualities.length });
  }
}

function attribute(attrs, name) {
  // A quoted CODECS value contains commas, so do not split the attribute list.
  return attrs.match(new RegExp(`(?:^|,)${name}=(?:"([^"]*)"|([^,]*))`))?.slice(1).find(value => value !== undefined) || null;
}

export function parseHlsManifest(content, requestUrl, config = getConfig()) {
  const lines = content.split('\n');
  const entries = [];
  const streamKey = deriveStreamKey(requestUrl, 'hls');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const attrs = line.slice('#EXT-X-STREAM-INF:'.length);
    let uriIndex = index + 1;
    while (uriIndex < lines.length && (!lines[uriIndex].trim() ||
      (lines[uriIndex].trim().startsWith('#') && !lines[uriIndex].trim().startsWith('#EXT')))) uriIndex++;
    if (uriIndex >= lines.length || lines[uriIndex].trim().startsWith('#')) return unchanged(content, 'malformed', true);
    const variantUrl = resolveVariantUrl(lines[uriIndex].trim(), requestUrl);
    const resolution = attribute(attrs, 'RESOLUTION')?.match(/^(\d+)x(\d+)$/);
    const codecs = attribute(attrs, 'CODECS');
    const audioGroup = attribute(attrs, 'AUDIO');
    const videoGroup = attribute(attrs, 'VIDEO');
    const videoRange = attribute(attrs, 'VIDEO-RANGE');
    const request = classifyMediaRequest(variantUrl);
    const hlsTier = getHlsTier(variantUrl);
    const quality = {
      id: `hls_${entries.length}`, height: Number(resolution?.[2]) || 0,
      width: Number(resolution?.[1]) || 0, bandwidth: Number(attribute(attrs, 'BANDWIDTH')) || 0,
      codecs, mimeType: 'video/mp4', audioGroup, videoGroup, videoRange, variantUrl,
      hlsTier, daiId: variantUrl?.match(/\/variant\/([^/]+)\//)?.[1] || null,
      family: getDeliveryFamily({ variantUrl, hlsTier }), streamKey,
      compatibilityKey: JSON.stringify([videoCodecFamily(codecs), audioGroup, videoGroup, videoRange]),
      isAd: request.isAd, isHls: true, isLive: request.isLive || /\/event\//i.test(variantUrl || ''),
      source: 'manifest'
    };
    entries.push({ quality, index, uriIndex });
  }
  if (!entries.length) {
    // Media playlists, keys and segments reach the player without alteration.
    const current = getRepresentations().flatMap(q => q.variants || [q]).find(q => q.variantUrl === requestUrl);
    if (current) window.postMessage({ type: 'PMR_QUALITY_ACTIVE_QUALITY', payload: {
      resolution: `${current.height}p`, bitrate: current.bandwidth / 1000,
      streamKey: current.streamKey, bitrateSource: 'manifest', timestamp: Date.now()
    } }, location.origin);
    return unchanged(content, 'media-playlist');
  }
  const programEntries = entries.filter(entry => !entry.quality.isAd);
  publishQualities(programEntries.map(entry => entry.quality), requestUrl, 'hls');
  const policy = selectManifestEntries(programEntries, config);
  const removed = new Set();
  for (const entry of programEntries) {
    if (!policy.keep.has(entry)) { removed.add(entry.index); removed.add(entry.uriIndex); }
  }
  return {
    text: removed.size ? lines.filter((_, index) => !removed.has(index)).join('\n') : content,
    changed: removed.size > 0, selection: true, policy: { applied: policy.applied, reason: policy.reason }
  };
}

function directChildren(node, name) {
  return Array.from(node?.children || []).filter(child => child.localName === name);
}

function ancestor(node, name) {
  for (let current = node.parentElement; current; current = current.parentElement) {
    if (current.localName === name) return current;
  }
  return null;
}

function directBase(node) {
  return directChildren(node, 'BaseURL')[0]?.textContent.trim() || '';
}

function isPreview(node) {
  if (/(?:^|[-_])(?:thumbnail|thumb|trickmode|trickplay)(?:[-_]|$)/i.test(node.getAttribute('id') || '')) return true;
  return ['EssentialProperty', 'SupplementalProperty', 'Role'].some(name =>
    Array.from(node.getElementsByTagNameNS('*', name)).some(property =>
      /trickmode|thumbnail_tile/i.test(property.getAttribute('schemeIdUri') || '') ||
      /^(thumbnail|thumb|trickmode|trickplay)$/i.test(property.getAttribute('value') || '')));
}

export function parseDashManifest(content, requestUrl, config = getConfig()) {
  const xml = new DOMParser().parseFromString(content, 'application/xml');
  if (xml.documentElement?.localName !== 'MPD' || xml.getElementsByTagName('parsererror').length || xml.doctype) {
    return unchanged(content, 'malformed', true);
  }
  const isLive = xml.documentElement.getAttribute('type') === 'dynamic';
  const entries = [];
  const serializer = new XMLSerializer();
  const sets = Array.from(xml.getElementsByTagNameNS('*', 'AdaptationSet'));
  for (let setIndex = 0; setIndex < sets.length; setIndex++) {
    const set = sets[setIndex];
    if (isPreview(set)) continue;
    const period = ancestor(set, 'Period');
    const periodId = period?.getAttribute('id') || '';
    const periodIsAd = /(?:^|[-_])(?:pre|mid|post)[-_]?roll|(?:^|[-_])ad(?:vertisement)?(?:[-_]|$)/i.test(periodId) ||
      isAdReference(directBase(period));
    const inheritedTemplate = directChildren(set, 'SegmentTemplate')[0];
    const dependent = directChildren(set, 'Representation').some(node =>
      node.hasAttribute('dependencyId') || node.hasAttribute('associationId')) ||
      Array.from(set.getElementsByTagNameNS('*', 'EssentialProperty')).some(node =>
        /srd|tile|dependency/i.test(node.getAttribute('schemeIdUri') || ''));
    for (const node of directChildren(set, 'Representation')) {
      const mimeType = node.getAttribute('mimeType') || set.getAttribute('mimeType') || '';
      const contentType = node.getAttribute('contentType') || set.getAttribute('contentType') || '';
      const codecs = node.getAttribute('codecs') || set.getAttribute('codecs') || '';
      if (/audio|image|text/i.test(`${mimeType} ${contentType}`) || isPreview(node)) continue;
      if (!/video/i.test(`${mimeType} ${contentType}`) && !videoCodecFamily(codecs)) continue;
      const rawId = node.getAttribute('id');
      const baseUrl = directBase(node) || directBase(set);
      const template = directChildren(node, 'SegmentTemplate')[0] || inheritedTemplate;
      const media = template?.getAttribute('media') || inheritedTemplate?.getAttribute('media') || null;
      const initialization = template?.getAttribute('initialization') || inheritedTemplate?.getAttribute('initialization') || null;
      const isAd = periodIsAd || [baseUrl, media, initialization, rawId].some(isAdReference);
      // Never join AdaptationSets or protection groups, even for the same title.
      const protection = directChildren(node, 'ContentProtection').map(value => serializer.serializeToString(value));
      const directory = [baseUrl, media, rawId].filter(Boolean).map(value =>
        value.split('/').filter(Boolean).findLast(part => /_\d{2,6}$/.test(part))).find(Boolean) || null;
      const bandwidth = Number(node.getAttribute('bandwidth')) || 0;
      const quality = {
        id: `s${setIndex}-${rawId}`, rawId, baseUrl, template: media, initialization,
        pathId: directory, dashTier: directory?.match(/_(\d{2,6})$/)?.[1] || null,
        height: Number(node.getAttribute('height') || set.getAttribute('height')) || 0,
        width: Number(node.getAttribute('width') || set.getAttribute('width')) || 0,
        bandwidth, codecs, mimeType: mimeType || 'video/mp4', isLive, isAd, dependent,
        compatibilityKey: JSON.stringify([setIndex, videoCodecFamily(codecs), protection]),
        family: 'dash', streamKey: deriveStreamKey(requestUrl, 'dash'), source: 'manifest'
      };
      entries.push({ quality, node });
    }
  }
  const programEntries = entries.filter(entry => !entry.quality.isAd);
  if (!programEntries.length) return unchanged(content, 'non-program-manifest');
  publishQualities(programEntries.map(entry => entry.quality), requestUrl, 'dash');
  const policy = selectManifestEntries(programEntries, config);
  if (policy.changed) {
    for (const entry of programEntries) if (!policy.keep.has(entry)) entry.node.remove();
  }
  return {
    text: policy.changed ? serializer.serializeToString(xml) : content,
    changed: policy.changed, selection: true, policy: { applied: policy.applied, reason: policy.reason }
  };
}

export function parseManifest(content, requestUrl, config = getConfig()) {
  if (typeof content !== 'string') return unchanged(content);
  try {
    const trimmed = content.trim();
    if (trimmed.startsWith('#EXTM3U')) return parseHlsManifest(content, requestUrl, config);
    if (trimmed.startsWith('<')) return parseDashManifest(content, requestUrl, config);
    return unchanged(content, 'malformed', true);
  } catch (error) {
    console.warn('[PMR_QUALITY] Manifest selection failed; preserving the original stream.', error);
    return unchanged(content, 'unsupported', true);
  }
}
