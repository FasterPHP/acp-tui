// HTML character references in agent Markdown (spec tui-rendering "Inline
// text": entities decoded, `&nbsp;` drawn as a space). marked leaves them in
// its text tokens for a browser to decode, so acp-tui decodes them itself.
//
// The named set is HTML 4's (Latin-1, symbols and Greek, special characters)
// plus a few HTML 5 names agents use; anything else stays as written. A
// reference that would decode to a control character (C0 other than tab and
// newline, DEL, C1) is left as written too, so decoding can never put a
// control character back into sanitised text.

/** Latin-1 names from U+00A0 to U+00FF, in code point order. */
const LATIN1 =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest " +
  "Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig " +
  "agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml";

/** Greek capitals from U+0391 (U+03A2 is unassigned) and small letters from U+03B1. */
const GREEK_UPPER = "Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho - Sigma Tau Upsilon Phi Chi Psi Omega";
const GREEK_LOWER = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega";

/** Everything else, as `name:code point`. */
const OTHERS =
  "quot:34 amp:38 apos:39 lt:60 gt:62 OElig:338 oelig:339 Scaron:352 scaron:353 Yuml:376 fnof:402 circ:710 tilde:732 " +
  "thetasym:977 upsih:978 piv:982 ensp:8194 emsp:8195 thinsp:8201 zwnj:8204 zwj:8205 lrm:8206 rlm:8207 hyphen:8208 ndash:8211 mdash:8212 " +
  "lsquo:8216 rsquo:8217 sbquo:8218 ldquo:8220 rdquo:8221 bdquo:8222 dagger:8224 Dagger:8225 bull:8226 hellip:8230 permil:8240 prime:8242 Prime:8243 " +
  "lsaquo:8249 rsaquo:8250 oline:8254 frasl:8260 euro:8364 image:8465 weierp:8472 real:8476 trade:8482 alefsym:8501 " +
  "larr:8592 uarr:8593 rarr:8594 darr:8595 harr:8596 crarr:8629 lArr:8656 uArr:8657 rArr:8658 dArr:8659 hArr:8660 " +
  "forall:8704 part:8706 exist:8707 empty:8709 nabla:8711 isin:8712 notin:8713 ni:8715 prod:8719 sum:8721 minus:8722 lowast:8727 radic:8730 prop:8733 " +
  "infin:8734 ang:8736 and:8743 or:8744 cap:8745 cup:8746 int:8747 there4:8756 sim:8764 cong:8773 asymp:8776 ne:8800 equiv:8801 le:8804 ge:8805 " +
  "sub:8834 sup:8835 nsub:8836 sube:8838 supe:8839 oplus:8853 otimes:8855 perp:8869 sdot:8901 lceil:8968 rceil:8969 lfloor:8970 rfloor:8971 " +
  "lang:10216 rang:10217 loz:9674 spades:9824 clubs:9827 hearts:9829 diams:9830 " +
  "Tab:9 NewLine:10 nbsp:160 half:189 check:10003 cross:10007 star:9734 starf:9733 dash:8208 laquo:171 raquo:187 colon:58 comma:44 period:46 excl:33 quest:63 num:35 dollar:36 percnt:37 lpar:40 rpar:41 ast:42 plus:43 sol:47 semi:59 equals:61 commat:64 lsqb:91 bsol:92 rsqb:93 Hat:94 lowbar:95 grave:96 lcub:123 verbar:124 rcub:125";

function buildNamed(): ReadonlyMap<string, string> {
  const named = new Map<string, string>();
  LATIN1.split(" ").forEach((name, i) => named.set(name, String.fromCodePoint(0xa0 + i)));
  GREEK_UPPER.split(" ").forEach((name, i) => name !== "-" && named.set(name, String.fromCodePoint(0x391 + i)));
  GREEK_LOWER.split(" ").forEach((name, i) => named.set(name, String.fromCodePoint(0x3b1 + i)));
  for (const pair of OTHERS.split(" ")) {
    const [name, cp] = pair.split(":");
    named.set(name!, String.fromCodePoint(Number(cp)));
  }
  return named;
}

const NAMED = buildNamed();

function isControl(cp: number): boolean {
  return (cp < 0x20 && cp !== 0x09 && cp !== 0x0a) || (cp >= 0x7f && cp <= 0x9f);
}

/** The character a reference (`&name;`, `&#nnn;` or `&#xhhh;`) stands for, or null to keep it. */
export function decodeReference(reference: string): string | null {
  const m = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));$/.exec(reference);
  if (!m) return null;
  if (m[3] !== undefined) return NAMED.get(m[3]) ?? null;
  const cp = m[1] !== undefined ? Number.parseInt(m[1], 10) : Number.parseInt(m[2]!, 16);
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "\uFFFD";
  if (isControl(cp)) return null;
  // A private-use character from a reference could look like a pre-pass placeholder to a later
  // reader of the drawn text; draw the replacement character instead.
  if (cp >= 0xe000 && cp <= 0xf8ff) return "\uFFFD";
  return String.fromCodePoint(cp);
}

const REFERENCE = /&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g;

/** `text` with every character reference decoded (unknown ones kept as written). */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(REFERENCE, (ref) => decodeReference(ref) ?? ref);
}
