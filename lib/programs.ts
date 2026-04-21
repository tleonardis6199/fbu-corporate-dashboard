// Product → program category mapping.
// Categories must match user's definition exactly. One product = exactly one category.

export type ProgramCategory = "mastermind" | "elite" | "ceo" | "nca" | "branding" | "other";

const EXPLICIT_MAP: Record<string, ProgramCategory> = {
  // Elite (add-on to Mastermind or standalone — tracked separately)
  "Elite SPF Mastermind Upgrade": "elite",
  "SPF Elite 12-Month Add-On | Paid Monthly": "elite",

  // CEO Mastermind tier
  "SPF Mastermind (CEO Discounted Rate)": "ceo",
  "CEO Mastermind": "ceo",
  "GRIT Athlete Performance License (CEO Special) 12-Month Agreement": "ceo",
  "SPF & CEO Monthly Plan Price": "ceo",
  "Mastermind  + CEO $1,161.25": "ceo",

  // Branding Workshop — separate tier
  "SPF Branding Workshop": "branding",
  "SPF Branding Workshop (alternate payment)": "branding",

  // NCA
  "New Client Academy for Gym Owners": "nca",
  "New Client Academy PD": "nca",
  "Vince Gabriele's New Client Academy": "nca",
  "NCA Weekly Billing": "nca",
  "NCA Grandfathered Pricing": "nca",
};

export function categorizeProduct(name: string | null | undefined): ProgramCategory {
  if (!name) return "other";
  if (EXPLICIT_MAP[name]) return EXPLICIT_MAP[name];
  // Fallback: any Mastermind-named product not explicitly mapped is standard Mastermind
  if (/mastermind/i.test(name)) return "mastermind";
  if (/new client academy|\bnca\b/i.test(name)) return "nca";
  return "other";
}

export const PROGRAM_LABEL: Record<ProgramCategory, string> = {
  mastermind: "Mastermind",
  elite: "Elite",
  ceo: "CEO Mastermind",
  nca: "New Client Academy",
  branding: "Branding Workshop",
  other: "Other",
};

export const PROGRAM_COLOR: Record<ProgramCategory, string> = {
  mastermind: "#a855f7",
  elite: "#f59e0b",
  ceo: "#ec4899",
  nca: "#eab308",
  branding: "#06b6d4",
  other: "#64748b",
};
