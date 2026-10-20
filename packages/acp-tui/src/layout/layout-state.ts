// The layout in use, as a Solid signal. `setLayout` validates first, so a
// rejected layout never replaces the one in use (spec "Layout validation").
import { createSignal, type Accessor } from "solid-js";
import { DEFAULT_LAYOUT, resolveLayout, validateLayout, type Layout, type ResolvedLayout, type ValidationResult } from "./layout.ts";

export interface LayoutState {
  layout: Accessor<ResolvedLayout>;
  /** Applies `candidate` if it is valid; otherwise keeps the current layout and returns the errors. */
  setLayout(candidate: unknown): ValidationResult;
}

export function createLayoutState(initial: Layout = DEFAULT_LAYOUT): LayoutState {
  const [layout, set] = createSignal(resolveLayout(initial));
  return {
    layout,
    setLayout(candidate) {
      const result = validateLayout(candidate);
      if (result.ok) set(result.layout);
      return result;
    },
  };
}
