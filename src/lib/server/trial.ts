import "server-only";

/** Device-trial pages and their upload action are off unless TRIAL_PAGES=1. */
export function trialPagesEnabled(): boolean {
  return process.env.TRIAL_PAGES === "1";
}
