import { useEffect, useRef, useState } from "react";
import {
  Car, Home, Package, Plane, UtensilsCrossed, Coffee, ShoppingCart, Sofa,
  Film, SprayCan, HeartPulse, Shirt, Phone, Bus, Fuel, Sparkles, Zap, Repeat,
} from "lucide-react";

// Shared between ExpenseTable (the live list) and Chat (rich rendering of
// tool output like get_category_breakdown) so both surfaces stay visually
// identical without duplicating the category -> icon/color mappings.

export const CATEGORY_ICONS = {
  "Driving": Car,
  "Rent": Home,
  "Settling Down": Package,
  "Travel": Plane,
  "Dining": UtensilsCrossed,
  "Drinks": Coffee,
  "Groceries": ShoppingCart,
  "Furniture": Sofa,
  "Entertainment": Film,
  "Household": SprayCan,
  "Health": HeartPulse,
  "Clothing": Shirt,
  "Telecom": Phone,
  "Transport": Bus,
  "Gas": Fuel,
  "Beauty": Sparkles,
  "Hydro": Zap,
  "Subscription": Repeat,
};

export const CATEGORY_COLORS = {
  "Dining":        "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  "Drinks":        "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
  "Groceries":     "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  "Transport":     "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  "Driving":       "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400",
  "Gas":           "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400",
  "Travel":        "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400",
  "Clothing":      "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400",
  "Beauty":        "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-400",
  "Entertainment": "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400",
  "Subscription":  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  "Health":        "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  "Household":     "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400",
  "Furniture":     "bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-400",
  "Rent":          "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  "Hydro":         "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  "Telecom":       "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  "Settling Down": "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400",
};

export const CATEGORY_BAR_COLORS = {
  "Dining":        "bg-green-500",
  "Drinks":        "bg-purple-500",
  "Groceries":     "bg-emerald-500",
  "Transport":     "bg-blue-500",
  "Driving":       "bg-sky-500",
  "Gas":           "bg-cyan-500",
  "Travel":        "bg-teal-500",
  "Clothing":      "bg-violet-500",
  "Beauty":        "bg-pink-500",
  "Entertainment": "bg-orange-500",
  "Subscription":  "bg-amber-500",
  "Health":        "bg-red-500",
  "Household":     "bg-yellow-500",
  "Furniture":     "bg-lime-500",
  "Rent":          "bg-zinc-500",
  "Hydro":         "bg-slate-500",
  "Telecom":       "bg-gray-500",
  "Settling Down": "bg-indigo-500",
};

const USER_DOT_COLORS = ["bg-blue-500", "bg-pink-500", "bg-emerald-500", "bg-amber-500", "bg-violet-500"];

export const userColor = (username) => {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
  return USER_DOT_COLORS[hash % USER_DOT_COLORS.length];
};

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export function useAnimatedNumber(value, duration = 350) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef(null);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    const start = performance.now();

    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const current = from + (value - from) * easeOutCubic(t);
      fromRef.current = current;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
        setDisplay(value);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return display;
}
