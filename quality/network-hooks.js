// Local transport hooks. Observe original requests and select manifest choices only.
import { getConfig, getStreamSession } from './state.js';
import { classifyMediaRequest } from './stream-model.js';
import { isManifestUrl } from './url-utils.js';
import { createRecoveryController } from './recovery-controller.js';
import { diagnosticNow, recordDiagnosticEvent, recordRequestAttempt } from './diagnostics.js';

export function initNetworkHooks({ analyzeUrl, parseManifest }) {
  const originalFetch = window.fetch;
  const originalOpen = XMLHttpRequest.prototype.open;
  const descriptors = Object.fromEntries(['response', 'responseText', 'responseXML'].map(key =>
    [key, Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, key)]));
  const xhrStates = new WeakMap();
  const observedXhrs = new WeakSet();
  let observationSequence = 0;
  let activeStreamKey = null;
  const recovery = createRecoveryController({
    recordDiagnosticEvent,
    postRecovery: payload => window.postMessage({ type: 'PMR_QUALITY_ORIGINAL_STREAM_RECOVERY', payload }, location.origin)
  });

  function manifestResponse(url, contentType) {
    const request = classifyMediaRequest(url);
    return !request.isAd && !request.isAudio &&
      (isManifestUrl(url) || /dash\+xml|mpegurl/i.test(contentType || ''));
  }

  function selectManifest(text, url, config = getConfig()) {
    const result = parseManifest(text, url, config);
    if (!result.selection) return result;
    const streamKey = getStreamSession().key;
    if (streamKey && streamKey !== activeStreamKey) {
      activeStreamKey = streamKey;
      recovery.reset();
    }
    return result;
  }

  function reportPolicy(result, config) {
    if (result.selection) window.postMessage({
      type: 'PMR_QUALITY_POLICY_DATA', payload: { ...result.policy, config }
    }, location.origin);
  }

  function inspectFailure(url, status) {
    const request = classifyMediaRequest(url);
    if (request.kind === 'segment' && !request.isAd && !request.isAudio &&
      [400, 403, 404, 410, 416].includes(status)) recovery.requestRecovery(`media-http-${status}`);
  }

  function preserveResponseMetadata(response, original) {
    for (const key of ['url', 'redirected', 'type']) {
      Object.defineProperty(response, key, { value: original[key] });
    }
    Object.defineProperty(response, 'clone', { value() {
      return preserveResponseMetadata(Response.prototype.clone.call(this), original);
    } });
    return response;
  }

  async function inspectFetch(response, url) {
    if (!response.ok) { inspectFailure(url, response.status); return response; }
    if (response.status !== 200 || !manifestResponse(response.url || url, response.headers.get('content-type'))) return response;
    try {
      const config = { ...getConfig() };
      const body = response.clone().text();
      if (!config.forceMax && !config.forcedHeight) {
        // Auto returns at native fetch timing; discovery runs on a cloned body.
        body.then(text => reportPolicy(selectManifest(text, response.url || url, config), config)).catch(() => {});
        return response;
      }
      const result = selectManifest(await body, response.url || url, config);
      if (!result.changed) { reportPolicy(result, config); return response; }
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      const selected = new Response(result.text, { status: response.status, statusText: response.statusText, headers });
      // Relative URL resolution must also survive a player's response.clone().
      preserveResponseMetadata(selected, response);
      recovery.markApplied();
      reportPolicy(result, config);
      return selected;
    } catch (error) {
      recordDiagnosticEvent('manifest_selection_error', { errorName: error?.name || 'Error' });
      return response;
    }
  }

  window.fetch = async function (...args) {
    const sequence = ++observationSequence;
    const startedAt = diagnosticNow();
    // The resource, method, headers, body, credentials and abort signal stay native.
    const response = await originalFetch.apply(this, args);
    try {
      const resource = args[0];
      const url = response.url || (typeof resource === 'string' ? resource : resource?.url || String(resource));
      const request = classifyMediaRequest(url);
      const method = String(args[1]?.method || resource?.method || 'GET').toUpperCase();
      if (request.kind !== 'unknown') recordRequestAttempt({
        transport: 'fetch', category: request.kind, url, method, status: response.status,
        ok: response.ok, outcome: response.ok ? 'success' : 'http-error',
        durationMs: diagnosticNow() - startedAt
      });
      if (response.ok) analyzeUrl(url, { observationSequence: sequence });
      return method === 'GET' ? await inspectFetch(response, url) : response;
    } catch { return response; }
  };

  function xhrSelection(xhr, nativeValue) {
    try {
      const state = xhrStates.get(xhr);
      if (!state || state.method !== 'GET' || xhr.readyState !== 4 || xhr.status !== 200 ||
          !manifestResponse(xhr.responseURL || state.url, xhr.getResponseHeader('content-type'))) return nativeValue;
      if (state.values.has(nativeValue)) return state.values.get(nativeValue);
      let text;
      let format;
      if (typeof nativeValue === 'string') { text = nativeValue; format = 'text'; }
      else if (nativeValue instanceof ArrayBuffer) { text = new TextDecoder().decode(nativeValue); format = 'buffer'; }
      else if (nativeValue?.documentElement?.localName === 'MPD') {
        text = new XMLSerializer().serializeToString(nativeValue); format = 'xml';
      } else return nativeValue;
      // All getters see one selection, even if preferences change between reads.
      if (!state.result) {
        state.config = { ...getConfig() };
        state.result = selectManifest(text, xhr.responseURL || state.url, state.config);
      }
      const result = state.result;
      let selected = nativeValue;
      if (result.changed) {
        selected = format === 'text' ? result.text : format === 'buffer'
          ? new TextEncoder().encode(result.text).buffer
          : new DOMParser().parseFromString(result.text, 'application/xml');
        if (format === 'xml') {
          // A synthetic XML document would otherwise resolve relative URLs
          // against the page. Restore the response's inherited XML base.
          selected.documentElement.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:base', nativeValue.documentElement.baseURI);
        }
        recovery.markApplied();
      }
      state.values.set(nativeValue, selected);
      if (!state.reported) {
        state.reported = true;
        reportPolicy(result, state.config);
      }
      return selected;
    } catch { return nativeValue; }
  }

  function inspectXhr() {
    try {
      const state = xhrStates.get(this);
      if (!state || this.readyState !== 4 || state.recorded) return;
      state.recorded = true;
      const succeeded = this.status >= 200 && this.status < 300;
      const url = this.responseURL || state.url;
      const request = classifyMediaRequest(url);
      if (request.kind !== 'unknown') recordRequestAttempt({
        transport: 'xhr', category: request.kind, url, method: state.method,
        status: this.status, ok: succeeded, outcome: succeeded ? 'success' : 'http-error',
        durationMs: diagnosticNow() - state.startedAt
      });
      if (!succeeded) { inspectFailure(url, this.status); return; }
      analyzeUrl(url, { observationSequence: state.sequence });
    } catch { /* Diagnostics must not affect the player's listeners. */ }
  }

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    // Native open may abort an earlier request on this object. Let that finish
    // before installing the new request's state.
    const result = originalOpen.apply(this, [method, url, ...rest]);
    try {
      xhrStates.set(this, { url: String(url), method: String(method).toUpperCase(),
        startedAt: diagnosticNow(), sequence: ++observationSequence, recorded: false, values: new Map() });
      if (!observedXhrs.has(this)) {
        observedXhrs.add(this);
        const keys = Object.keys(descriptors);
        const installed = [];
        try {
          if (keys.some(key => !descriptors[key]?.get || Object.hasOwn(this, key))) throw new Error('Response getters unavailable');
          for (const key of keys) {
            const descriptor = descriptors[key];
            Object.defineProperty(this, key, { configurable: true, get() {
              const nativeValue = descriptor.get.call(this);
              return xhrSelection(this, nativeValue);
            } });
            installed.push(key);
          }
        } catch {
          for (const key of installed) delete this[key];
        }
        this.addEventListener('readystatechange', inspectXhr);
      }
    } catch { /* Observation failure leaves native requests intact. */ }
    return result;
  };

  document.addEventListener('error', event => {
    const video = event.target;
    if (video?.tagName === 'VIDEO' && video.error?.code >= 2) {
      recovery.requestRecovery(`video-error-${video.error.code}`);
    }
  }, true);
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'PMR_QUALITY_BUFFER_ERROR') return;
    const sourceUrl = event.data.payload?.sourceUrl;
    if (typeof sourceUrl === 'string' && Array.from(document.querySelectorAll('video')).some(video =>
      (video.currentSrc || video.src) === sourceUrl)) recovery.requestRecovery('video-buffer-error');
  });
}
