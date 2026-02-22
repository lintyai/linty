import { useEffect } from "react";
import { useAppStore } from "@/store/app.store";

const MEDIA_QUERY = "(prefers-color-scheme: dark)";

function resolveTheme(preference: string, systemIsDark: boolean): "dark" | "light" {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return systemIsDark ? "dark" : "light";
}

export function useTheme() {
  const theme = useAppStore((s) => s.theme);

  useEffect(() => {
    const mq = window.matchMedia(MEDIA_QUERY);
    const apply = () => {
      const resolved = resolveTheme(theme, mq.matches);
      document.documentElement.setAttribute("data-theme", resolved);
    };

    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}
