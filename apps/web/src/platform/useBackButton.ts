import { useLayoutEffect, useRef } from 'react';
import { platform } from './index';

export function useBackButton(handler: (() => void) | null) {
  const current = useRef(handler);
  useLayoutEffect(() => { current.current = handler; });
  const visible = handler !== null;
  useLayoutEffect(() => {
    platform.setBackButton(visible ? () => current.current?.() : null);
    return () => platform.setBackButton(null);
  }, [visible]);
}
