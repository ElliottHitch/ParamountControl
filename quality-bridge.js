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
    const candidates = qualities.filter((quality) => quality.height === settings.preferredHeight);
    const selected = settings.preferredBandwidth && candidates.length
      ? candidates.reduce((closest, quality) =>
          Math.abs(quality.bandwidth - settings.preferredBandwidth) < Math.abs(closest.bandwidth - settings.preferredBandwidth)
            ? quality : closest)
      : candidates[0];
    return {
      forceMax: settings.qualityMode === "max" && !recovering,
      forcedId: manual ? selected?.id || null : null,
      forcedHeight: manual ? settings.preferredHeight : null,
      forcedBandwidth: manual ? settings.preferredBandwidth : null
    };
  }

  function applyConfig() {
    if (!settingsLoaded) return;
    appliedConfig = getConfig();
    // Preserve the latest choice for a reload before asynchronous storage loads.
    try { sessionStorage.setItem(PENDING_CONFIG_KEY, JSON.stringify(appliedConfig)); } catch { /* The page message still applies it. */ }
    window.postMessage({ type: "PMR_QUALITY_CONFIG", payload: appliedConfig }, location.origin);
  }

  function resetStream(key) {
    streamKey = key;
    qualities = [];
    sample = {};
    measuredBitrate = null;
    observationSequence = 0;
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

  function getSnapshot() {
    const video = Array.from(document.querySelectorAll("video"))
      .filter((item) => item.readyState >= 2 && item.videoHeight > 0)
      .sort((a, b) => Number(a.paused) - Number(b.paused) ||
        b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight)[0];
    const decodedHeight = video?.videoHeight || null;
    const matches = qualities.filter((quality) => quality.height === decodedHeight);
    let bitrate = positiveNumber(sample.bitrate);
    let bitrateSource = bitrate ? "stream" : null;
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
        bitrate: positiveNumber(payload.bitrate), isEstimated: Boolean(payload.isEstimated) };
    } else if (type === "PMR_QUALITY_ORIGINAL_STREAM_RECOVERY" && !recovering && settings.qualityMode !== "auto") {
      recovering = true;
      applyConfig();
      // Recover once in Auto; do not create an endless reload/forcing loop.
      try {
        sessionStorage.setItem(RECOVERY_KEY, "1");
        location.reload();
      } catch { /* Stay in Auto if recovery cannot survive a reload. */ }
    }
  });

  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (request.type === "PMR_GET_STATE") {
      respond(getSnapshot());
    } else if (request.type === "PMR_APPLY_QUALITY") {
      settings = normalizeSettings(request.settings || DEFAULTS);
      settingsLoaded = true;
      recovering = false;
      applyConfig();
      const reload = Boolean(request.reloadLivePlayback && isLivePlayback());
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
    for (const key of Object.keys(DEFAULTS)) {
      if (key in changes) settings[key] = changes[key].newValue ?? DEFAULTS[key];
    }
    settings = normalizeSettings(settings);
    recovering = false;
    applyConfig();
  });

  chrome.storage.local.get(DEFAULTS, (saved) => {
    settings = normalizeSettings(saved);
    settingsLoaded = true;
    try {
      recovering = sessionStorage.getItem(RECOVERY_KEY) === "1";
      if (recovering) sessionStorage.removeItem(RECOVERY_KEY);
      sessionStorage.setItem(PENDING_CONFIG_KEY, JSON.stringify(getConfig()));
    } catch { /* The onload message also supplies configuration. */ }
    applyConfig();
  });

  const script = document.createElement("script");
  script.type = "module";
  script.src = chrome.runtime.getURL("quality/index.js");
  script.onload = () => { applyConfig(); script.remove(); };
  script.onerror = () => { injectionError = true; script.remove(); };
  if (document.documentElement) document.documentElement.append(script);
  else document.addEventListener("DOMContentLoaded", () => document.documentElement.append(script), { once: true });
})();
