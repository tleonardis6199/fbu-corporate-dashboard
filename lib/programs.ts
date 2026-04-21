// Categories now sourced from master_members.tier — no product-name mapping.
export type ProgramKey = "mastermind" | "elite" | "ceo" | "nca" | "other";

export const PROGRAM_LABEL: Record<ProgramKey, string> = {
  mastermind: "Mastermind",
  elite: "Elite",
  ceo: "CEO Mastermind",
  nca: "New Client Academy",
  other: "Other",
};

export const PROGRAM_COLOR: Record<ProgramKey, string> = {
  mastermind: "#a855f7",
  elite: "#f59e0b",
  ceo: "#ec4899",
  nca: "#eab308",
  other: "#64748b",
};
