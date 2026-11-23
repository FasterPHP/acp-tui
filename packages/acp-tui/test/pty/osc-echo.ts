// Child of the harness tests for OSC colour replies: sends the queries named in
// argv (`10`, `12`, `4:3`, ...; a leading `@500` waits 500 ms first), then prints every byte it receives with ESC
// as `^[` and BEL as `^G`, and `END` once input has been quiet for 400 ms.
process.stdin.setRawMode(true);
process.stdin.resume();
let got = "";
let timer: ReturnType<typeof setTimeout> | undefined;
process.stdin.on("data", (d) => {
  got += d.toString("latin1");
  clearTimeout(timer);
  timer = setTimeout(() => {
    process.stdout.write(`\r\nGOT ${got.replaceAll("\x1b", "^[").replaceAll("\x07", "^G")} END\r\n`);
  }, 400);
});
const args = process.argv.slice(2);
const delay = args[0]?.startsWith("@") ? Number(args.shift()!.slice(1)) : 0;
// `set:#rrggbb` sets the cursor colour (OSC 12) and `reset` resets it (OSC 112); each step waits 100 ms
// so that replies stay in order.
setTimeout(async () => {
  for (const q of args) {
    const [code, idx] = q.split(":");
    if (code === "set") process.stdout.write(`\x1b]12;${idx}\x07`);
    else if (code === "reset") process.stdout.write("\x1b]112\x07");
    else process.stdout.write(code === "4" ? `\x1b]4;${idx};?\x07` : `\x1b]${code};?\x07`);
    await new Promise((r) => setTimeout(r, 100));
  }
}, delay);
timer = setTimeout(() => process.stdout.write("\r\nGOT  END\r\n"), delay + 1500);
setTimeout(() => process.exit(0), 6000);
