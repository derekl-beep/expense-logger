import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { CATEGORY_ICONS, CATEGORY_COLORS, CATEGORY_BAR_COLORS, userColor, useAnimatedNumber } from "@/lib/categoryVisuals";

// Shared between ExpenseTable (the live list) and Chat (rich rendering of
// tool output like get_category_breakdown) so both surfaces stay visually
// identical without duplicating markup.

export const UserDot = ({ loggedBy, onUserClick, userActive, className = "" }) => (
  <button
    type="button"
    title={loggedBy}
    onClick={(ev) => { ev.stopPropagation(); onUserClick?.(loggedBy); }}
    className={`w-3.5 h-3.5 rounded-full ring-2 ring-background flex items-center justify-center text-[8px] font-bold text-white leading-none ${userColor(loggedBy)} ${userActive ? "ring-foreground" : ""} ${className}`}
  >
    {loggedBy[0].toUpperCase()}
  </button>
);

export const CategoryBadge = ({ category, small = false, loggedBy, onUserClick, userActive }) => {
  const Icon = CATEGORY_ICONS[category];
  if (small) {
    return (
      <span className="relative inline-flex shrink-0">
        <span
          title={category}
          className={`inline-flex items-center rounded font-medium p-1.5 ${CATEGORY_COLORS[category] ?? "bg-muted text-muted-foreground"}`}
        >
          {Icon && <Icon className="size-3.5" />}
          <span className="sr-only">{category}</span>
        </span>
        {loggedBy && (
          <UserDot loggedBy={loggedBy} onUserClick={onUserClick} userActive={userActive} className="absolute -bottom-1 -right-1" />
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 shrink-0">
      <span
        title={category}
        className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md font-medium ${CATEGORY_COLORS[category] ?? "bg-muted text-muted-foreground"}`}
      >
        {Icon && <Icon className="size-3" />}
        {category}
      </span>
      {loggedBy && <UserDot loggedBy={loggedBy} onUserClick={onUserClick} userActive={userActive} />}
    </span>
  );
};

export const BreakdownRow = ({ category, amount, count, pct, barPct, limit, maxCategoryTotal, active, onClick }) => {
  const animatedAmount = useAnimatedNumber(amount);
  const animatedPct = useAnimatedNumber(pct);

  const hasBudget = limit != null && maxCategoryTotal > 0;
  const linePct = hasBudget ? (limit / maxCategoryTotal) * 100 : null;
  const showLine = hasBudget && linePct <= 100;
  const usedPct = hasBudget && limit > 0 ? (amount / limit) * 100 : 0;
  const overBudget = hasBudget && amount > limit;

  const statusLevel = !hasBudget ? "none" : usedPct > 100 ? "over" : usedPct >= 80 ? "near" : "ok";
  const lineColor = statusLevel === "over" ? "bg-red-500" : statusLevel === "near" ? "bg-amber-500" : "bg-foreground/50";
  const amountColor = statusLevel === "over"
    ? "text-red-600 dark:text-red-400"
    : statusLevel === "near"
    ? "text-amber-600 dark:text-amber-400"
    : "text-foreground";

  const baseFillPct = overBudget ? linePct : barPct;
  const overFillPct = overBudget ? barPct - linePct : 0;

  const tooltipText = hasBudget
    ? `$${amount.toFixed(2)} of $${limit.toFixed(2)} budget (${usedPct.toFixed(0)}%) — ${count} transaction${count === 1 ? "" : "s"}`
    : `$${amount.toFixed(2)} across ${count} transaction${count === 1 ? "" : "s"}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={`flex items-center gap-2 w-full text-left rounded-md -mx-1 px-1 py-0.5 transition-colors ${
            active ? "bg-muted" : "hover:bg-muted/50"
          }`}
        >
          <CategoryBadge category={category} small />
          <span className="text-xs text-foreground w-24 md:w-32 truncate">{category}</span>
          <div className="relative flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out ${CATEGORY_BAR_COLORS[category] ?? "bg-foreground/40"}`}
              style={{ width: `${baseFillPct}%` }}
            />
            {overBudget && (
              <div
                className="absolute inset-y-0 rounded-r-full bg-red-500 transition-[width,left] duration-300 ease-out"
                style={{ left: `${linePct}%`, width: `${overFillPct}%` }}
              />
            )}
            {showLine && (
              <div
                className={`absolute inset-y-0 w-px transition-[left,background-color] duration-300 ease-out ${lineColor}`}
                style={{ left: `${linePct}%` }}
              />
            )}
          </div>
          <span className="text-xs tabular-nums text-muted-foreground w-9 text-right">{animatedPct.toFixed(0)}%</span>
          <span className={`text-xs font-medium tabular-nums w-14 text-right transition-colors ${amountColor}`}>${animatedAmount.toFixed(0)}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltipText}</TooltipContent>
    </Tooltip>
  );
};
