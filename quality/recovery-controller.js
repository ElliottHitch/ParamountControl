// Local recovery for failures after a modified manifest reached the player.
import { getConfig, setConfig } from './state.js';

export function createRecoveryController({ postRecovery, recordDiagnosticEvent }) {
  let applied = false;
  let requested = false;
  function markApplied() { applied = true; }
  function requestRecovery(detail) {
    const config = getConfig();
    if (!applied || requested || (!config.forceMax && !config.forcedHeight)) return false;
    requested = true;
    setConfig({});
    recordDiagnosticEvent('quality_recovery', { detail });
    postRecovery({ detail });
    return true;
  }
  function reset() { applied = false; requested = false; }
  return { markApplied, requestRecovery, reset };
}
