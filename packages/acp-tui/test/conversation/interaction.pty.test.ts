// Collapse and expand, the conversation cursor, scrolling and following, and
// the reading position (phase-1a tasks 7.3 to 7.6) on the windowed list; the
// tests are in interaction.suite.ts.
import { interactionSuite } from "./interaction.suite.ts";

// Grouping leaves about 150 entries for 200 items: move up fewer of them.
interactionSuite({ back: { resize: 110, toggle: 70 } });
