// Who owns a file on Windows, and who the current user is, read from the Win32 API through
// `bun:ffi` (spec tui-config "Harness file writers on Windows"). Loaded only on Windows, with
// `require` from config/writers.ts, so Linux and macOS never load `bun:ffi` or try to open a
// Windows library; nothing is opened until the first call.
//
// - The current user's SID: `OpenProcessToken` on the current process's pseudo handle with
//   TOKEN_QUERY, then `GetTokenInformation(TokenUser)`, whose TOKEN_USER starts with a pointer to
//   the SID inside the same buffer.
// - A file's owner: `GetNamedSecurityInfoW(SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION)`, whose
//   owner pointer points into the security descriptor it allocates (freed with `LocalFree`).
// - SIDs become strings (`S-1-5-21-...`) with `ConvertSidToStringSidW` (freed with `LocalFree`);
//   an account's name, for the problem shown when the owner is someone else, comes from
//   `LookupAccountSidW` on the SID `ConvertStringSidToSidW` rebuilds.
//
// The libraries are opened by absolute path in `%SystemRoot%\System32`, never by bare name, so no
// DLL in the session directory can stand in for them. Every failure throws; the caller decides
// what a failed lookup means.
import { dlopen, FFIType, read, type Pointer } from "bun:ffi";
import { win32 } from "node:path";
import type { WindowsOwnerLookup } from "../config/writers.ts";

const SE_FILE_OBJECT = 1;
const OWNER_SECURITY_INFORMATION = 0x00000001;
const TOKEN_QUERY = 0x0008;
const TOKEN_USER = 1;
/** `GetCurrentProcess()`'s pseudo handle, `(HANDLE)-1`; it needs no closing. */
const CURRENT_PROCESS = -1n;
/** Longest wide string read back (a SID string is under 200 characters). */
const MAX_WIDE_CHARS = 1024;
/** Characters in each of LookupAccountSidW's name buffers. */
const NAME_CHARS = 256;

