"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelOwnClaim } from "../actions";
import { ConfirmSheet } from "@/app/components/confirm-sheet";

/** Author's "cancel this claim" for a numbered draft or a claim sent back.
 *  The number is kept (never reused); a reason is required. */
export function CancelClaim({ claimId, version, onBeforeCancel }: { claimId: string; version: number; onBeforeCancel?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onConfirm() {
    setError(null);
    start(async () => {
      onBeforeCancel?.();
      const r = await cancelOwnClaim(claimId, version, reason);
      if (!r.ok) {
        setError(r.error ?? "처리하지 못했습니다.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className="link-danger" onClick={() => setOpen(true)} disabled={pending}>
        이 청구 취소하기 <span className="en">Cancel this claim</span>
      </button>
      {open && (
        <ConfirmSheet
          title="이 청구를 취소합니다. 되돌릴 수 없습니다."
          titleEn="Cancel this claim? This cannot be undone."
          body={
            <div className="stack">
              <label className="field">
                <span>
                  취소 이유 <span className="en">Reason</span>
                </span>
                <input id="cancel-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
              </label>
              {error && (
                <p className="notice" role="alert">
                  {error}
                </p>
              )}
            </div>
          }
          confirmLabel="청구 취소"
          confirmLabelEn="Cancel claim"
          danger
          pending={pending}
          confirmDisabled={!reason.trim()}
          onCancel={() => setOpen(false)}
          onConfirm={onConfirm}
        />
      )}
    </>
  );
}
