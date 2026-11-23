import { useRef, type ReactNode } from "react";
import { formatCents } from "../lib/format";
import { copy } from "../lib/copy";
import { activeCouriers, missionReceipt, prefersReducedMotion, type Courier } from "../lib/war-extras";
import type { WarTableState } from "../lib/war-table";

export function ReceiptCard({ state }: { state: WarTableState }) {
  const receipt = missionReceipt(state);
  if (!receipt) return null;
  const t = copy.receipt;
  return (
    <section className="receipt" aria-labelledby="receipt-title">
      <h2 id="receipt-title">{t.title}</h2>
      <ul>
        <li>{t.shipped(receipt.shipped)}</li>
        <li>{t.held(receipt.held)}</li>
        <li>{t.failed(receipt.failed)}</li>
        <li>{t.blocked(receipt.blocked)}</li>
        <li>{t.touches(receipt.touches)}</li>
        <li>{t.spent(formatCents(receipt.spent_cents))}</li>
      </ul>
    </section>
  );
}

export function CourierLayer({ state }: { state: WarTableState }) {
  const couriers = activeCouriers(state);
  if (couriers.length === 0) return null;
  const reduce = prefersReducedMotion();
  return (
    <div className={`courier-layer${reduce ? " reduce-motion" : ""}`} aria-live="polite">
      {couriers.map((c) => (
        <CourierMarker key={`${c.unitId}:${c.questionId ?? ""}`} courier={c} />
      ))}
    </div>
  );
}

function CourierMarker({ courier }: { courier: Courier }) {
  const label = courier.direction === "to-hq" ? copy.courier.toHq : copy.courier.fromHq;
  return (
    <div
      className={`courier ${courier.direction}`}
      role="img"
      aria-label={`${label}: ${courier.unitId}`}
      title={label}
    />
  );
}

export function DecisionDrawer({
  open,
  onToggle,
  children,
  count,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  count: number;
}) {
  const d = copy.drawer;
  const toggle = useRef<HTMLButtonElement>(null);
  return (
    <aside
      className={`decision-drawer${open ? " open" : ""}`}
      aria-label={copy.held.title}
      onKeyDown={(e) => {
        // Escape closes the drawer and keeps keyboard focus on its button instead of losing it with the content.
        if (e.key === "Escape" && open) {
          onToggle();
          toggle.current?.focus();
        }
      }}
    >
      <button ref={toggle} type="button" className="drawer-toggle" onClick={onToggle} aria-expanded={open}>
        {open ? d.close : d.open}
        {count > 0 ? ` (${count})` : ""}
      </button>
      {open && <div className="drawer-body">{children ?? <p className="muted">{d.empty}</p>}</div>}
    </aside>
  );
}