function openLibraries() {
  const root = process.env["SystemRoot"] || process.env["windir"] || "C:\\Windows";
  const system32 = win32.join(win32.isAbsolute(root) ? root : "C:\\Windows", "System32");
  const advapi32 = dlopen(win32.join(system32, "advapi32.dll"), {
    // DWORD GetNamedSecurityInfoW(LPCWSTR, SE_OBJECT_TYPE, SECURITY_INFORMATION, PSID*, PSID*, PACL*, PACL*, PSECURITY_DESCRIPTOR*)
    GetNamedSecurityInfoW: {
      args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.u32,
    },
    // BOOL OpenProcessToken(HANDLE, DWORD, PHANDLE)
    OpenProcessToken: { args: [FFIType.i64, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
    // BOOL GetTokenInformation(HANDLE, TOKEN_INFORMATION_CLASS, LPVOID, DWORD, PDWORD)
    GetTokenInformation: { args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
    // BOOL ConvertSidToStringSidW(PSID, LPWSTR*)
    ConvertSidToStringSidW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    // BOOL ConvertStringSidToSidW(LPCWSTR, PSID*)
    ConvertStringSidToSidW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    // BOOL LookupAccountSidW(LPCWSTR, PSID, LPWSTR, LPDWORD, LPWSTR, LPDWORD, PSID_NAME_USE)
    LookupAccountSidW: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
  });
  const kernel32 = dlopen(win32.join(system32, "kernel32.dll"), {
    // HLOCAL LocalFree(HLOCAL)
    LocalFree: { args: [FFIType.ptr], returns: FFIType.ptr },
    // BOOL CloseHandle(HANDLE)
    CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
    // DWORD GetLastError(void): for messages only, since the runtime may have changed it.
    GetLastError: { args: [], returns: FFIType.u32 },
  });
  return { advapi32: advapi32.symbols, kernel32: kernel32.symbols };
}

type Libraries = ReturnType<typeof openLibraries>;

/** A NUL-terminated UTF-16 string for a `LPCWSTR` argument. */
function wide(text: string): Buffer {
  return Buffer.from(`${text}\0`, "utf16le");
}

/** The pointer an out-parameter (`PSID*`, `LPWSTR*`, `PHANDLE`) received. */
function pointerIn(out: BigUint64Array): Pointer | null {
  const value = Number(out[0]);
  return value === 0 ? null : (value as Pointer);
}

/** The NUL-terminated UTF-16 string at `at`. */
function readWide(at: Pointer): string {
  let text = "";
  for (let i = 0; i < MAX_WIDE_CHARS; i++) {
    const unit = read.u16(at, i * 2);
    if (unit === 0) return text;
    text += String.fromCharCode(unit);
  }
  throw new Error("unterminated string");
}

function sidString(libs: Libraries, sid: Pointer): string {
  const out = new BigUint64Array(1);
  if (!libs.advapi32.ConvertSidToStringSidW(sid, out)) throw new Error(`ConvertSidToStringSidW failed (error ${libs.kernel32.GetLastError()})`);
  const text = pointerIn(out);
  if (text === null) throw new Error("ConvertSidToStringSidW returned no string");
  try {
    return readWide(text);
  } finally {
    libs.kernel32.LocalFree(text);
  }
}

function currentUserSid(libs: Libraries): string {
  const token = new BigUint64Array(1);
  if (!libs.advapi32.OpenProcessToken(CURRENT_PROCESS, TOKEN_QUERY, token)) throw new Error(`OpenProcessToken failed (error ${libs.kernel32.GetLastError()})`);
  const handle = token[0]!;
  try {
    // TOKEN_USER is { SID_AND_ATTRIBUTES User } = { PSID Sid; DWORD Attributes }, followed by the
    // SID itself; 512 bytes, 8-byte aligned, holds the largest SID (68 bytes) with room to spare.
    const buffer = new BigUint64Array(64);
    const needed = new Uint32Array(1);
    if (!libs.advapi32.GetTokenInformation(handle, TOKEN_USER, buffer, buffer.byteLength, needed)) {
      throw new Error(`GetTokenInformation failed (error ${libs.kernel32.GetLastError()}, ${needed[0]} bytes needed)`);
    }
    const sid = pointerIn(buffer);
    if (sid === null) throw new Error("GetTokenInformation returned no SID");
    // The SID lies in `buffer`, which stays referenced until this returns.
    return sidString(libs, sid);
  } finally {
    libs.kernel32.CloseHandle(handle);
  }
}

function ownerSid(libs: Libraries, path: string): string {
  const owner = new BigUint64Array(1);
  const descriptor = new BigUint64Array(1);
  const status = libs.advapi32.GetNamedSecurityInfoW(wide(path), SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION, owner, null, null, null, descriptor);
  if (status !== 0) throw new Error(`GetNamedSecurityInfoW failed (error ${status})`);
  const allocated = pointerIn(descriptor);
  try {
    const sid = pointerIn(owner);
    if (sid === null) throw new Error("GetNamedSecurityInfoW returned no owner");
    return sidString(libs, sid);
  } finally {
    if (allocated !== null) libs.kernel32.LocalFree(allocated);
  }
}

function accountName(libs: Libraries, sidText: string): string | null {
  const out = new BigUint64Array(1);
  if (!libs.advapi32.ConvertStringSidToSidW(wide(sidText), out)) return null;
  const sid = pointerIn(out);
  if (sid === null) return null;
  try {
    const name = Buffer.alloc(NAME_CHARS * 2);
    const domain = Buffer.alloc(NAME_CHARS * 2);
    const nameChars = new Uint32Array([NAME_CHARS]);
    const domainChars = new Uint32Array([NAME_CHARS]);
    const use = new Uint32Array(1);
    if (!libs.advapi32.LookupAccountSidW(null, sid, name, nameChars, domain, domainChars, use)) return null;
    // On success each count is the string's length without its NUL.
    const account = name.toString("utf16le", 0, Math.min(nameChars[0]!, NAME_CHARS) * 2);
    const authority = domain.toString("utf16le", 0, Math.min(domainChars[0]!, NAME_CHARS) * 2);
    return authority ? `${authority}\\${account}` : account;
  } finally {
    libs.kernel32.LocalFree(sid);
  }
}

let libraries: Libraries | null = null;
const libs = (): Libraries => (libraries ??= openLibraries());

/** The Win32 owner lookup. The libraries open on the first call and stay open. */
export function windowsOwnerLookup(): WindowsOwnerLookup {
  return {
    currentUserSid: () => currentUserSid(libs()),
    ownerSid: (path) => ownerSid(libs(), path),
    accountName: (sid) => {
      try {
        return accountName(libs(), sid);
      } catch {
        return null;
      }
    },
  };
}
