import { BreakdownRow } from "@/components/CategoryVisuals";
import BudgetDialog from "@/components/BudgetDialog";
import type { AuthFetch, BreakdownEntry } from "@/types";

export interface CategoryBreakdownProps {
  breakdown: BreakdownEntry[];
  maxCategoryTotal: number;
  categoryFilter: string | null;
  onCategoryClick: (category: string) => void;
  categories: string[];
  budgetMap: Record<string, number>;
  spendByCategory?: Record<string, number>;
  authFetch: AuthFetch;
  onBudgetSaved: () => void;
  // Lifted to the parent (rather than local state here) because this
  // component unmounts whenever the Expenses/Income toggle switches away
  // from Expenses — local state would silently reset on every tab switch.
  showAllCategories: boolean;
  onToggleShowAllCategories: () => void;
}

export default function CategoryBreakdown({
  breakdown,
  maxCategoryTotal,
  categoryFilter,
  onCategoryClick,
  categories,
  budgetMap,
  spendByCategory,
  authFetch,
  onBudgetSaved,
  showAllCategories,
  onToggleShowAllCategories,
}: CategoryBreakdownProps) {
  if (breakdown.length === 0) return null;

  return (
    <div className="px-4 py-3 md:px-5 border-b border-border/50">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Breakdown</div>
        <BudgetDialog
          categories={categories}
          budgetMap={budgetMap}
          spendByCategory={spendByCategory}
          authFetch={authFetch}
          onSaved={onBudgetSaved}
        />
      </div>
      <div className="space-y-1.5">
        {(showAllCategories ? breakdown : breakdown.slice(0, 5)).map(({ category, amount, count, pct, barPct, limit }) => (
          <BreakdownRow
            key={category}
            category={category}
            amount={amount}
            count={count}
            pct={pct}
            barPct={barPct}
            limit={limit}
            maxCategoryTotal={maxCategoryTotal}
            active={categoryFilter === category}
            onClick={() => onCategoryClick(category)}
          />
        ))}
      </div>
      {breakdown.length > 5 && (
        <button
          onClick={onToggleShowAllCategories}
          className="text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors"
        >
          {showAllCategories ? "View less" : `View ${breakdown.length - 5} more`}
        </button>
      )}
    </div>
  );
}
