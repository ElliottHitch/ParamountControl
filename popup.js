const DEFAULTS = {
  removeMenu: true,
  darkMode: false,
  qualityMode: "auto",
  preferredHeight: null,
  preferredBandwidth: null
};
const ui = Object.fromEntries([
  "menu-toggle", "dark-mode-toggle", "connection", "resolution", "bitrate", "stats-source",
  "quality-mode", "manual-option", "manual-controls", "preferred-height",
  "preferred-bandwidth", "quality-hint", "notice", "reload-player"
].map((id) => [id, document.getElementById(id)]));
const qualityModes = Array.from(document.querySelectorAll('input[name="quality-mode"]'));
const QUALITY_KEYS = ["qualityMode", "preferredHeight", "preferredBandwidth"];
const BITRATE_DESCRIPTIONS = {
  stream: "Bitrate reported by the stream.",
  manifest: "Bitrate advertised for this resolution.",
  "media-estimate": "Bitrate estimated from recent video segments.",
  "media-audio-estimate": "Bitrate estimate includes the stream's audio."
};
let settings = { ...DEFAULTS };
let qualities = [];
let activeTabId = null;
let connected = false;
let saving = false;
let loaded = false;
let pollTimer = null;
let optionSignature = null;
let feedback = "";
let feedbackUntil = 0;
let closed = false;

function mbps(bitsPerSecond) {
  return `${(bitsPerSecond / 1000000).toFixed(2)} Mbps`;
}

function showNotice(message) {
  ui.notice.textContent = message;
  ui.notice.hidden = !message;
}

function setFeedback(message) {
  feedback = message;
  feedbackUntil = Date.now() + 20000;
  showNotice(message);
}

function closestBandwidth(candidates, bandwidth) {
  if (!bandwidth || !candidates.length) return null;
  return candidates.reduce((closest, quality) =>
    Math.abs(quality.bandwidth - bandwidth) < Math.abs(closest.bandwidth - bandwidth)
      ? quality : closest).bandwidth;
}

function renderControls() {
  ui["menu-toggle"].checked = settings.removeMenu !== false;
  ui["dark-mode-toggle"].checked = settings.darkMode === true;
  document.documentElement.dataset.theme = settings.darkMode === true ? "dark" : "light";
  for (const mode of qualityModes) mode.checked = mode.value === settings.qualityMode;
  ui["manual-controls"].hidden = settings.qualityMode !== "manual";
  ui["manual-option"].disabled = !qualities.length;
  const signature = JSON.stringify([qualities, settings.preferredHeight, settings.preferredBandwidth]);
  if (signature === optionSignature) return;
  optionSignature = signature;

  const heights = [...new Set(qualities.map((quality) => quality.height))];
  const heightOptions = heights.map((height) => new Option(`${height}p`, String(height)));
  if (settings.preferredHeight && !heights.includes(settings.preferredHeight)) {
    const unavailable = new Option(`${settings.preferredHeight}p unavailable (saved)`, String(settings.preferredHeight));
    unavailable.disabled = true;
    heightOptions.push(unavailable);
  }
  ui["preferred-height"].replaceChildren(...heightOptions);
  ui["preferred-height"].value = settings.preferredHeight ? String(settings.preferredHeight) : String(heights[0] || "");
  ui["preferred-height"].disabled = !heights.length || saving;

  const candidates = qualities.filter((quality) => quality.height === settings.preferredHeight);
  const bandwidths = [...new Set(candidates.map((quality) => quality.bandwidth))];
  ui["preferred-bandwidth"].replaceChildren(
    new Option("Highest offered", ""),
    ...bandwidths.map((bandwidth) => new Option(mbps(bandwidth), String(bandwidth)))
  );
  const closest = closestBandwidth(candidates, settings.preferredBandwidth);
  ui["preferred-bandwidth"].value = closest ? String(closest) : "";
  ui["preferred-bandwidth"].disabled = !candidates.length || saving;
}

