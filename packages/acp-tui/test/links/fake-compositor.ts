// A fake Wayland compositor on a Unix socket for the activation-token tests (review C7): enough of
// `wl_display`, `wl_registry` and `xdg_activation_v1` to hand out a token.
import { decodeMessages, encodeMessage, readString, readUint } from "../../src/links/activation.ts";

/** A fake compositor: lists its globals on `get_registry`, answers the sync, and hands out a token
 *  on commit (or, with `silent`, never answers the commit; with `error`, raises a protocol error). */
export function fakeCompositor(path: string, options: { offerActivation?: boolean; silent?: boolean; error?: boolean } = {}) {
  const seen: Array<{ object: number; opcode: number; appId?: string }> = [];
  const server = Bun.listen({
    unix: path,
    socket: {
      data(s, data) {
        for (const m of decodeMessages(new Uint8Array(data)).messages) {
          seen.push(m.object === 5 && m.opcode === 1 ? { object: m.object, opcode: m.opcode, appId: readString(m.args, 0).value } : { object: m.object, opcode: m.opcode });
          if (m.object === 1 && m.opcode === 0) {
            const sync = readUint(m.args, 0);
            if (options.offerActivation !== false) s.write(encodeMessage(2, 0, [9, "xdg_activation_v1", 1]));
            s.write(encodeMessage(2, 0, [3, "wl_seat", 7]));
            s.write(encodeMessage(sync, 0, [0]));
          } else if (m.object === 5 && m.opcode === 3) {
            if (options.error) s.write(encodeMessage(1, 0, [5, 2, "invalid token request"]));
            else if (!options.silent) s.write(encodeMessage(5, 0, ["tok-123"]));
          }
        }
      },
    },
  });
  return { server, seen };
}

