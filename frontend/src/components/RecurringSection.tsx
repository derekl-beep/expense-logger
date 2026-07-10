import { ChevronDown } from "lucide-react";
import { CategoryBadge } from "@/components/CategoryVisuals";
import type { RecurringCharge } from "@/types";

export interface RecurringSectionProps {
  recurring: RecurringCharge[];
  // Only used to decide whether this section should hide on mobile while a
  // search is active — mirrors the original inline conditional exactly.
  searchQuery: string;
  // Lifted to the parent (rather than local state here) because this
  // component unmounts whenever the Expenses/Income toggle switches away
  // from Expenses — local state would silently reset on every tab switch.
  showRecurring: boolean;
  onToggleShowRecurring: () => void;
}

export default function RecurringSection({ recurring, searchQuery, showRecurring, onToggleShowRecurring }: RecurringSectionProps) {
  if (recurring.length === 0) return null;

  return (
    <div className={`px-4 py-3 md:px-5 border-b border-border/50 ${searchQuery ? "hidden md:block" : ""}`}>
      <button
        type="button"
        onClick={onToggleShowRecurring}
        className="flex items-center justify-between w-full text-left"
      >
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Recurring · {recurring.length}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${showRecurring ? "rotate-180" : ""}`} />
      </button>
      {showRecurring && (
        <div className="space-y-0.5 mt-2 -mx-1">
          {recurring.map((r) => (
            <div
              key={`${r.description}-${r.amount}`}
              className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-muted/50 transition-colors"
            >
              <CategoryBadge category={r.category} small loggedBy={undefined} onUserClick={undefined} userActive={undefined} />
              <span className="text-xs text-foreground flex-1 truncate">{r.description}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium bg-primary/10 text-primary shrink-0">
                {r.frequency[0].toUpperCase() + r.frequency.slice(1)}
              </span>
              <span className="text-xs font-semibold text-foreground tabular-nums shrink-0">${r.amount.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
