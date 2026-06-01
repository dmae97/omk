/**
 * Small OMK mascot banner.
 *
 * Keep this intentionally compact: it is printed in normal `omk` help output
 * and as the fallback provider banner replacement, so it must render well on
 * narrow terminals and in logs that do not handle image-style ANSI art.
 */
export const OMK_SIMPLE_ASCII_ART = [
  "        /\\_/\\   ♡",
  "      ฅ( ˶• ᴗ •˶ )ฅ",
  "       /| hoodie |\\    Plan first. Ship small. Stay safe!",
  "       /_|_______|_\\   omk❯ provider-neutral ready",
  "    ── violet terminal · purple paws · mint checks ──",
].join("\n");

/** @deprecated use OMK_SIMPLE_ASCII_ART */
export const KIMICAT_SIMPLE_ASCII_ART = OMK_SIMPLE_ASCII_ART;
