import { cn } from "@/lib/utils";

interface AppIconProps {
  /** Application name; its first letter is the fallback when no icon resolves. */
  name: string;
  /** PNG data URL from useAppIcons / useAppIcon, or null for the letter fallback. */
  icon?: string | null;
  size?: "sm" | "md";
  className?: string;
}

/** The app's real macOS icon when available, otherwise a letter avatar (styles: .app-avatar). */
export function AppIcon({ name, icon, size = "md", className }: AppIconProps) {
  return (
    <span
      className={cn("app-avatar", size === "sm" && "is-small", icon && "has-icon", className)}
      aria-hidden="true"
    >
      {icon ? <img src={icon} alt="" draggable={false} /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}
