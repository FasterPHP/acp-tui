// Session views for layout unit tests.
import { DEFAULT_UI, FOLLOWING, type SessionView } from "../../src/layout/view.ts";

export const EMPTY_VIEW: SessionView = {
  agent: null,
  agentVersion: null,
  model: null,
  mode: null,
  cwd: null,
  home: null,
  connection: "connected",
  turnState: "idle",
  turnStartedAt: null,
  now: 0,
  usage: null,
  cost: null,
  mouse: "full",
  scroll: FOLLOWING,
  ui: { ...DEFAULT_UI },
};

export const FULL_VIEW: SessionView = {
  agent: "Claude Code",
  agentVersion: "0.81.2",
  model: "sonnet-4.5",
  mode: "Accept Edits",
  cwd: "/home/user/Projects/acp-tui",
  home: "/home/user",
  connection: "connected",
  turnState: "idle",
  turnStartedAt: null,
  now: 0,
  usage: { used: 38_000, size: 200_000 },
  cost: { amount: 0.41, currency: "USD" },
  mouse: "full",
  scroll: FOLLOWING,
  ui: { ...DEFAULT_UI },
};

export function view(overrides: Partial<SessionView> = {}, ui: Partial<SessionView["ui"]> = {}): SessionView {
  return { ...FULL_VIEW, ...overrides, ui: { ...FULL_VIEW.ui, ...overrides.ui, ...ui } };
}