function renderPlayback(state) {
  ui.connection.textContent = state.injectionError ? "Player controls unavailable" :
    state.playbackDetected ? "Connected to player" : "Waiting for playback";
  ui.connection.dataset.state = state.injectionError ? "error" : "connected";
  ui.resolution.textContent = state.resolution ? `${state.estimated ? "≈ " : ""}${state.resolution}` : "—";
  const measured = state.bitrateSource === "media-estimate" || state.bitrateSource === "media-audio-estimate";
  ui.bitrate.textContent = state.bitrate
    ? `${measured ? "≈ " : ""}${mbps(state.bitrate * 1000)}`
    : state.playbackDetected ? "Measuring…" : "Waiting";
  ui.bitrate.dataset.pending = String(!state.bitrate);
  const bitrateDescription = BITRATE_DESCRIPTIONS[state.bitrateSource];
  ui["stats-source"].textContent = state.injectionError
    ? "Refresh the page to reconnect stream details."
    : bitrateDescription
      ? `${state.decoded ? "" : "Resolution from stream data. "}${bitrateDescription}`
      : state.playbackDetected ? "Measuring bitrate as new video segments arrive." : "Start a video to see stream details.";
  ui["reload-player"].disabled = false;
}

function renderQualityStatus(state) {
  let message = "";
  if (state.injectionError) message = "The quality controller could not load. Reload the Paramount+ page to retry.";
  else if (state.recovering) message = "Playback failed after a quality change. Auto is active for this title. Select Auto, then your preferred mode to retry.";
  else if (settings.qualityMode === "manual" && qualities.length && !state.manualAvailable) {
    message = `This stream does not offer ${settings.preferredHeight}p. Playing in Auto; your preference is saved.`;
  } else if (settings.qualityMode === "manual" && !qualities.length) {
    message = "Waiting for the available qualities. Playback stays in Auto until your saved resolution is offered.";
  } else if (settings.qualityMode !== "auto" && ["unsupported", "malformed"].includes(state.policy?.reason)) {
    message = "This stream does not expose compatible quality choices. Its original player settings are preserved.";
  } else if (settings.qualityMode !== "auto" && state.policy?.reason === "partial") {
    message = "Your preference applies to compatible video tracks. Other tracks keep their original choices.";
  } else if (settings.qualityMode !== "auto" && state.policy?.reason === "auto") {
    message = "Reload the player to apply your saved quality preference.";
  } else if (settings.qualityMode !== "auto" && state.policy?.reason === "waiting") {
    message = "Waiting for a compatible stream manifest. Your preference is saved.";
  } else if (Date.now() < feedbackUntil) message = feedback;
  showNotice(message);
  const modeHint = settings.qualityMode === "max"
    ? "Keep sharp selects the highest compatible quality advertised by this stream."
    : settings.qualityMode === "manual"
      ? "Choose from this stream's available resolutions and bitrates."
      : "Auto lets the player adapt to your connection.";
  ui["quality-hint"].textContent = `${modeHint} Changing quality reloads playback once.`;
}

function renderState(state) {
  connected = true;
  if (!saving) settings = { ...settings, ...state.settings };
  qualities = state.qualities || [];
  renderPlayback(state);
  renderControls();
  renderQualityStatus(state);
}

function renderDisconnected() {
  connected = false;
  qualities = [];
  ui.connection.textContent = "Open or refresh Paramount+";
  ui.connection.dataset.state = "waiting";
  ui.resolution.textContent = "—";
  ui.bitrate.textContent = "Waiting";
  ui.bitrate.dataset.pending = "true";
  ui["stats-source"].textContent = "Start a video to see stream details.";
  ui["reload-player"].disabled = true;
  renderControls();
  showNotice("Preferences are saved for Paramount+. Refresh its page after reloading the extension.");
}

async function refreshState() {
  if (activeTabId === null || saving) return;
  try {
    const state = await chrome.tabs.sendMessage(activeTabId, { type: "PMR_GET_STATE" });
    if (!saving) state ? renderState(state) : renderDisconnected();
  } catch {
    if (!saving) renderDisconnected();
  }
}

async function poll() {
  await refreshState();
  if (!closed) pollTimer = setTimeout(poll, 1000);
}

