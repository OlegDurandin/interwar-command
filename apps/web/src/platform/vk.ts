const webOrigins = new Set(['https://vk.com', 'https://m.vk.com', 'https://vk.ru', 'https://m.vk.ru']);

export function hasVkHost(): boolean {
  const host = window as Window & {
    AndroidBridge?: { VKWebAppInit?: unknown };
    webkit?: { messageHandlers?: { VKWebAppClose?: object; VKWebAppInit?: { postMessage?: unknown } } };
    ReactNativeWebView?: { postMessage?: unknown };
  };
  if (typeof host.AndroidBridge?.VKWebAppInit === 'function') return true;
  const ios = host.webkit?.messageHandlers;
  if (ios?.VKWebAppClose && typeof ios.VKWebAppInit?.postMessage === 'function') return true;
  // The React Native transport is shared with other apps. Require VK launch context as well.
  const params = new URLSearchParams(location.search);
  if (typeof host.ReactNativeWebView?.postMessage === 'function' &&
      /^\d+$/.test(params.get('vk_app_id') ?? '') && params.has('vk_platform')) return true;
  if (window.parent === window) return false;
  try { return webOrigins.has(new URL(location.ancestorOrigins?.[0] || document.referrer).origin); }
  catch { return false; }
}
