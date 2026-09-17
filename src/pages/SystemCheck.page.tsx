import { useAppStore } from "@/store/app.store";
import { useState, useEffect, useCallback } from "react";
import {
  Mic,
  Accessibility,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Square,
  Loader2,
  Check,
} from "lucide-react";
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
import { FnKeyConflictWarning } from "@/components/shared/FnKeyConflictWarning.component";
import { cn } from "@/lib/utils";
import {
  PageLayout,
  PageHeader,
} from "@/components/shared/PageLayout.component";

type PermissionStatus =
  "authorized" | "denied" | "not_determined" | "restricted";

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
    // Stop polling once both permissions are granted
    if (permissions.microphone === "authorized" && permissions.accessibility) {
      return;
    }
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [poll, permissions.microphone, permissions.accessibility]);

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
        "permission-row flex items-center gap-3.5 px-4 py-3.5",
        !isLast && "border-b border-border-subtle",
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-elevated">
        {icon}
      </div>

      <div className="flex flex-1 flex-col gap-0.5 min-w-0">
        <span className="text-[13px] font-medium text-text-primary">
          {label}
        </span>
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
              "hover:bg-accent-soft active:scale-[0.97]",
              "transition-interaction duration-150",
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
              "hover:bg-bg-hover hover:text-text-primary active:scale-[0.97]",
              "transition-interaction duration-150",
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
      : permissions.microphone === "denied" ||
          permissions.microphone === "restricted"
        ? "denied"
        : "not_asked";

  const axStatus: "granted" | "denied" | "not_asked" = permissions.accessibility
    ? "granted"
    : "denied";
  const permissionsReady = micStatus === "granted" && axStatus === "granted";

  return (
    <PageLayout reading>
      <PageHeader page="system-check" />
      <div className={cn("system-readiness", permissionsReady && "is-ready")}>
        {permissionsReady ? <CheckCircle2 /> : <AlertCircle />}
        <div>
          <h2>
            {permissionsReady ? "All set to listen." : "Let’s get you ready."}
          </h2>
          <p>
            {permissionsReady
              ? "Required permissions are granted. Try your microphone below."
              : "Review the permissions below to start dictating."}
          </p>
        </div>
      </div>

      {/* Section label */}
      <div className="mb-2.5">
        <span className="text-[13px] font-semibold text-text-primary">
          Permissions
        </span>
      </div>

      {/* Permission cards */}
      <div className="settings-group">
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

      <FnKeyConflictWarning className="mt-3" />

      {/* Footer note */}
      <p className="mt-3 text-[11px] text-text-muted">
        Permission status updates automatically when you return from System
        Settings.
      </p>

      {/* Microphone Test */}
      <div className="mt-6 mb-2.5">
        <span className="text-[13px] font-semibold text-text-primary">
          Microphone Test
        </span>
      </div>
      <RecordingTestWidget />
    </PageLayout>
  );
}

/* ── Recording Test Widget ── */
function RecordingTestWidget() {
  const quietSeconds = useAppStore((s) => s.quietSeconds);
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
    status === "preparing" ||
    status === "transcribing" ||
    status === "correcting" ||
    status === "pasting";
  const isDone = status === "done";
  const isError = status === "error";
  const isIdle = status === "idle";

  const handleStopAndProcess = useCallback(async () => {
    const result = await stopRecording();
    if (result.sample_count > 0) {
      processAudio(result);
    }
  }, [stopRecording, processAudio]);

  const handleToggle = useCallback(async () => {
    if (isRecording) {
      await handleStopAndProcess();
    } else if (isIdle || isDone || isError) {
      resetTranscription();
      await startRecording();
    }
  }, [
    isRecording,
    isIdle,
    isDone,
    isError,
    resetTranscription,
    startRecording,
    handleStopAndProcess,
  ]);

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
    <div className="settings-group microphone-test">
      <div className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <button
            onClick={handleToggle}
            data-tooltip={isRecording ? "Stop microphone test" : "Start microphone test"}
            aria-label={
              isRecording ? "Stop microphone test" : "Start microphone test"
            }
            disabled={isProcessing}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-interaction duration-200",
              isRecording
                ? "bg-accent text-white shadow-[0_0_12px_var(--color-accent-glow-strong)]"
                : isProcessing
                  ? "bg-bg-hover text-text-muted cursor-not-allowed"
                  : "bg-bg-hover border border-border text-text-secondary hover:bg-bg-active hover:text-text-primary",
              !isRecording && !isProcessing && "active:scale-[0.97]",
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
            {isRecording && quietSeconds >= 20 ? (
              <span role="status" className="text-[12px] text-text-secondary">
                Still talking? Speak to continue. Stopping in {Math.max(0, 30 - quietSeconds)}s.
              </span>
            ) : isRecording ? (
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
                {status === "preparing" ? "Preparing dictation…" : status === "transcribing"
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

          {isDone && <Check size={15} className="text-success shrink-0" />}
        </div>
      </div>
    </div>
  );
}
