import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 py-16 px-8",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] bg-bg-elevated text-text-muted shadow-[var(--shadow-sm)] ring-1 ring-border-subtle animate-fade-in">
        {icon}
      </div>
      <div className="flex flex-col items-center gap-1.5 text-center animate-slide-up" style={{ animationDelay: "60ms", animationFillMode: "both" }}>
        <h3 className="text-[13px] font-medium text-text-secondary">
          {title}
        </h3>
        <p className="max-w-[240px] text-[12px] leading-relaxed text-text-muted">
          {description}
        </p>
      </div>
      {action && (
        <div className="mt-1 animate-slide-up" style={{ animationDelay: "120ms", animationFillMode: "both" }}>
          {action}
        </div>
      )}
    </div>
  );
}
