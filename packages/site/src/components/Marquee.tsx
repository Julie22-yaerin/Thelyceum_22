import type { CSSProperties } from "react";

export type MarqueeItem = {
  label: string;
  style: CSSProperties;
};

type MarqueeProps = {
  items: MarqueeItem[];
  trackClassName: string;
  itemClassName: string;
};

export default function Marquee({ items, trackClassName, itemClassName }: MarqueeProps) {
  const doubled = [...items, ...items];
  return (
    <div className={trackClassName}>
      {doubled.map((item, i) => (
        <span key={i} className={itemClassName} style={item.style}>
          {item.label}
        </span>
      ))}
    </div>
  );
}
