// Adapted from Paramount Quality+ (ISC). See NOTICE.md.
import { consumePendingConfig, initConfigListener } from './config.js';
import { analyzeUrl } from './url-analysis.js';
import { parseManifest } from './manifest-parser.js';
import { initNetworkHooks } from './network-hooks.js';
import { initDiagnostics } from './diagnostics.js';

if (!window.__PMR_QUALITY_ENGINE__) {
  window.__PMR_QUALITY_ENGINE__ = true;
  consumePendingConfig();
  initConfigListener();
  initDiagnostics();
  initNetworkHooks({ analyzeUrl, parseManifest });
}
