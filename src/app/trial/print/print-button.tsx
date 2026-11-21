"use client";

export function PrintButton() {
  return (
    <button type="button" className="btn btn-main no-print" onClick={() => window.print()}>
      인쇄하기 <span className="en">Print</span>
    </button>
  );
}
