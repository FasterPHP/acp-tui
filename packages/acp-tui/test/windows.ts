// windows-support D10 (task 11.1): tests that need POSIX behaviour skip on Windows with
// `test.skipIf(WINDOWS)` and a one-line reason above them (signals sent with `process.kill`,
// `#!/bin/sh` stubs and mode bits, raw bytes or main-screen snapshots of a PTY stream that ConPTY
// rewrites, truecolour expected from a bare PTY). The skips are counted in the Windows run's note.
export const WINDOWS = process.platform === "win32";
