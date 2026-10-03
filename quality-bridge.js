(() => {
  const PENDING_CONFIG_KEY = "pmrQualityPendingQualityConfig";
  const RECOVERY_KEY = "pmrQualityOriginalStreamRecovery";
  const DEFAULTS = { qualityMode: "auto", preferredHeight: null, preferredBandwidth: null };
  let settings = { ...DEFAULTS };
  let qualities = [];
  let streamKey = null;
  let sample = {};
  let measuredBitrate = null;
  let observationSequence = 0;
  let recovering = false;
  let injectionError = false;
  let appliedConfig = null;
  let settingsLoaded = false;
  let policy = { applied: false, reason: "waiting" };
  let recoveryRecord = null;
  let pendingRecovery = null;

  function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function normalizeSettings(value) {
    return {
      qualityMode: ["auto", "max", "manual"].includes(value.qualityMode) ? value.qualityMode : "auto",
      preferredHeight: positiveNumber(value.preferredHeight),
      preferredBandwidth: positiveNumber(value.preferredBandwidth)
    };
  }

  function isLivePlayback() {
    return /\/(live|live-tv)(\/|$)/i.test(location.pathname) ||
      /\/sports\/.*\/(live|watch|stream)(\/|$)/i.test(location.pathname) ||
      qualities.some((quality) => quality.isLive);
  }

  function getConfig() {
    const manual = settings.qualityMode === "manual" && !recovering;
    return {
      forceMax: settings.qualityMode === "max" && !recovering,
      forcedHeight: manual ? settings.preferredHeight : null,
      forcedBandwidth: manual ? settings.preferredBandwidth : null
    };
  }

  function clearRecovery() {
    recovering = false;
    recoveryRecord = null;
    try { sessionStorage.removeItem(RECOVERY_KEY); } catch { /* In-memory state still clears. */ }
  }

  function restoreRecovery() {
    try {
      const stored = sessionStorage.getItem(RECOVERY_KEY);
      // Migrate the old one-reload marker into a persistent per-title fallback.
      recoveryRecord = stored === "1"
        ? { url: location.href, preference: JSON.stringify(settings) }
        : JSON.parse(stored || "null");
      recovering = Boolean(recoveryRecord && recoveryRecord.url === location.href &&
        recoveryRecord.preference === JSON.stringify(settings));
      if (recovering) sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(recoveryRecord));
      else clearRecovery();
    } catch { clearRecovery(); }
  }

  function recoverPlayback(detail) {
    if (!settingsLoaded) { pendingRecovery = detail; return; }
    if (recovering || settings.qualityMode === "auto") return;
    recovering = true;
    recoveryRecord = { url: location.href, preference: JSON.stringify(settings), reason: detail };
    applyConfig();
    try {
      sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(recoveryRecord));
      location.reload();
    } catch { /* Stay in Auto; without a persistent marker, do not reload. */ }
  }

  function applyConfig(force = false) {
    if (!settingsLoaded) return;
    const next = getConfig();
    const changed = JSON.stringify(next) !== JSON.stringify(appliedConfig);
    appliedConfig = next;
    // Preserve the latest choice for a reload before asynchronous storage loads.
    try { sessionStorage.setItem(PENDING_CONFIG_KEY, JSON.stringify(appliedConfig)); } catch { /* The page message still applies it. */ }
    if (changed || force) window.postMessage({ type: "PMR_QUALITY_CONFIG", payload: appliedConfig }, location.origin);
  }

  function resetStream(key) {
    streamKey = key;
    qualities = [];
    sample = {};
    measuredBitrate = null;
    observationSequence = 0;
    policy = { applied: false, reason: "waiting" };
    if (recovering && recoveryRecord?.url !== location.href) {
      clearRecovery();
      applyConfig();
    }
  }

  function normalizeQualities(payload) {
    if (!Array.isArray(payload)) return [];
    return payload.flatMap((quality) => {
      if (!quality || typeof quality !== "object") return [];
      const height = positiveNumber(quality.height);
      const bandwidth = positiveNumber(quality.bandwidth);
      if (!height || !bandwidth || typeof quality.id !== "string") return [];
      return [{ id: quality.id, height, bandwidth,
        streamKey: typeof quality.streamKey === "string" ? quality.streamKey : null,
        isLive: Boolean(quality.isLive) }];
    }).sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth).slice(0, 100);
  }

  function getVideo() {
    return Array.from(document.querySelectorAll("video"))
      .filter((item) => item.readyState >= 2 && item.videoHeight > 0)
      .sort((a, b) => Number(a.paused) - Number(b.paused) ||
        b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight)[0];
  }

  function getSnapshot() {
    const video = getVideo();
    const decodedHeight = video?.videoHeight || null;
    const matches = qualities.filter((quality) => quality.height === decodedHeight);
    const freshSample = video?.paused || Date.now() - (sample.timestamp || 0) < 45000;
    let bitrate = freshSample ? positiveNumber(sample.bitrate) : null;
    let bitrateSource = bitrate ? sample.bitrateSource || "stream" : null;
    const sampleHeight = Number.parseInt(sample.resolution, 10);
    if (decodedHeight && Number.isFinite(sampleHeight) && sampleHeight !== decodedHeight) {
      bitrate = null;
      bitrateSource = null;
    }
    if (!bitrate) {
      const bandwidths = [...new Set(matches.map((quality) => quality.bandwidth))];
      if (bandwidths.length === 1) {
        bitrate = bandwidths[0] / 1000;
        bitrateSource = "manifest";
      }
    }
    const sameVideo = measuredBitrate && video &&
      (!measuredBitrate.sourceUrl || measuredBitrate.sourceUrl === (video.currentSrc || video.src));
    const freshMeasurement = sameVideo &&
      (video.paused || Date.now() - measuredBitrate.timestamp < 45000);
    if (!bitrate && freshMeasurement) {
      bitrate = measuredBitrate.bitrate;
      bitrateSource = measuredBitrate.includesAudio ? "media-audio-estimate" : "media-estimate";
    }
    return {
      settings,
      qualities,
      resolution: decodedHeight ? `${decodedHeight}p` : sample.resolution || null,
      bitrate,
      bitrateSource,
      estimated: !decodedHeight && Boolean(sample.isEstimated),
      decoded: Boolean(decodedHeight),
      playbackDetected: Boolean(video),
      recovering,
      policy,
      injectionError,
      manualAvailable: qualities.some((quality) => quality.height === settings.preferredHeight),
      appliedConfig,
      isLive: isLivePlayback()
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || !event.data) return;
    const { type, payload } = event.data;
    if (type === "PMR_QUALITY_STREAM_RESET") {
      resetStream(typeof payload?.streamKey === "string" ? payload.streamKey : null);
    } else if (type === "PMR_QUALITY_MANIFEST_DATA") {
      const next = normalizeQualities(payload);
      if (!next.length) return;
      const nextKey = next[0].streamKey;
      if (nextKey && streamKey && nextKey !== streamKey) resetStream(nextKey);
      if (nextKey) streamKey = nextKey;
      qualities = next;
      applyConfig();
    } else if (type === "PMR_QUALITY_POLICY_DATA") {
      const config = payload?.config;
      const current = getConfig();
      const matchesConfig = config && config.forceMax === current.forceMax &&
        config.forcedHeight === current.forcedHeight && config.forcedBandwidth === current.forcedBandwidth;
      if (matchesConfig && ["auto", "unsupported", "partial", "selected", "malformed"].includes(payload.reason)) {
        policy = { applied: payload.applied === true, reason: payload.reason };
      }
    } else if (type === "PMR_QUALITY_MEASURED_BITRATE") {
      if (!payload || !positiveNumber(payload.bitrate) || !positiveNumber(payload.timestamp)) return;
      measuredBitrate = { bitrate: positiveNumber(payload.bitrate),
        timestamp: payload.timestamp, includesAudio: Boolean(payload.includesAudio),
        sourceUrl: typeof payload.sourceUrl === "string" ? payload.sourceUrl : null };
    } else if (type === "PMR_QUALITY_DATA" || type === "PMR_QUALITY_ACTIVE_QUALITY") {
      if (!payload || typeof payload !== "object") return;
      const nextKey = typeof payload.streamKey === "string" ? payload.streamKey : null;
      // Playlist and media CDNs can use different stream keys for one video.
      // Manifest/reset messages own the quality ladder; samples only supply stats.
      if (nextKey && !streamKey) streamKey = nextKey;
      if (Number.isFinite(payload.observationSequence)) {
        if (payload.observationSequence < observationSequence) return;
        observationSequence = payload.observationSequence;
      }
      sample = { resolution: typeof payload.resolution === "string" ? payload.resolution : null,
        bitrate: positiveNumber(payload.bitrate), isEstimated: Boolean(payload.isEstimated),
        timestamp: positiveNumber(payload.timestamp) || Date.now(),
        bitrateSource: payload.bitrateSource === "manifest" ? "manifest" : "stream" };
    } else if (type === "PMR_QUALITY_ORIGINAL_STREAM_RECOVERY") {
      recoverPlayback(typeof payload?.detail === "string" ? payload.detail : "playback-error");
    }
  });

  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (request.type === "PMR_GET_STATE") {
      respond(getSnapshot());
    } else if (request.type === "PMR_APPLY_QUALITY") {
      settings = normalizeSettings(request.settings || DEFAULTS);
      settingsLoaded = true;
      clearRecovery();
      policy = { applied: false, reason: "waiting" };
      applyConfig();
      // Start with a fresh manifest and let the player initialize its own tracks.
      const reload = Boolean((request.reloadPlayback || request.reloadLivePlayback) && (getVideo() || qualities.length));
      respond({ applied: true, reloading: reload });
      if (reload) {
        try { sessionStorage.setItem(PENDING_CONFIG_KEY, JSON.stringify(appliedConfig)); } catch { /* Saved preferences will load on restart. */ }
        location.reload();
      }
    } else if (request.type === "PMR_RELOAD_PLAYER") {
      respond({ reloading: true });
      location.reload();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !Object.keys(DEFAULTS).some((key) => key in changes)) return;
    const previous = JSON.stringify(settings);
    for (const key of Object.keys(DEFAULTS)) {
      if (key in changes) settings[key] = changes[key].newValue ?? DEFAULTS[key];
    }
    settings = normalizeSettings(settings);
    if (JSON.stringify(settings) === previous) return;
    clearRecovery();
    applyConfig();
  });

  chrome.storage.local.get(DEFAULTS, (saved = DEFAULTS) => {
    settings = normalizeSettings(saved);
    settingsLoaded = true;
    restoreRecovery();
    applyConfig();
    if (pendingRecovery) {
      const detail = pendingRecovery;
      pendingRecovery = null;
      recoverPlayback(detail);
    }
  });

  const script = document.createElement("script");
  script.type = "module";
  script.src = chrome.runtime.getURL("quality/index.js");
  script.onload = () => { applyConfig(true); script.remove(); };
  script.onerror = () => { injectionError = true; script.remove(); };
  if (document.documentElement) document.documentElement.append(script);
  else document.addEventListener("DOMContentLoaded", () => document.documentElement.append(script), { once: true });
})();
