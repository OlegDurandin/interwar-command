export const edges = ['top', 'right', 'bottom', 'left'] as const;
type Insets = Partial<Record<typeof edges[number], number>>;
type HostEvent = 'viewportChanged' | 'safeAreaChanged' | 'contentSafeAreaChanged'
  | 'activated' | 'deactivated' | 'backButtonClicked';

export interface TelegramApp {
  ready(): void;
  expand?(): void;
  isVersionAtLeast?(version: string): boolean;
  readonly viewportHeight?: number;
  readonly viewportStableHeight?: number;
  readonly safeAreaInset?: Insets;
  readonly contentSafeAreaInset?: Insets;
  readonly isActive?: boolean;
  readonly isVerticalSwipesEnabled?: boolean;
  BackButton?: { show(): void; hide(): void };
  disableVerticalSwipes?(): void;
  enableVerticalSwipes?(): void;
  onEvent?(name: HostEvent, handler: () => void): void;
}

interface TelegramWindow extends Window {
  Telegram?: { WebApp?: TelegramApp };
  TelegramWebviewProxy?: { postEvent?: unknown };
}

// Presence of a host transport selects UI capabilities only. Launch parameters are not credentials.
export function hasTelegramHost(): boolean {
  const host: TelegramWindow = window;
  if (typeof host.TelegramWebviewProxy?.postEvent === 'function') return true;
  const external = window.external as (External & { notify?: unknown }) | undefined;
  if (typeof external?.notify === 'function' &&
      (host.Telegram?.WebApp || new URLSearchParams(location.hash.slice(1)).has('tgWebAppVersion'))) return true;
  if (window.parent === window) return false;
  const parentOrigin = location.ancestorOrigins?.[0] || document.referrer;
  try { return new URL(parentOrigin).origin === 'https://web.telegram.org'; }
  catch { return false; }
}

export function loadTelegram(connect: (app: TelegramApp) => void) {
  const host: TelegramWindow = window;
  function attach() {
    const app = host.Telegram?.WebApp;
    if (app && typeof app.ready === 'function') connect(app);
  }
  if (host.Telegram?.WebApp) { attach(); return; }
  const script = document.createElement('script');
  script.src = 'https://telegram.org/js/telegram-web-app.js?65';
  script.async = true;
  script.referrerPolicy = 'no-referrer';
  script.addEventListener('load', attach, {once:true});
  document.head.append(script);
}
