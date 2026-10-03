// Adapted from Paramount Quality+ (ISC). See NOTICE.md.
// Simple module-level store that keeps the current quality configuration and
// the parsed list of available representations from the active manifest.
export const DEFAULT_CONFIG = Object.freeze({
  forceMax: false,
  forcedHeight: null,
  forcedBandwidth: null
});

export function normalizeConfig(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const forcedHeight = Number.parseInt(source.forcedHeight, 10);
  const forcedBandwidth = Number(source.forcedBandwidth);
  return {
    forceMax: Boolean(source.forceMax),
    forcedHeight: Number.isFinite(forcedHeight) && forcedHeight > 0 ? forcedHeight : null,
    forcedBandwidth: Number.isFinite(forcedBandwidth) && forcedBandwidth > 0 ? forcedBandwidth : null
  };
}

let config = normalizeConfig();

let availableRepresentations = [];
let streamSession = {
  key: null,
  family: null,
  manifestUrl: null
};

export function getConfig() {
  return config;
}

export function setConfig(newConfig) {
  config = normalizeConfig(newConfig);
}

export function getRepresentations() {
  return availableRepresentations;
}

export function setRepresentations(reps, context = {}) {
  availableRepresentations = reps;
  if (reps.length === 0) {
    streamSession = { key: null, family: null, manifestUrl: null };
    return;
  }
  streamSession = {
    key: context.streamKey ?? reps[0]?.streamKey ?? streamSession.key,
    family: context.family ?? reps[0]?.family ?? streamSession.family,
    manifestUrl: context.manifestUrl ?? streamSession.manifestUrl
  };
}

export function getStreamSession() {
  return streamSession;
}
