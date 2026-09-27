import { useLayoutEffect, useRef, useState } from 'react';
import { visibleDayCount } from './dates';

export function useCalendarWidth() {
  const container = useRef<HTMLDivElement>(null);
  const [dayCount, setDayCount] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    let timer: number | undefined;
    const measure = () => {
      const style = getComputedStyle(element);
      const width = element.clientWidth;
      if (width <= 0) return;
      setDayCount(visibleDayCount(width - 2,
        parseFloat(style.getPropertyValue('--instructor-width')) || 180,
        parseFloat(style.getPropertyValue('--day-min-width')) || 32));
    };
    measure();
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(measure, 120);
    });
    observer.observe(element);
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, []);
  return { container, dayCount };
}
