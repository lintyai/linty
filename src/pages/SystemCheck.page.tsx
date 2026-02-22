import { useState, useEffect, useCallback } from "react";
import { Mic, Accessibility, CheckCircle2, AlertCircle, ExternalLink, Square, Loader2, Check } from "lucide-react";
import {
  checkMicrophonePermission,
  requestMicrophonePermission,
  checkAccessibility,
  reinitFnKeyMonitor,
  openSystemSettings,
} from "@/services/permissions.service";
import { useRecording } from "@/hooks/useRecording.hook";
import { useTranscription } from "@/hooks/useTranscription.hook";
import { WaveformVisualizer } from "@/components/WaveformVisualizer.component";
import { cn } from "@/lib/utils";

type PermissionStatus = "authorized" | "denied" | "not_determined" | "restricted";

interface PermissionState {
  microphone: PermissionStatus;
  accessibility: boolean;
}

function usePermissions() {
  const [permissions, setPermissions] = useState<PermissionState>({
    microphone: "not_determined",
    accessibility: false,
  });

  const poll = useCallback(async () => {
    const [mic, ax] = await Promise.all([
      checkMicrophonePermission().catch(() => "not_determined"),
      checkAccessibility().catch(() => false),
    ]);
    setPermissions({
      microphone: mic as PermissionStatus,
      accessibility: ax,
    });
  }, []);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [poll]);

  // Reinit fn key monitor when accessibility becomes granted
  useEffect(() => {
    if (permissions.accessibility) {
      reinitFnKeyMonitor().catch(console.error);
    }
  }, [permissions.accessibility]);

  const requestMic = async () => {
    await requestMicrophonePermission();
    poll();
  };

  return { permissions, requestMic };
}

function StatusBadge({
  status,
}: {
  status: "granted" | "denied" | "not_asked";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        status === "granted" && "bg-success-glow text-success",
        status === "denied" && "bg-error-glow text-error",
        status === "not_asked" && "bg-warning-glow text-warning",
      )}
    >
      {status === "granted" && (
        <>
          <CheckCircle2 size={11} />
          Granted
        </>
      )}
      {status === "denied" && (
        <>
          <AlertCircle size={11} />
          Denied
        </>
      )}
      {status === "not_asked" && (
        <>
          <AlertCircle size={11} />
          Not Granted
        </>
      )}
    </span>
  );
}

