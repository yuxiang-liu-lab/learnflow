"use strict";
const QA_BUILD_VERSION = '0.6.1';

function qaCreateMessaging(onUnavailable, readRuntime = () => globalThis.chrome?.runtime) {
  let unavailable = false;
  function contextError() {
    const error = new Error('Extension reloaded or disconnected. Reload this Cengage tab to reconnect LearnFlow.');
    error.code = 'CONTEXT_UNAVAILABLE';
    return error;
  }
  function stop() {
    if (!unavailable) {unavailable = true; onUnavailable(contextError());}
  }
  function runtime() {
    try {
      const value = readRuntime();
      if (value?.id && typeof value.sendMessage === 'function') return value;
    } catch { /* An invalidated isolated world can throw on API access. */ }
    stop();
    return null;
  }
  return {
    check() {return !unavailable && !!runtime();},
    async send(message) {
      if (unavailable) throw contextError();
      const api = runtime();
      if (!api) throw contextError();
      try {
        const result = await api.sendMessage({...message, clientVersion:QA_BUILD_VERSION});
        if (!runtime()) throw contextError();
        if (result?.error?.code === 'CONTEXT_STALE') {stop(); throw contextError();}
        return result;
      } catch (cause) {
        if (/extension context invalidated/i.test(cause?.message || '') || !runtime()) {
          stop(); throw contextError();
        }
        // A temporary worker/port failure is retryable, not a dead context.
        throw cause;
      }
    }
  };
}
