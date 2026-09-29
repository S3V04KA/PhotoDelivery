import type { CSSProperties, ReactNode } from 'react';

export interface TabItem<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly icon: ReactNode;
}

interface TabsProps<T extends string> {
  readonly items: readonly TabItem<T>[];
  readonly active: T;
  readonly onChange: (id: T) => void;
  /** Screen-reader label for the tab strip. */
  readonly label: string;
}

export function Tabs<T extends string>({ items, active, onChange, label }: TabsProps<T>) {
  const activeIndex = items.findIndex((item) => item.id === active);

  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((item) => {
        const selected = item.id === active;

        return (
          <button
            key={item.id}
            className="tabs__tab"
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onChange(item.id);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
                return;
              }

              event.preventDefault();

              const offset = event.key === 'ArrowRight' ? 1 : -1;
              const next = items[(activeIndex + offset + items.length) % items.length];

              if (next !== undefined) {
                onChange(next.id);
                document.getElementById(`tab-${next.id}`)?.focus();
              }
            }}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}

      <span
        className="tabs__indicator"
        aria-hidden="true"
        style={{ '--tab-index': Math.max(0, activeIndex) } as CSSProperties}
      />
    </div>
  );
}
