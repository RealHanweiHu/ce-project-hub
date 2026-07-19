export type GateEvidenceState =
  | "missing"
  | "uploaded"
  | "pending"
  | "rejected"
  | "approved";

export function getGateEvidenceState(input: {
  hasFile: boolean;
  readinessMissing: boolean;
  reviewStatus: "pending" | "approved" | "rejected" | null;
}): GateEvidenceState {
  if (!input.hasFile) return "missing";
  // The server readiness result is the final truth and also detects an old
  // approval invalidated by a newer upload.
  if (!input.readinessMissing) return "approved";
  if (input.reviewStatus === "pending") return "pending";
  if (input.reviewStatus === "rejected") return "rejected";
  return "uploaded";
}
