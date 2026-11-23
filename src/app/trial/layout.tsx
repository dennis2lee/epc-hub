import { notFound } from "next/navigation";
import { trialPagesEnabled } from "@/lib/server/trial";

// The device-trial pages exist only where TRIAL_PAGES=1 (local and the preview
// deployment during the KakaoTalk trial). Production returns 404.
export default function TrialLayout({ children }: { children: React.ReactNode }) {
  if (!trialPagesEnabled()) notFound();
  return children;
}
