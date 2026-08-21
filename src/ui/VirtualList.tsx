import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

type Props<T> = {
  items: T[];
  /** Hauteur estimée d’une ligne (px), inclut le gap. */
  estimateSize?: number;
  overscan?: number;
  className?: string;
  style?: CSSProperties;
  getKey: (item: T, index: number) => string;
  children: (item: T, index: number) => ReactNode;
  /** Sous ce seuil, pas de virtualisation (évite le coût sur petites listes). */
  threshold?: number;
};

/**
 * Liste fenêtre — rendu des lignes visibles seulement.
 * Hauteur fixe estimée (OK pour dossiers genre ~uniformes).
 */
export function VirtualList<T>({
  items,
  estimateSize = 84,
  overscan = 8,
  className = "",
  style,
  getKey,
  children,
  threshold = 28,
}: Props<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) {
      return;
    }
    const measure = () => setViewport(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length]);

  if (items.length <= threshold) {
    return (
      <div ref={parentRef} className={className} style={style} role="list">
        {items.map((item, index) => (
          <div key={getKey(item, index)} className="virt-row is-static" role="listitem">
            {children(item, index)}
          </div>
        ))}
      </div>
    );
  }

  const total = items.length * estimateSize;
  const start = Math.max(0, Math.floor(scrollTop / estimateSize) - overscan);
  const visible = Math.ceil((viewport || 400) / estimateSize) + overscan * 2;
  const end = Math.min(items.length, start + visible);
  const slice = items.slice(start, end);

  return (
    <div
      ref={parentRef}
      className={`${className} is-virtual`.trim()}
      style={style}
      role="list"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="virt-spacer" style={{ height: total }}>
        {slice.map((item, i) => {
          const index = start + i;
          return (
            <div
              key={getKey(item, index)}
              className="virt-row"
              role="listitem"
              style={{
                top: index * estimateSize,
                height: estimateSize,
              }}
            >
              {children(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
