// Local telemetry: observe byte counts and media time, without inspecting payloads.
(() => {
  if (window.__PMR_BITRATE_METER__) return;
  if (typeof MediaSource === 'undefined' || typeof SourceBuffer === 'undefined') return;
  window.__PMR_BITRATE_METER__ = true;
  const buffers = new WeakMap();
  const sourceUrls = new WeakMap();
  const originalCreateUrl = URL.createObjectURL;
  const originalAddBuffer = MediaSource.prototype.addSourceBuffer;
  const originalAppend = SourceBuffer.prototype.appendBuffer;

  function ranges(buffer) {
    try {
      return Array.from({ length: buffer.buffered.length }, (_, index) =>
        [buffer.buffered.start(index), buffer.buffered.end(index)]);
    } catch { return []; }
  }

  function addedDuration(before, after) {
    return after.reduce((total, [start, end]) => {
      const overlap = before.reduce((covered, [oldStart, oldEnd]) =>
        covered + Math.max(0, Math.min(end, oldEnd) - Math.max(start, oldStart)), 0);
      return total + Math.max(0, end - start - overlap);
    }, 0);
  }

  URL.createObjectURL = function (object) {
    const result = originalCreateUrl.apply(this, arguments);
    if (object instanceof MediaSource) sourceUrls.set(object, result);
    return result;
  };

  MediaSource.prototype.addSourceBuffer = function (mime) {
    const buffer = originalAddBuffer.apply(this, arguments);
    const type = String(mime).toLowerCase();
    if (type.startsWith('video/')) {
      buffers.set(buffer, {
        source: this,
        includesAudio: /mp4a|ac-3|ec-3|opus|vorbis/.test(type),
        recent: []
      });
    }
    return buffer;
  };

  SourceBuffer.prototype.appendBuffer = function (data) {
    const info = buffers.get(this);
    const bytes = Number(data?.byteLength);
    if (!info || this.updating || !Number.isFinite(bytes) || bytes <= 0) {
      return originalAppend.apply(this, arguments);
    }
    const before = ranges(this);
    const buffer = this;
    let failed = false;
    const onError = () => { failed = true; };
    const cleanup = () => {
      buffer.removeEventListener('error', onError);
      buffer.removeEventListener('abort', onError);
      buffer.removeEventListener('updateend', onEnd);
    };
    const onEnd = () => {
      cleanup();
      if (failed) return;
      const duration = addedDuration(before, ranges(buffer));
      // Initialization data and replacement/removal operations add no media time.
      if (duration < 0.1 || duration > 120) return;
      const now = Date.now();
      info.recent = info.recent.filter((item) => now - item.timestamp < 45000);
      info.recent.push({ bytes, duration, timestamp: now });
      info.recent = info.recent.slice(-3);
      const totalBytes = info.recent.reduce((sum, item) => sum + item.bytes, 0);
      const totalDuration = info.recent.reduce((sum, item) => sum + item.duration, 0);
      window.postMessage({ type: 'PMR_QUALITY_MEASURED_BITRATE', payload: {
        bitrate: totalBytes * 8 / totalDuration / 1000,
        timestamp: now,
        sourceUrl: sourceUrls.get(info.source) || null,
        includesAudio: info.includesAudio
      } }, location.origin);
    };
    buffer.addEventListener('error', onError);
    buffer.addEventListener('abort', onError);
    buffer.addEventListener('updateend', onEnd);
    try {
      return originalAppend.apply(this, arguments);
    } catch (error) {
      cleanup();
      throw error;
    }
  };
})();
