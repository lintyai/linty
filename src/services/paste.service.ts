import { invoke } from "@tauri-apps/api/core";

export async function checkAccessibility(): Promise<boolean> {
  return invoke<boolean>("check_accessibility");
}

export async function pasteText(): Promise<void> {
  return invoke("paste_text");
}
