import { useRef, useState, type MouseEvent, type ReactNode, type TouchEvent } from "react";
import { Flag, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { CategoryBadge } from "@/components/CategoryVisuals";
import { formatDate, formatSectionDate } from "@/components/expenseTableFormat";
import type { Expense } from "@/types";

const ExpenseSkeleton = () => (
  <div className="px-4 py-3 space-y-3">
    {[0, 1, 2, 3, 4].map((i) => (
      <div key={i} className="h-12 rounded-md bg-muted animate-pulse" />
    ))}
  </div>
);

const SWIPE_MAX = 88;
const SWIPE_THRESHOLD = 64;

interface SwipeableRowProps {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  children: ReactNode;
}

const SwipeableRow = ({ onSwipeLeft, onSwipeRight, children }: SwipeableRowProps) => {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ x: 0, y: 0 });
  const axisRef = useRef<"x" | "y" | null>(null);

  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY };
    axisRef.current = null;
    setDragging(false);
  };

  const onTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    const deltaX = t.clientX - startRef.current.x;
    const deltaY = t.clientY - startRef.current.y;

    if (axisRef.current === null && (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8)) {
      axisRef.current = Math.abs(deltaX) > Math.abs(deltaY) ? "x" : "y";
    }
    if (axisRef.current !== "x") return;

    setDragging(true);
    const clamped = Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, deltaX));
    setDx(clamped);
  };

  const onTouchEnd = () => {
    if (dx >= SWIPE_THRESHOLD) onSwipeRight?.();
    else if (dx <= -SWIPE_THRESHOLD) onSwipeLeft?.();
    setDragging(false);
    setDx(0);
  };

  const pastRight = dx >= SWIPE_THRESHOLD;
  const pastLeft = dx <= -SWIPE_THRESHOLD;

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-0 flex items-stretch justify-between">
        <div
          className={`flex items-center justify-start pl-4 text-white transition-colors duration-150 ${pastRight ? "bg-amber-600" : "bg-amber-500"}`}
          style={{ width: SWIPE_MAX }}
        >
          <Flag
            className="w-4 h-4 transition-transform duration-150"
            style={{ transform: pastRight ? "scale(1.4)" : "scale(1)" }}
          />
        </div>
        <div
          className="flex items-center justify-end pr-4 bg-destructive text-destructive-foreground transition-colors duration-150"
          style={{ width: SWIPE_MAX, filter: pastLeft ? "brightness(1.25)" : "none" }}
        >
          <Trash2
            className="w-4 h-4 transition-transform duration-150"
            style={{ transform: pastLeft ? "scale(1.4)" : "scale(1)" }}
          />
        </div>
      </div>
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? "none" : "transform 200ms ease-out",
          touchAction: "pan-y",
        }}
        className="relative bg-background"
      >
        {children}
      </div>
    </div>
  );
};

export interface ExpenseListProps {
  loading: boolean;
  filtered: Expense[];
  emptyMessage: string;
  highlightIds?: Set<number>;
  userFilter: string | null;
  onUserFilterToggle: (user: string) => void;
  onEdit: (expense: Expense) => void;
  onToggleFlag: (expense: Expense, ev?: MouseEvent) => void;
  onDelete: (id: number) => void;
}

