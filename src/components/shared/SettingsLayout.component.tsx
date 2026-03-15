import { cn } from "@/lib/utils";

export function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="text-[11px] font-medium tracking-wide text-text-muted uppercase mb-1.5 px-1">
      {title}
    </h2>
  );
}

export function SectionCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-[10px] bg-bg-elevated border border-border-subtle overflow-hidden", className)}>
      {children}
    </div>
  );
}

export function SettingRow({
  label,
  description,
  right,
  className,
}: {
  label: string;
  description?: string;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between px-4 py-3", className)}>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[13px] text-text-primary">{label}</span>
        {description && (
          <span className="text-[12px] text-text-muted leading-snug">{description}</span>
        )}
      </div>
      {right && <div className="shrink-0 ml-4">{right}</div>}
    </div>
  );
}

export function ValueBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[12px] text-text-secondary bg-bg-hover rounded-md px-2.5 py-1">
      {children}
    </span>
  );
}
