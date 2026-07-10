import { useState, type ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Split } from "lucide-react";
import type { Expense, EditValues } from "@/types";

const valuesFromExpense = (expense: Expense | null): EditValues => ({
  amount: expense?.amount ?? 0,
  category: expense?.category ?? "",
  description: expense?.description ?? "",
  date: expense?.date ?? "",
  flagged: !!expense?.flagged,
});

export interface ExpenseEditDialogProps {
  // The expense currently being edited, or null/undefined when the dialog
  // is closed. The Dialog itself stays mounted regardless (open is derived
  // from this) so Radix can still play its close animation.
  expense: Expense | null | undefined;
  categories: string[];
  onSave: (values: EditValues) => void;
  onDelete: () => void;
  onClose: () => void;
}

export default function ExpenseEditDialog({ expense, categories, onSave, onDelete, onClose }: ExpenseEditDialogProps) {
  const normalizedExpense = expense ?? null;
  const isOpen = !!normalizedExpense;
  const [values, setValues] = useState<EditValues>(() => valuesFromExpense(normalizedExpense));
  // Tracks whether the dialog was open on the previous render, so form state
  // resyncs on every *transition* into open — not just when a different
  // expense object reference comes in. Re-opening the same row after a
  // cancelled edit (no save happened, so `items` and this object reference
  // are unchanged) must still pick up its current values, not the stale
  // unsaved edit from last time. Staying open across re-renders, or going
  // back to null on close, deliberately does NOT resync — the former would
  // blow away in-progress typing, the latter would flash the fields empty
  // while the dialog is still playing its exit animation.
  const [wasOpen, setWasOpen] = useState(isOpen);

  if (isOpen && !wasOpen) {
    setValues(valuesFromExpense(normalizedExpense));
  }
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open: boolean) => { if (!open) onClose(); }}>
      <DialogContent
        className="sm:max-w-sm"
        onOpenAutoFocus={(e: Event) => {
          // Same rationale as BudgetDialog: skip autofocusing the
          // Description input (avoids an immediate mobile keyboard pop),
          // but still move focus into the dialog itself rather than
          // leaving it stranded on the now-inert trigger behind the modal.
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
      >
        <DialogHeader className={undefined}>
          <DialogTitle className="text-sm font-semibold">Edit Expense</DialogTitle>
          <DialogDescription className="sr-only">Edit the details of this expense</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Description</label>
            <Input value={values.description ?? ""} className="h-9 text-base md:text-sm" type={undefined}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setValues({ ...values, description: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Date</label>
            <Input type="date" value={values.date ?? ""} className="h-9 text-base md:text-sm"
              onChange={(e: ChangeEvent<HTMLInputElement>) => setValues({ ...values, date: e.target.value })} />
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <label className="text-xs text-muted-foreground mb-1 block">Amount</label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title="Split this expense"
                    aria-label="Split this expense"
                    className="w-6 h-6 flex items-center justify-center rounded border border-border text-muted-foreground outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 transition-colors"
                  >
                    <Split className="w-3.5 h-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className={undefined}>
                  {[2, 3, 4].map((n) => (
                    <DropdownMenuItem
                      key={n}
                      className="text-xs cursor-pointer"
                      inset={undefined}
                      onClick={() => setValues((v) => {
                        const amt = v.amount;
                        return Number.isFinite(amt) ? { ...v, amount: Math.round((amt / n) * 100) / 100 } : v;
                      })}
                    >
                      Split {["½", "⅓", "¼"][n - 2]} ({n} ways)
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <Input type="number" inputMode="decimal" step="0.01" value={values.amount ?? ""} className="h-9 text-base md:text-sm"
              onChange={(e: ChangeEvent<HTMLInputElement>) => setValues({ ...values, amount: parseFloat(e.target.value) })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Category</label>
            <Select value={values.category} onValueChange={(v: string) => setValues({ ...values, category: v })}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent className={undefined}>
                {values.category && !categories.includes(values.category) && (
                  <SelectItem value={values.category} className={undefined}>{values.category} (unrecognized)</SelectItem>
                )}
                {categories.map((c) => <SelectItem key={c} value={c} className={undefined}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <button
            type="button"
            onClick={() => setValues({ ...values, flagged: !values.flagged })}
            className={`flex items-center gap-2 text-xs px-3 py-2 rounded-md border w-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 transition-colors ${
              values.flagged
                ? "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700 focus-visible:border-amber-500"
                : "border-border text-muted-foreground hover:bg-muted focus-visible:border-ring"
            }`}
          >
            <span>⚑</span>
            <span>{values.flagged ? "Flagged for follow-up" : "Flag for follow-up"}</span>
          </button>
        </div>
        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <Button variant="destructive" size="sm" className="text-xs" onClick={onDelete}>Delete</Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="text-xs" onClick={onClose}>Cancel</Button>
            <Button size="sm" className="text-xs" onClick={() => onSave(values)}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
