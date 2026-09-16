/** What the signed update policy asks for (`check_policy`, src-tauri/src/policy.rs). */
export type PolicyUpdateKind = "none" | "prompt" | "required";

export type PolicyUpdateReason = "blockedVersion" | "belowMinimum" | "force" | "rollback" | "staged";

export interface PolicyDecision {
  update: PolicyUpdateKind;
  reason: PolicyUpdateReason | null;
  targetVersion: string | null;
  message: string | null;
  cloudSttEnabled: boolean;
  banner: string | null;
  policySeq: number | null;
}
