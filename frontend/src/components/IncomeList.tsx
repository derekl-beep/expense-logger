import { CategoryBadge } from "@/components/CategoryVisuals";
import { formatDate, formatSectionDate } from "@/components/expenseTableFormat";
import type { Income } from "@/types";

export interface IncomeListProps {
  income: Income[];
}

// Read-only Phase 1 income view — no edit/delete UI yet.
export default function IncomeList({ income }: IncomeListProps) {
  const groupedByDate = income.reduce<{ date: string; items: Income[] }[]>((groups, i) => {
    const last = groups[groups.length - 1];
    if (!last || last.date !== i.date) groups.push({ date: i.date, items: [i] });
    else last.items.push(i);
    return groups;
  }, []);

  return (
    <>
      {/* ── Income mobile card list — read-only Phase 1, no swipe/edit/delete ── */}
      <div className="md:hidden">
        {income.length === 0 ? (
          <p className="text-center py-16 text-muted-foreground text-sm">No income yet</p>
        ) : groupedByDate.map(({ date, items }) => (
          <div key={date}>
            <div className="px-4 py-1.5 bg-muted/60 sticky top-0 z-10 border-b border-border/50">
              <span className="text-xs font-medium text-muted-foreground">{formatSectionDate(date)}</span>
            </div>
            {items.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
                <CategoryBadge category={i.category} small loggedBy={undefined} onUserClick={undefined} userActive={undefined} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-foreground truncate">{i.description}</span>
                  {i.reimburses_expense_id && (
                    <span className="block text-xs text-muted-foreground truncate">
                      repays {i.reimburses_expense_description} · ${i.reimburses_expense_amount!.toFixed(2)}
                    </span>
                  )}
                </span>
                <span className="text-sm font-semibold text-foreground tabular-nums shrink-0">${i.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ── Income desktop table — read-only Phase 1, no edit/delete ── */}
      <table className="w-full text-sm border-collapse hidden md:table">
        <thead className="sticky top-0 bg-background z-10">
          <tr className="border-b border-border">
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide w-16">Date</th>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</th>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide w-28">Category</th>
            <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide w-20">Amount</th>
          </tr>
        </thead>
        <tbody>
          {income.length === 0 ? (
            <tr><td colSpan={4} className="text-center py-16 text-muted-foreground text-sm">No income yet</td></tr>
          ) : income.map((i) => (
            <tr key={i.id} className="border-b border-border/50">
              <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{formatDate(i.date)}</td>
              <td className="px-3 py-3 text-sm text-foreground">
                <span>{i.description}</span>
                {i.reimburses_expense_id && (
                  <span className="block text-xs text-muted-foreground">
                    repays {i.reimburses_expense_description} · ${i.reimburses_expense_amount!.toFixed(2)}
                  </span>
                )}
              </td>
              <td className="px-3 py-3"><CategoryBadge category={i.category} loggedBy={undefined} onUserClick={undefined} userActive={undefined} /></td>
              <td className="px-3 py-3 text-right text-sm font-medium text-foreground tabular-nums">${i.amount.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
