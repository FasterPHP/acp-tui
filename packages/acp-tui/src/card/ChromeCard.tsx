// The docked card block (mvp-chrome-and-keys tasks 5.1 and 5.6, promoted from S6,
// Phase 1a): the elicitation card while the agent is asking something,
// otherwise the permission card with its scrollable preview and Ctrl+O grow.
// Both sit in the same docked position (decisions 12 and 13,
// research/full-screen-synthesis.md). Mounted by app/run.tsx through
// `createCards`, with the elicitation host the session controller passes to
// the ACP client.
import { onCleanup, Show, type JSX } from "solid-js";
import { PermissionCard } from "../app/PermissionCard.tsx";
import type { BlockComponent, BlockProps } from "../layout/Screen.tsx";
import { useKeys } from "../keys/context.ts";
import { createElicitationHost, ElicitationCard, type ElicitationHost, type UrlActionOptions } from "./elicitation.tsx";

export function createChromeCard(host: ElicitationHost, urlActions: UrlActionOptions = {}): BlockComponent {
  return (props: BlockProps): JSX.Element => {
    const { controller } = useKeys();
    // Tab from the conversation reaches the elicitation card as it does a permission card.
    controller.setCardProbe(() => host.current() !== null);
    onCleanup(() => controller.setCardProbe(null));
    return (
      <Show when={host.current() !== null} fallback={<PermissionCard {...props} />}>
        <ElicitationCard {...props} host={host} urlActions={urlActions} />
      </Show>
    );
  };
}

export interface Cards {
  /** The docked card block (the layout's `card` region). */
  readonly block: BlockComponent;
  /** For the session controller: answers `elicitation/create` and `elicitation/complete`, and
   *  makes `initialize` advertise the capability. */
  readonly elicitation: ElicitationHost;
  /** The turn is being cancelled: open elicitation requests are answered `cancel`. */
  cancel(): void;
}

/** The docked cards: the permission card and the elicitation card in one block. `urlActions`:
 *  how the elicitation card opens and copies a URL (the clipboard mode, and test stubs). */
export function createCards(urlActions: UrlActionOptions = {}): Cards {
  const host = createElicitationHost();
  return { block: createChromeCard(host, urlActions), elicitation: host, cancel: () => host.cancelAll() };
}
