import { useAppStore } from "@/store/app.store";

export function HistoryScopeNote() {
  const retention = useAppStore((s) => s.historySnapshot.retentionDays);
  return (
    <p className="dashboard-footnote">
      <span>
        {retention
          ? `Based on saved history from the last ${retention} days.`
          : "Based on all your saved transcriptions."}
      </span>{" "}
      <span>Deleting history also removes its statistics.</span>
    </p>
  );
}
