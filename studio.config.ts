// One file says what this build is and which AI modes it offers. The kit reads it everywhere.
import type { StudioConfig } from "@/kit/ai/types";

const config: StudioConfig = {
  app: {
    name: "Sting",
    slug: "sting",
    version: "0.1.0",
    tagline: "A war room for your AI agents",
    repo: "https://github.com/VedSoni-dev/sting",
    url: "https://sting.vedantsoni.com",
    alternativeTo: "Anduril Lattice",
  },
  // Pick the modes that make sense for this build (docs/auth.md). Order = order in the picker. The hosted picker hides ChatGPT plan (local runs only).
  modes: ["claude","publik","chatgpt","local"],
  defaultMode: "claude",
};

export default config;
