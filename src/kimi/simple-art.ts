/**
 * Small Kimicat mascot banner.
 *
 * Keep this intentionally compact: it is printed in normal `omk` help output
 * and as the fallback Kimi banner replacement, so it must render well on
 * narrow terminals and in logs that do not handle image-style ANSI art.
 */
export const KIMICAT_SIMPLE_ASCII_ART = [
  "        /\\_/\\   ♡",
  "      ฅ( ˶• ᴗ •˶ )ฅ",
  "       /| hoodie |\\    Plan first. Ship small. Stay safe!",
  "       /_|_______|_\\   kimi❯ chocomint ready",
  "    ── violet terminal · purple paws · mint checks ──",
].join("\n");
