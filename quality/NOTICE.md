# Quality engine attribution

Manifest discovery, stream classification, configuration, and diagnostics in
this directory contain code adapted from
[Paramount Quality+](https://github.com/Chaseos/ParamountQualityPlus), by Chaseos / Chaseos Apps.
Upstream commit: `444d7f309c275d2651d9995293c22f132e95b3f0`.
The upstream `package.json` declares the ISC license.

The popup design, menu toggle, page bridge, manifest selection policy, transport
hooks, recovery controller, and byte-count/media-duration bitrate meter are local
implementations. The upstream popup, styles, and promotional assets are not
included.

The current engine selects only advertised video entries in DASH manifests and
HLS master playlists. It preserves media URLs and separates codec, protection,
AdaptationSet, and HLS rendition groups. Guessed VOD ladders and media request
rewriting have been removed. Fatal media failures after a selection can trigger
one Auto reload; the local bridge remembers the fallback for that title.
There are no geolocation requests, extension download retries, or speculative
prefetches. All advertised bitrate variants remain available to the local popup.

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
