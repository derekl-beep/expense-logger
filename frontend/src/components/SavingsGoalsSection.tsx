import type { SavingsGoal } from "@/types";
import { formatDate } from "@/components/expenseTableFormat";

export interface SavingsGoalsSectionProps {
  goals: SavingsGoal[];
}

// Read-only for now, matching how income shipped its first phase — creating
// and contributing to a goal happens via chat (create_savings_goal /
// contribute_to_savings_goal), not a dialog here yet.
export default function SavingsGoalsSection({ goals }: SavingsGoalsSectionProps) {
  if (goals.length === 0) return null;

  return (
    <div className="px-4 py-3 md:px-5 border-b border-border/50">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
        Savings Goals
      </div>
      <div className="space-y-2.5">
        {goals.map((g) => (
          <div key={g.id}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-foreground truncate">{g.name}</span>
              <span className="text-muted-foreground tabular-nums shrink-0">
                ${g.current_amount.toFixed(2)} / ${g.target_amount.toFixed(2)}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${g.pct_complete}%` }}
              />
            </div>
            {g.target_date && (
              <div className="text-[10px] text-muted-foreground mt-1">
                Target: {formatDate(g.target_date)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
