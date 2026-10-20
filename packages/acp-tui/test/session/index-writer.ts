// A separate process that appends records to a session index, for the "Two
// instances" test (test/session/session-index.test.ts): `count` sessions
// named `<prefix>-<n>`, each recorded and then given a title, as fast as it
// can.
//
//   bun test/session/index-writer.ts <state home> <prefix> <count>
import { openSessionIndex } from "../../src/session/session-index.ts";

const [stateHome, prefix, count] = process.argv.slice(2);
if (!stateHome || !prefix || !count) throw new Error("usage: index-writer.ts <state home> <prefix> <count>");

const index = openSessionIndex({ stateHome, onWarning: (message) => process.stderr.write(`${message}\n`) });
for (let n = 0; n < Number(count); n++) {
  const sessionId = `${prefix}-${n}`;
  index.record({ agent: "fake", sessionId, directory: `/work/${prefix}`, title: `first prompt ${n}` });
  index.updateTitle({ agent: "fake", sessionId }, `title ${prefix} ${n}`);
}
