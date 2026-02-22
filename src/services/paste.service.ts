import { invoke } from "@tauri-apps/api/core";

export async function pasteText(): Promise<void> {
  return invoke("paste_text");
}
