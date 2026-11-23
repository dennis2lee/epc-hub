"use client";

import { useEffect, useRef } from "react";

type Props = {
  title: string;
  titleEn: string;
  body?: React.ReactNode;
  confirmLabel: string;
  confirmLabelEn: string;
  danger?: boolean;
  pending?: boolean;
  /** Disables only the confirm button (e.g. a required reason is still empty). */
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Bottom confirmation sheet for actions that cannot be undone. Focus moves into it. */
export function ConfirmSheet(props: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="sheet-backdrop" onClick={props.onCancel}>
      <div
        ref={ref}
        className="sheet stack"
        role="alertdialog"
        aria-modal="true"
        aria-label={props.title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && props.onCancel()}
      >
        <p className="subtitle">
          {props.title}
          <br />
          <span className="en">{props.titleEn}</span>
        </p>
        {props.body}
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={props.onCancel} disabled={props.pending}>
            돌아가기 <span className="en">Go back</span>
          </button>
          <button
            type="button"
            className={props.danger ? "btn btn-danger" : "btn btn-main"}
            onClick={props.onConfirm}
            disabled={props.pending || props.confirmDisabled}
          >
            {props.pending ? "처리 중…" : props.confirmLabel} <span className="en">{props.confirmLabelEn}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
