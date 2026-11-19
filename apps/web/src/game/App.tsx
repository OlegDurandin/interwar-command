import { useEffect, useRef, useState } from 'react';
import init, { hex_distance } from '../../../../crates/game-wasm/pkg/game_wasm.js';
import { mountMap } from '../renderer/map';
import { useBackButton } from '../platform/useBackButton';
import type { Hex } from '../renderer/geometry';

let initialization: ReturnType<typeof init> | undefined;
export function initializeCore() {
  return initialization ??= init().catch((error: unknown) => {
    initialization = undefined;
    throw error;
  });
}

export function App() {
  useBackButton(() => location.assign(location.pathname + location.hash));
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Загрузка ядра…');
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<{ hex: Hex; distance: bigint }>();
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const controller = new AbortController();
    const { signal } = controller;
    async function start(container: HTMLDivElement) {
      let phase = 'загрузить ядро WebAssembly';
      try {
        await initializeCore();
        if (signal.aborted) return;
        phase = 'открыть карту WebGL';
        setStatus('Подготовка карты…');
        await mountMap(container, signal, hex => {
          setSelection({ hex, distance: hex_distance(hex.q, hex.r, 0, 0) });
        });
        if (!signal.aborted) setStatus('Карта готова');
      } catch (cause) {
        if (signal.aborted) return;
        controller.abort();
        setError(`Не удалось ${phase}. ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    void start(element);
    return () => controller.abort();
  }, []);

  return <main>
    <header><span className="emblem" aria-hidden="true">✥</span><h1>Interwar Command</h1><a className="map-link" href="./">Переправа →</a></header>
    <div className="layout">
      <section className="map-panel" aria-labelledby="map-title">
        <div className="map-title"><h2 id="map-title">Тестовая карта</h2><span>10 × 8</span></div>
        <div className="paper"><div className="canvas-host" ref={host} />
          <span className="north" aria-hidden="true">С<br/>↑</span>
        </div>
        <div className="map-footer" role={error ? 'alert' : 'status'}>{error || status}</div>
      </section>
      <aside>
        <section className="selection" aria-live="polite">
          <h2>Выбранная клетка</h2>
          <p className="coordinate" data-testid="coordinates">{selection ? `(${selection.hex.q}, ${selection.hex.r})` : '—'}</p>
          <dl><dt>Расстояние до (0, 0)</dt><dd data-testid="distance">{selection?.distance.toString() ?? '—'}</dd></dl>
        </section>
        <section><h2>Условные знаки</h2><ul className="legend">
          <li><i className="plain"/>Равнина</li><li><i className="forest"/>Лес</li>
          <li><i className="hill"/>Холмы</li><li><i className="water"/>Вода</li>
        </ul></section>
        <section><h2>Управление</h2><dl className="controls">
          <dt>Щелчок</dt><dd>Выбор клетки</dd><dt>Перетаскивание</dt><dd>Панорама</dd>
          <dt>Колесо мыши</dt><dd>Масштаб</dd>
        </dl></section>
      </aside>
    </div>
  </main>;
}