function PermissionRow({
  icon,
  label,
  description,
  status,
  onGrant,
  onOpenSettings,
  isLast,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  status: "granted" | "denied" | "not_asked";
  onGrant?: () => void;
  onOpenSettings?: () => void;
  isLast?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3.5 px-4 py-3.5",
        !isLast && "border-b border-border-subtle",
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-elevated">
        {icon}
      </div>

      <div className="flex flex-1 flex-col gap-0.5 min-w-0">
        <span className="text-[13px] font-medium text-text-primary">{label}</span>
        <span className="text-[11px] text-text-muted">{description}</span>
      </div>

      <div className="flex items-center gap-2.5 shrink-0">
        <StatusBadge status={status} />

        {status === "not_asked" && onGrant && (
          <button
            onClick={onGrant}
            className={cn(
              "rounded-lg px-3 py-[5px] text-[12px] font-medium",
              "bg-accent text-white",
              "hover:bg-accent-soft active:scale-95",
              "transition-all duration-150",
            )}
          >
            Grant
          </button>
        )}

        {(status === "denied" || status === "granted") && onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className={cn(
              "flex items-center gap-1 rounded-lg px-3 py-[5px] text-[12px] font-medium",
              "bg-bg-elevated border border-border text-text-secondary",
              "hover:bg-bg-hover hover:text-text-primary active:scale-95",
              "transition-all duration-150",
            )}
          >
            Open Settings
            <ExternalLink size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

export function SystemCheckPage() {
  const { permissions, requestMic } = usePermissions();

  const micStatus: "granted" | "denied" | "not_asked" =
    permissions.microphone === "authorized"
      ? "granted"
      : permissions.microphone === "denied" || permissions.microphone === "restricted"
        ? "denied"
        : "not_asked";

  const axStatus: "granted" | "denied" | "not_asked" = permissions.accessibility
    ? "granted"
    : "denied";

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div
        data-tauri-drag-region
        className="flex h-[52px] shrink-0 items-center border-b border-border-subtle px-5"
      >
        <h1
          className="text-[15px] font-semibold text-text-primary"
          data-tauri-drag-region
        >
          System Check
        </h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {/* Section label */}
        <div className="mb-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            Permissions
          </span>
        </div>

        {/* Permission cards */}
        <div className="rounded-xl border border-border-subtle bg-bg-secondary overflow-hidden">
          <PermissionRow
            icon={<Mic size={15} className="text-text-secondary" />}
            label="Microphone Access"
            description="Required for voice recording"
            status={micStatus}
            onGrant={requestMic}
            onOpenSettings={() => openSystemSettings("microphone")}
          />
          <PermissionRow
            icon={<Accessibility size={15} className="text-text-secondary" />}
            label="Accessibility"
            description="Required for auto-paste & fn key monitoring"
            status={axStatus}
            onOpenSettings={() => openSystemSettings("accessibility")}
            isLast
          />
        </div>

        {/* Footer note */}
        <p className="mt-3 text-[11px] text-text-muted">
          Permissions are checked every 3 seconds.
        </p>

        {/* Microphone Test */}
        <div className="mt-6 mb-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            Microphone Test
          </span>
        </div>
        <RecordingTestWidget />
      </div>
    </div>
  );
}

/* ── Recording Test Widget ── */
function RecordingTestWidget() {
  const {
    isRecording,
    recordingDuration,
    amplitude,
    startRecording,
    stopRecording,
  } = useRecording();
  const { status, finalText, error, processAudio, resetTranscription } =
    useTranscription();

  const isProcessing =
    status === "transcribing" ||
    status === "correcting" ||
    status === "pasting";
  const isDone = status === "done";
  const isError = status === "error";
  const isIdle = status === "idle";

  const handleStopAndProcess = useCallback(async () => {
    const samples = await stopRecording();
    if (samples.length) {
      processAudio(samples);
    }
  }, [stopRecording, processAudio]);

  const handleToggle = useCallback(async () => {
    if (isRecording) {
      await handleStopAndProcess();
    } else if (isIdle) {
      await startRecording();
    }
  }, [isRecording, isIdle, startRecording, handleStopAndProcess]);

  // Auto-reset after done/error
  useEffect(() => {
    if (isDone || isError) {
      const timer = setTimeout(resetTranscription, 5000);
      return () => clearTimeout(timer);
    }
  }, [isDone, isError, resetTranscription]);

  const formatDuration = (s: number) => {
    const secs = Math.floor(s);
    const tenths = Math.floor((s % 1) * 10);
    return `${secs}.${tenths}s`;
  };

  return (
    <div className="rounded-xl border border-border-subtle bg-bg-secondary overflow-hidden">
      <div className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <button
            onClick={handleToggle}
            disabled={isProcessing}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all duration-200",
              isRecording
                ? "bg-accent text-white shadow-[0_0_12px_var(--color-accent-glow-strong)]"
                : isProcessing
                  ? "bg-bg-hover text-text-muted cursor-not-allowed"
                  : "bg-bg-hover border border-border text-text-secondary hover:bg-bg-active hover:text-text-primary",
              !isRecording && !isProcessing && "active:scale-95",
            )}
          >
            {isRecording ? (
              <Square size={12} fill="currentColor" />
            ) : isProcessing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Mic size={15} />
            )}
          </button>

          <div className="flex-1 min-w-0">
            {isRecording ? (
              <div className="flex items-center gap-3">
                <WaveformVisualizer
                  amplitude={amplitude}
                  isActive
                  className="h-6 flex-1"
                />
                <span className="text-[13px] font-medium text-text-secondary tabular-nums shrink-0">
                  {formatDuration(recordingDuration)}
                </span>
              </div>
            ) : isProcessing ? (
              <span className="text-[13px] text-text-secondary">
                {status === "transcribing"
                  ? "Transcribing..."
                  : status === "correcting"
                    ? "Polishing..."
                    : "Pasting..."}
              </span>
            ) : isDone && finalText ? (
              <p className="text-[13px] text-text-primary truncate">
                {finalText}
              </p>
            ) : isError ? (
              <span className="text-[13px] text-error">
                {error || "Something went wrong"}
              </span>
            ) : (
              <span className="text-[13px] text-text-muted">
                Click to test recording & transcription
              </span>
            )}
          </div>

          {isDone && (
            <Check size={15} className="text-success shrink-0" />
          )}
        </div>
      </div>
    </div>
  );
}