async function saveQuality(next) {
  if (!loaded || saving) return;
  saving = true;
  const previous = Object.fromEntries(QUALITY_KEYS.map((key) => [key, settings[key]]));
  settings = { ...settings, ...next };
  ui["quality-mode"].disabled = true;
  ui["preferred-height"].disabled = true;
  ui["preferred-bandwidth"].disabled = true;
  try {
    const selected = {
      qualityMode: settings.qualityMode,
      preferredHeight: settings.preferredHeight,
      preferredBandwidth: settings.preferredBandwidth
    };
    await chrome.storage.local.set(selected);
    if (activeTabId !== null && connected) {
      try {
        const response = await chrome.tabs.sendMessage(activeTabId, {
          type: "PMR_APPLY_QUALITY", settings: selected, reloadPlayback: true
        });
        setFeedback(response?.reloading
          ? "Reloading playback with your selected quality."
          : "Quality saved for the next playback.");
      } catch {
        setFeedback("Quality saved. Refresh Paramount+ to apply it to this player.");
      }
    } else setFeedback("Quality saved for the next Paramount+ playback.");
  } catch {
    settings = { ...settings, ...previous };
    setFeedback("Could not save the preference. Reload the extension and try again.");
  } finally {
    saving = false;
    optionSignature = null;
    ui["quality-mode"].disabled = false;
    renderControls();
    await refreshState();
  }
}

ui["menu-toggle"].disabled = true;
ui["dark-mode-toggle"].disabled = true;
ui["quality-mode"].disabled = true;

function bindPreferenceToggle(id, key, errorMessage) {
  const control = ui[id];
  control.addEventListener("change", async () => {
    if (!loaded) return;
    const previous = settings[key];
    settings[key] = control.checked;
    control.disabled = true;
    renderControls();
    try {
      await chrome.storage.local.set({ [key]: settings[key] });
    } catch {
      settings[key] = previous;
      renderControls();
      setFeedback(errorMessage);
    } finally {
      control.disabled = false;
    }
  });
}

bindPreferenceToggle("menu-toggle", "removeMenu", "Could not save the menu preference.");
bindPreferenceToggle("dark-mode-toggle", "darkMode", "Could not save the appearance preference.");

ui["quality-mode"].addEventListener("change", (event) => {
  const qualityMode = event.target.value;
  if (qualityMode === "manual") {
    const preferredHeight = qualities.some((quality) => quality.height === settings.preferredHeight)
      ? settings.preferredHeight : qualities[0]?.height;
    if (!preferredHeight) return;
    void saveQuality({ qualityMode, preferredHeight, preferredBandwidth: null });
  } else void saveQuality({ qualityMode, preferredHeight: null, preferredBandwidth: null });
});

ui["preferred-height"].addEventListener("change", () => {
  void saveQuality({ qualityMode: "manual", preferredHeight: Number(ui["preferred-height"].value), preferredBandwidth: null });
});
ui["preferred-bandwidth"].addEventListener("change", () => {
  void saveQuality({ qualityMode: "manual", preferredBandwidth: Number(ui["preferred-bandwidth"].value) || null });
});
ui["reload-player"].addEventListener("click", async () => {
  if (activeTabId === null || !connected) return;
  ui["reload-player"].disabled = true;
  try {
    await chrome.tabs.sendMessage(activeTabId, { type: "PMR_RELOAD_PLAYER" });
    setFeedback("Reloading Paramount+ playback…");
  } catch {
    setFeedback("Refresh the Paramount+ page to reload playback.");
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const key of Object.keys(DEFAULTS)) {
    if (saving && QUALITY_KEYS.includes(key)) continue;
    if (key in changes) settings[key] = changes[key].newValue ?? DEFAULTS[key];
  }
  renderControls();
});
window.addEventListener("pagehide", () => {
  closed = true;
  clearTimeout(pollTimer);
}, { once: true });

(async () => {
  try {
    settings = await chrome.storage.local.get(DEFAULTS);
    loaded = true;
    ui["menu-toggle"].disabled = false;
    ui["dark-mode-toggle"].disabled = false;
    ui["quality-mode"].disabled = false;
    renderControls();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id ?? null;
    if (activeTabId === null) renderDisconnected();
    else void poll();
  } catch {
    ui.connection.textContent = "Extension unavailable";
    ui.connection.dataset.state = "error";
    showNotice("Reload the extension to reconnect its controls.");
  }
})();
