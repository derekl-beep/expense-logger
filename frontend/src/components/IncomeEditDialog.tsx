import { useState, type ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { Income, IncomeEditValues } from "@/types";

const valuesFromIncome = (income: Income | null): IncomeEditValues => ({
  amount: income?.amount ?? 0,
  category: income?.category ?? "",
  description: income?.description ?? "",
  date: income?.date ?? "",
});

export interface IncomeEditDialogProps {
  // The income entry currently being edited, or null/undefined when the
  // dialog is closed. Same open-derived-from-prop pattern as
  // ExpenseEditDialog, so Radix can still play its close animation.
  income: Income | null | undefined;
  categories: string[];
  onSave: (values: IncomeEditValues) => void;
  onDelete: () => void;
  onClose: () => void;
}

export default function IncomeEditDialog({ income, categories, onSave, onDelete, onClose }: IncomeEditDialogProps) {
  const normalizedIncome = income ?? null;
  const isOpen = !!normalizedIncome;
  const [values, setValues] = useState<IncomeEditValues>(() => valuesFromIncome(normalizedIncome));
  // Same resync-on-open-transition pattern as ExpenseEditDialog — see that
  // file's comment for the full reasoning (reopening the same row after a
  // cancelled edit must pick up current values, not the stale unsaved edit;
  // staying open or closing must not blow away in-progress typing or flash
  // fields empty during the close animation).
  const [wasOpen, setWasOpen] = useState(isOpen);

  if (isOpen && !wasOpen) {
    setValues(valuesFromIncome(normalizedIncome));
  }
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open: boolean) => { if (!open) onClose(); }}>
      <DialogContent
        className="sm:max-w-sm"
        onOpenAutoFocus={(e: Event) => {
          // Same rationale as ExpenseEditDialog: skip autofocusing the
          // Description input (avoids an immediate mobile keyboard pop),
          // but still move focus into the dialog itself.
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
      >
        <DialogHeader className={undefined}>
          <DialogTitle className="text-sm font-semibold">Edit Income</DialogTitle>
          <DialogDescription className="sr-only">Edit the details of this income entry</DialogDescription>
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
            <label className="text-xs text-muted-foreground mb-1 block">Amount</label>
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
          {normalizedIncome?.reimburses_expense_id && (
            <p className="text-xs text-muted-foreground">
              Repays {normalizedIncome.reimburses_expense_description} · ${normalizedIncome.reimburses_expense_amount!.toFixed(2)}.
              To change what this repays, ask in chat instead — this dialog doesn't edit that link.
            </p>
          )}
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
