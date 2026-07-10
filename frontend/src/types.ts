// Shapes shared across the ExpenseTable split (ExpenseTable.tsx and its
// extracted sub-components). Mirrors what agent/db.py's row-builder queries
// actually select (see get_expenses / get_income / get_recurring_charges /
// get_budgets) — only the fields the UI reads, not the full DB row.

export interface Expense {
  id: number;
  amount: number;
  category: string;
  description: string;
  date: string;
  flagged: boolean;
  // Nullable: get_expenses() LEFT JOINs users on a nullable user_id column,
  // so an orphaned/missing user produces a null username, not an absent key.
  logged_by: string | null;
  reimbursed: boolean;
}

export interface Income {
  id: number;
  amount: number;
  category: string;
  description: string;
  date: string;
  // Nullable for the same reason as Expense.logged_by (get_income() LEFT
  // JOINs the same nullable user_id column).
  logged_by: string | null;
  reimburses_expense_id: number | null;
  reimburses_expense_description: string | null;
  reimburses_expense_amount: number | null;
}

export interface RecurringCharge {
  description: string;
  amount: number;
  category: string;
  frequency: string;
}

export interface Budget {
  category: string;
  monthly_limit: number;
}

export interface BreakdownEntry {
  category: string;
  amount: number;
  count: number;
  pct: number;
  barPct: number;
  limit?: number;
}

// Editable fields on an expense — used by ExpenseEditDialog's local form
// state and by the parent's save handler that diffs against the original.
export interface EditValues {
  amount: number;
  category: string;
  description: string;
  date: string;
  flagged: boolean;
}

// authFetch: injects the bearer token and triggers onUnauthorized on 401.
export type AuthFetch = (url: string, opts?: RequestInit) => Promise<Response>;
