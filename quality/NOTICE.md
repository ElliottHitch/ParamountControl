# Quality engine attribution

Except for the locally written `bitrate-meter.js`, the JavaScript modules in
this directory are adapted from
[Paramount Quality+](https://github.com/Chaseos/ParamountQualityPlus), by Chaseos / Chaseos Apps.
Upstream commit: `444d7f309c275d2651d9995293c22f132e95b3f0`.
The upstream `package.json` declares the ISC license.

Local changes namespace the page bridge, remove geolocation requests, unused
entry-point exports, and retry/prefetch features, and add a remembered bitrate
preference within the selected resolution. All advertised bitrate variants are
exposed to the popup, and selection keeps the player's compatibility boundaries.
The popup design, menu toggle, and byte-count/media-duration bitrate meter are
local implementations. The upstream popup, styles, and promotional assets are
not included. Local fixes also preserve same-resolution HLS bitrate variants and
register XHR observation listeners once per request object.

## ISC license

Copyright (c) Chaseos / Chaseos Apps

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
