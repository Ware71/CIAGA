/**
 * Majors chrome — now just the app-wide chrome under its original names.
 *
 * These primitives started here and have been promoted to components/ui/chrome
 * so every hub can use them; the section's distinct look comes from the
 * `--sec-*` token block on body[data-section="majors"] instead ("Bottle & Mint":
 * no gold at all, the green pushed cold and luminous, so Majors differentiates
 * by temperature rather than by a second hue).
 *
 * Kept as re-exports so the Majors call sites don't all churn. New code should
 * import from components/ui/chrome directly.
 */
export {
  CARD as MAJORS_CARD,
  CARD_INTERACTIVE as MAJORS_CARD_INTERACTIVE,
  Section as MajorsSection,
} from "@/components/ui/chrome";

export { Masthead } from "@/components/ui/chrome";
