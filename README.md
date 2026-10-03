# Paramount Control+

Unofficial browser extension for Chrome and Edge with a popup for the Paramount+
playback menu, streaming quality, and bitrate.

## What it does

- **Hide playback menu:** on by default. Removes only `skin-sidebar-plugin` and
  `skin-sidebar-plugin show`, including dynamically inserted menus and class
  changes. Elements with any extra class are left alone. Turning it off restores
  detached menus still belonging to the active page, including their listeners.
- **Current playback:** shows decoded video resolution when available, with a
  labeled estimate otherwise. Bitrate uses stream metadata when available. If
  that metadata is missing, a local meter estimates bitrate from the byte count
  and media duration of recent buffered video segments. Estimates carry `≈` and
  a source label; combined video/audio buffers are identified. This measures
  media bitrate, not download speed. The meter starts with the page and waits
  for newly buffered segments, so refresh after installing or updating.
- **Quality preference:** Auto, Keep sharp, or Manual. Keep sharp requests the
  highest supported representation. Manual reveals resolution and bitrate
  dropdowns populated by the current stream.
- **Bitrate:** choose one of the stream's advertised bitrates at your selected
  resolution, or the highest bitrate at that resolution. If a later title offers
  different bitrates, the closest compatible bitrate is selected. A missing saved
  resolution leaves playback in Auto until it becomes available.
- Preferences are stored locally and applied to Paramount+ tabs in this browser
  profile. Readouts update once per second only while the popup is open.
- **Dark mode:** switches the popup between light and dark palettes and remembers
  the choice. This changes the extension popup's appearance only.
- A rejected quality override falls back to the original request when safe. If
  the player already accepted incompatible initialization data, recovery reloads
  once in Auto for that session. The popup explains the fallback.

## Install

1. Open `chrome://extensions` or `edge://extensions`.
2. Turn on Developer mode
3. Click **Load unpacked** and select this repository folder.
4. For an existing installation, click **Reload** on the extension instead.
5. Refresh Paramount+ so the updated quality controller loads before playback.
6. Click the extension's toolbar icon. In an Edge-installed Paramount+ app, use
   the app's **… → Extensions** menu in the same Edge profile.

## Use

Start a video, open the popup, and select **Keep sharp** to keep quality
high. To choose a specific combination, select **Manual**,
then use the Resolution and Bitrate dropdowns. Only qualities supplied by the
current stream are listed. Changes may take 10–20 seconds while buffered video
clears; changing a live stream's quality may reload playback once.

The menu switch takes effect on open Paramount+ pages without refreshing them.
The **Reload player** button refreshes the active Paramount+ page on demand.

Quality availability depends on the title, subscription, region, browser/device,
and DRM support. The extension cannot guarantee HD or bypass access controls.
If forcing quality causes playback errors, switch back to Auto and reload
the player. Avoid running another quality-forcing extension alongside this one.

## Files

- `manifest.json` - extension setup
- `content.js` - reversible, exact-class menu removal
- `popup.html`, `popup.css`, `popup.js` - popup controls and live stream readouts
- `quality-bridge.js` - local preferences, player telemetry, and recovery
- `quality/bitrate-meter.js` - locally written, event-driven media bitrate estimate
- `quality/` - adapted DASH/HLS quality-control engine; see
  [attribution and license](quality/NOTICE.md)

## Permissions

Uses `storage` and access to `paramountplus.com` / `www.paramountplus.com` only.
Quality selection inspects and adjusts eligible video requests made by that
page. Ads, audio, subtitles, thumbnails, and unsupported requests are excluded
from quality rewriting. The Paramount+ player handles retries; speculative
prefetching is not included.
There are no analytics, external scripts, or automatic location requests.
The bitrate meter observes byte counts and buffered time ranges; it does not
read video payloads or make additional media requests.

## Disclaimer

This project is unofficial and is not affiliated with, endorsed by, or associated with Paramount or Paramount+.
