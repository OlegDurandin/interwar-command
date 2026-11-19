import bridge, { type Insets, type ParentConfigData, type VKBridgeSubscribeHandler } from '@vkontakte/vk-bridge';

export interface VkHost {
  active: boolean;
  height?: number;
  insets?: Insets;
  setBackButton(handler: (() => void) | null): void;
}

// Android Back traverses WebView history. Keep one same-document entry while an
// in-game Back action exists, even if it changes from dismissing a card to leaving the map.
function installNavigation() {
  let back: (() => void) | null = null;
  let removingEntry = false;
  let useHistory = true;
  let swipe: ((root: boolean) => void) | undefined;
  let lastRoot: boolean | undefined;
  function sync() {
    const root = back === null;
    if (swipe && root !== lastRoot) { lastRoot = root; swipe(root); }
    if (!useHistory || removingEntry) return;
    try {
      if (!root && !history.state?.interwarVkBack) {
        history.pushState({...history.state, interwarVkBack:true}, '');
      } else if (root && history.state?.interwarVkBack) {
        removingEntry = true;
        history.back();
      }
    } catch {
      // Restricted WebViews may deny history changes. Screen navigation remains available.
      useHistory = false;
    }
  }
  window.addEventListener('popstate', () => {
    const wasRemoval = removingEntry;
    removingEntry = false;
    if (!wasRemoval && !history.state?.interwarVkBack) back?.();
    // Let the screen commit its new callback before deciding whether another Back is possible.
    window.setTimeout(sync, 0);
  });
  return {
    setBackButton(handler: (() => void) | null) { back = handler; queueMicrotask(sync); },
    enableSwipe(send: (root: boolean) => void) { swipe = send; sync(); },
  };
}

export async function loadVk(update: (host: VkHost) => void) {
  let connected = false;
  const host: VkHost = {active:true, setBackButton:() => {}};
  function applyConfig(data: ParentConfigData, initial = false) {
    if ('insets' in data && data.insets && (!initial || !host.insets)) host.insets = data.insets;
    if ('viewport_height' in data && (!initial || host.height === undefined)) host.height = data.viewport_height;
  }
  // Some clients publish their initial configuration before acknowledging Init.
  const onEvent: VKBridgeSubscribeHandler = ({detail}) => {
    switch (detail.type) {
      case 'VKWebAppUpdateConfig': applyConfig(detail.data); break;
      case 'VKWebAppUpdateInsets': host.insets = detail.data.insets; break;
      case 'VKWebAppViewHide': host.active = false; break;
      case 'VKWebAppViewRestore': host.active = true; break;
      default: return;
    }
    if (connected) update(host);
  };
  bridge.subscribe(onEvent);
  try {
    // The UI remains standalone while the handshake is pending, including on slow clients.
    const result = await bridge.send('VKWebAppInit');
    if (result?.result !== true) throw new Error('VK init was not acknowledged');
  } catch (error) {
    bridge.unsubscribe(onEvent);
    throw error;
  }

  const nav = installNavigation();
  host.setBackButton = nav.setBackButton;
  connected = true;
  update(host);
  // Both enhancements are optional and can be rejected independently by the client.
  void bridge.supportsAsync('VKWebAppGetConfig').then(async supported => {
    if (!supported) return;
    applyConfig(await bridge.send('VKWebAppGetConfig'), true);
    update(host);
  }).catch(() => {});
  void bridge.supportsAsync('VKWebAppSetSwipeSettings').then(supported => {
    if (supported) nav.enableSwipe(root => {
      void bridge.send('VKWebAppSetSwipeSettings', {history:root}).catch(() => {});
    });
  }).catch(() => {});
}