export default function ExpenseList({
  loading,
  filtered,
  emptyMessage,
  highlightIds,
  userFilter,
  onUserFilterToggle,
  onEdit,
  onToggleFlag,
  onDelete,
}: ExpenseListProps) {
  const [deleteConfirm, setDeleteConfirm] = useState<Expense | null>(null);

  const confirmSwipeDelete = () => {
    if (deleteConfirm) onDelete(deleteConfirm.id);
    setDeleteConfirm(null);
  };

  const groupedByDate = filtered.reduce<{ date: string; items: Expense[] }[]>((groups, e) => {
    const last = groups[groups.length - 1];
    if (!last || last.date !== e.date) groups.push({ date: e.date, items: [e] });
    else last.items.push(e);
    return groups;
  }, []);

  return (
    <>
      {/* Swipe-to-delete confirmation — mobile only */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open: boolean) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader className={undefined}>
            <DialogTitle className="text-sm font-semibold">Delete Expense</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground py-1">
              Delete "{deleteConfirm?.description}" — ${deleteConfirm?.amount.toFixed(2)}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" className="text-xs" onClick={confirmSwipeDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Mobile card list ── */}
      <div className="md:hidden">
        {loading ? (
          <ExpenseSkeleton />
        ) : filtered.length === 0 ? (
          <p className="text-center py-16 text-muted-foreground text-sm">{emptyMessage}</p>
        ) : groupedByDate.map(({ date, items }) => (
          <div key={date}>
            <div className="px-4 py-1.5 bg-muted/60 sticky top-0 z-10 border-b border-border/50">
              <span className="text-xs font-medium text-muted-foreground">{formatSectionDate(date)}</span>
            </div>
            {items.map((e) => (
              <SwipeableRow key={e.id} onSwipeRight={() => onToggleFlag(e)} onSwipeLeft={() => setDeleteConfirm(e)}>
                <div
                  className={`flex items-center gap-3 px-4 py-3 border-b border-border/50 active:bg-muted transition-colors cursor-pointer ${highlightIds?.has(e.id) ? "row-highlight" : ""}`}
                  onClick={() => onEdit(e)}
                >
                  <CategoryBadge
                    category={e.category}
                    small
                    loggedBy={e.logged_by}
                    onUserClick={(u: string) => onUserFilterToggle(u)}
                    userActive={userFilter === e.logged_by}
                  />
                  <span className="flex-1 text-sm font-medium text-foreground truncate">{e.description}</span>
                  {e.reimbursed && (
                    <span title="Reimbursed" className="text-[10px] px-1.5 py-0.5 rounded-md font-medium bg-primary/10 text-primary shrink-0">
                      Reimbursed
                    </span>
                  )}
                  <span className="text-sm font-semibold text-foreground tabular-nums shrink-0">${e.amount.toFixed(2)}</span>
                  <button
                    onClick={(ev) => onToggleFlag(e, ev)}
                    aria-label={e.flagged ? "Unflag expense" : "Flag expense"}
                    className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-sm transition-colors ${
                      e.flagged ? "text-amber-500 dark:text-amber-400" : "text-muted-foreground/30 hover:text-amber-500"
                    }`}
                  >⚑</button>
                </div>
              </SwipeableRow>
            ))}
          </div>
        ))}
      </div>

      {/* ── Desktop table ── */}
      <table className="w-full text-sm border-collapse hidden md:table">
        <thead className="sticky top-0 bg-background z-10">
          <tr className="border-b border-border">
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide w-16">Date</th>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</th>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide w-28">Category</th>
            <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide w-20">Amount</th>
            <th className="w-10"></th>
            <th className="w-10"></th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={6}><ExpenseSkeleton /></td></tr>
          ) : filtered.length === 0 ? (
            <tr><td colSpan={6} className="text-center py-16 text-muted-foreground text-sm">{emptyMessage}</td></tr>
          ) : filtered.map((e) => (
            <tr key={e.id}
              className={`border-b border-border/50 hover:bg-muted/50 cursor-pointer group transition-colors ${highlightIds?.has(e.id) ? "row-highlight" : ""}`}
              onClick={() => onEdit(e)}
            >
              <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{formatDate(e.date)}</td>
              <td className="px-3 py-3 text-sm text-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span>{e.description}</span>
                  {e.reimbursed && (
                    <span title="Reimbursed" className="text-[10px] px-1.5 py-0.5 rounded-md font-medium bg-primary/10 text-primary shrink-0">
                      Reimbursed
                    </span>
                  )}
                </span>
              </td>
              <td className="px-3 py-3">
                <CategoryBadge
                  category={e.category}
                  loggedBy={e.logged_by}
                  onUserClick={(u: string) => onUserFilterToggle(u)}
                  userActive={userFilter === e.logged_by}
                />
              </td>
              <td className="px-3 py-3 text-right text-sm font-medium text-foreground tabular-nums">${e.amount.toFixed(2)}</td>
              <td className="py-3 px-1">
                <button
                  onClick={(ev) => onToggleFlag(e, ev)}
                  aria-label={e.flagged ? "Unflag expense" : "Flag expense"}
                  className={`w-9 h-9 flex items-center justify-center rounded-md text-sm transition-all ${
                    e.flagged
                      ? "text-amber-500 dark:text-amber-400"
                      : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-amber-500"
                  }`}
                >⚑</button>
              </td>
              <td className="py-3 px-1">
                <button
                  className="opacity-0 group-hover:opacity-100 w-9 h-9 flex items-center justify-center rounded-md text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                  onClick={(ev) => { ev.stopPropagation(); onDelete(e.id); }}
                  aria-label="Delete expense"
                >✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
