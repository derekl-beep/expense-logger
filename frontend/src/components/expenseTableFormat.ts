// Date-formatting helpers shared by ExpenseList and IncomeList (both render
// the same "sticky date header" mobile card grouping and the same compact
// desktop-table date column). Split out of ExpenseTable.jsx verbatim.

export const formatDate = (d: string): string =>
  new Date(d + "T00:00:00").toLocaleDateString("default", { month: "short", day: "numeric" });

export const formatSectionDate = (d: string): string => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (d === today) return "Today";
  if (d === yesterday) return "Yesterday";
  return new Date(d + "T00:00:00").toLocaleDateString("default", { weekday: "short", month: "short", day: "numeric" });
};

export const formatMonth = (ym: string): string => {
  const [year, month] = ym.split("-");
  return new Date(Number(year), Number(month) - 1).toLocaleString("default", { month: "long", year: "numeric" });
};
