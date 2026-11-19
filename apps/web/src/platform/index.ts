import { edges, hasTelegramHost, loadTelegram, type TelegramApp } from './telegram';
import { hasVkHost } from './vk';
import type { VkHost } from './vk/bridge';

const positive = (n?: number) => typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;

export class PlatformAdapter {
  private app?: TelegramApp;
  private vk?: VkHost;
  private initialized = false;
  private suspended = false;
  private hostActive = true;
  private active = true;
  private readonly activity = new EventTarget();
  private back: (() => void) | null = null;
  private mapGestures = false;
  private restoreSwipes = false;

  init() {
    if (this.initialized) return;
    this.initialized = true;
    document.documentElement.dataset.platform = this.getEnvironment();
    document.addEventListener('visibilitychange', this.updateActivity);
    const suspend = () => { this.suspended = true; this.updateActivity(); };
    const resume = () => { this.suspended = false; this.updateActivity(); };
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', resume);
    document.addEventListener('freeze', suspend);
    document.addEventListener('resume', resume);
    this.updateActivity();
    if (hasTelegramHost()) loadTelegram(app => this.connect(app));
    else if (hasVkHost()) {
      void import('./vk/bridge').then(({loadVk}) => loadVk(host => {
        if (!this.vk) {
          window.addEventListener('resize', this.updateViewport);
          host.setBackButton(this.back);
        }
        this.vk = host;
        document.documentElement.dataset.platform = this.getEnvironment();
        this.hostActive = host.active;
        this.updateViewport();
        this.updateActivity();
      })).catch(() => { /* The standalone UI is already running. */ });
    }
  }

  getEnvironment() { return this.app ? 'telegram' : this.vk ? 'vk' : 'standalone'; }

  getViewport() {
    if (this.vk) {
      const height = Math.min(positive(this.vk.height) || window.innerHeight, window.innerHeight);
      return {height, stableHeight:height, safeArea:this.vk.insets, contentSafeArea:undefined};
    }
    const app = this.app;
    const height = positive(app?.viewportHeight) || window.innerHeight;
    return { height, stableHeight:positive(app?.viewportStableHeight) || height,
      safeArea:app?.safeAreaInset, contentSafeArea:app?.contentSafeAreaInset };
  }

  private updateViewport = () => {
    const viewport = this.getViewport();
    const style = document.documentElement.style;
    style.setProperty('--host-height', viewport.stableHeight + 'px');
    for (const edge of edges) {
      style.setProperty('--host-safe-' + edge, positive(viewport.safeArea?.[edge]) + 'px');
      style.setProperty('--host-content-' + edge, positive(viewport.contentSafeArea?.[edge]) + 'px');
    }
  };

  private connect(app: TelegramApp) {
    this.app = app;
    document.documentElement.dataset.platform = this.getEnvironment();
    app.onEvent?.('viewportChanged', this.updateViewport);
    window.addEventListener('resize', this.updateViewport);
    if (app.isVersionAtLeast?.('8.0')) {
      app.onEvent?.('safeAreaChanged', this.updateViewport);
      app.onEvent?.('contentSafeAreaChanged', this.updateViewport);
      app.onEvent?.('deactivated', () => { this.hostActive = false; this.updateActivity(); });
      app.onEvent?.('activated', () => {
        this.hostActive = true;
        this.updateViewport();
        this.updateActivity();
      });
      this.hostActive = app.isActive !== false;
    }
    if (app.isVersionAtLeast?.('6.1') && app.BackButton) {
      app.onEvent?.('backButtonClicked', () => { if (this.isActive()) this.back?.(); });
      this.setBackButton(this.back);
    }
    this.updateViewport();
    this.updateActivity();
    this.setMapGestures(this.mapGestures);
    app.ready();
    app.expand?.();
  }

  isActive() { return this.hostActive && !this.suspended && !document.hidden; }

  private updateActivity = () => {
    const active = this.isActive();
    if (active === this.active) return;
    this.active = active;
    this.activity.dispatchEvent(new Event(active ? 'resume' : 'pause'));
  };

  onPause(handler: () => void, signal: AbortSignal) {
    this.activity.addEventListener('pause', handler, {signal});
  }
  onResume(handler: () => void, signal: AbortSignal) {
    this.activity.addEventListener('resume', handler, {signal});
  }

  setBackButton(handler: (() => void) | null) {
    this.back = handler;
    this.vk?.setBackButton(handler);
    const app = this.app;
    if (!app?.isVersionAtLeast?.('6.1') || !app.onEvent) return;
    if (handler) app.BackButton?.show?.();
    else app.BackButton?.hide?.();
  }

  setMapGestures(enabled: boolean) {
    this.mapGestures = enabled;
    const app = this.app;
    if (!app?.isVersionAtLeast?.('7.7') || !app.disableVerticalSwipes || !app.enableVerticalSwipes) return;
    if (enabled && !this.restoreSwipes && app.isVerticalSwipesEnabled !== false) {
      app.disableVerticalSwipes();
      this.restoreSwipes = true;
    } else if (!enabled && this.restoreSwipes) {
      app.enableVerticalSwipes();
      this.restoreSwipes = false;
    }
  }
}

export const platform = new PlatformAdapter();
