import { invoke } from "@tauri-apps/api/core";

export async function checkMicrophonePermission(): Promise<string> {
  return invoke<string>("check_microphone");
}

export async function requestMicrophonePermission(): Promise<boolean> {
  return invoke<boolean>("request_microphone");
}

export async function repairMicrophonePermission(): Promise<void> {
  return invoke("repair_microphone_permission");
}

export async function checkAccessibility(): Promise<boolean> {
  return invoke<boolean>("check_accessibility");
}

export async function requestAccessibility(): Promise<boolean> {
  return invoke<boolean>("request_accessibility");
}

export async function reinitFnKeyMonitor(): Promise<void> {
  return invoke("reinit_fn_key_monitor");
}

export async function openSystemSettings(pane: "microphone" | "accessibility"): Promise<void> {
  const urls: Record<string, string> = {
    microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  };
  return invoke("open_system_settings", { pane: urls[pane] });
}
