// Screen text. Korean is the primary language; key buttons and statuses carry
// a small English label for second-generation members (doc/design.html §7).
// The language is not part of the URL because one KakaoTalk link is shared by
// Korean and English speakers.

export type Lang = "ko" | "en";

type Entry = { ko: string; en: string };

export const dict = {
  appName: { ko: "교회 지출청구", en: "Church Expense Claims" },
  login: { ko: "로그인", en: "Sign in" },
  logout: { ko: "로그아웃", en: "Sign out" },
  loginWithKakao: { ko: "카카오로 로그인", en: "Sign in with Kakao" },
  loginWithEmail: { ko: "이메일 코드로 로그인", en: "Sign in with email code" },
  sendCode: { ko: "코드 받기", en: "Send code" },
  verifyCode: { ko: "확인", en: "Verify" },
  emailLabel: { ko: "이메일 주소", en: "Email address" },
  codeLabel: { ko: "메일로 받은 6자리 코드", en: "6-digit code from the email" },
  submit: { ko: "올리기", en: "Submit" },
  withdraw: { ko: "도로 가져오기", en: "Withdraw" },
  approve: { ko: "승인", en: "Approve" },
  requestChanges: { ko: "보완 요청", en: "Request changes" },
  returnForDocuments: { ko: "서류 보완 요청", en: "Return for documents" },
  verified: { ko: "서류 확인 완료", en: "Verified" },
  checkReady: { ko: "수표 준비됨", en: "Check ready" },
  checkIssued: { ko: "수표 발행됨", en: "Check issued" },
  toReview: { ko: "내가 볼 청구서", en: "To review" },
  pending: { ko: "사무실 확인 중", en: "Pending" },
  singleApprover: { ko: "결재자 1인", en: "Single approver" },
  goBack: { ko: "돌아가기", en: "Go back" },
  callOffice: { ko: "사무실에 전화", en: "Call the office" },
} satisfies Record<string, Entry>;

export type DictKey = keyof typeof dict;

export function t(key: DictKey, lang: Lang = "ko"): string {
  return dict[key][lang];
}

/** Korean text with a small English hint, e.g. "승인 · Approve". */
export function bilingual(key: DictKey): { ko: string; en: string } {
  return dict[key];
}

// SQL functions raise short error codes; map them to screen text.
const errorText: Record<string, Entry> = {
  not_member: { ko: "등록된 교인 계정이 아닙니다. 본인 휴대폰에서 열어 주세요.", en: "This account is not registered." },
  stale_or_closed: { ko: "그 사이 내용이 바뀌었습니다. 새로 보기를 눌러 주세요.", en: "This claim changed. Please reload." },
  not_your_turn: { ko: "지금은 다른 분의 차례입니다.", en: "It is not your turn." },
  author_cannot_act: { ko: "본인이 올린 청구서는 결재할 수 없습니다.", en: "You cannot act on your own claim." },
  reason_required: { ko: "사유를 골라 주시거나 적어 주세요.", en: "Please give a reason." },
  already_acted_on_claim: { ko: "이 청구서는 이미 한 번 결재하셨습니다.", en: "You already acted on this claim." },
  no_open_step: { ko: "이미 처리된 청구서입니다.", en: "This claim was already handled." },
  not_found: { ko: "청구서를 찾을 수 없습니다.", en: "Claim not found." },
  duplicate_receipt: { ko: "같은 영수증을 이미 올리셨습니다.", en: "This receipt is already attached." },
  receipt_required: { ko: "영수증을 한 장 이상 올려 주세요.", en: "Please add at least one receipt." },
  purpose_required: { ko: "사용 목적을 적어 주세요.", en: "Please enter the purpose." },
  expense_date_required: { ko: "사용일을 넣어 주세요.", en: "Please enter the date." },
  expense_date_in_future: { ko: "사용일이 미래입니다. 날짜를 확인해 주세요.", en: "The date is in the future." },
  lines_required: { ko: "항목과 금액을 넣고 저장해 주세요.", en: "Please add items and save." },
  total_mismatch: { ko: "저장한 뒤에 올려 주세요.", en: "Please save first." },
  legal_name_required: {
    ko: "수표에 쓸 영문 이름이 없습니다. '내 정보'에서 넣어 주세요.",
    en: "Please add your legal name in English under My info.",
  },
  mail_address_required: { ko: "우편으로 받으려면 '내 정보'에 주소를 넣어 주세요.", en: "Please add a mailing address." },
  bad_department: { ko: "사용할 수 없는 부서입니다.", en: "This department is not available." },
  bad_amount: { ko: "금액을 확인해 주세요. 예: 128.40", en: "Please check the amount." },
  bad_lines: { ko: "항목 내용을 확인해 주세요.", en: "Please check the items." },
  has_claim_no: { ko: "번호가 붙은 청구서는 지울 수 없습니다. 취소를 눌러 주세요.", en: "Numbered claims can only be cancelled." },
  already_approved: { ko: "이미 승인이 시작되어 도로 가져올 수 없습니다.", en: "Approval already started." },
  not_cleared: { ko: "사무실의 대면 확인 후에 결재할 수 있습니다.", en: "An in-person check by the office is required." },
  no_dept_head: { ko: "이 부서에 부장이 지정되어 있지 않습니다. 사무실에 알렸습니다.", en: "No department head is assigned." },
  no_elder: { ko: "이 부서에 담당 장로가 지정되어 있지 않습니다. 사무실에 알렸습니다.", en: "No elder is assigned." },
  approver_not_active: { ko: "결재하실 분이 아직 확인되지 않았습니다. 사무실에 알렸습니다.", en: "An approver is not set up yet." },
  no_independent_approver: { ko: "본인 외에 결재할 분이 없습니다. 사무실에 알렸습니다.", en: "No independent approver." },
  not_finance: { ko: "이 청구서를 처리할 수 없습니다(본인 청구이거나 결재하신 건).", en: "You cannot handle this claim." },
  not_author: { ko: "본인이 쓴 청구서만 고칠 수 있습니다.", en: "Only the author can do this." },
  kakao_state_mismatch: {
    ko: "로그인 도중 브라우저가 바뀌었습니다. 처음 연 화면에서 다시 로그인해 주세요.",
    en: "The browser changed during sign-in. Please sign in again.",
  },
  kakao_denied: { ko: "카카오 로그인을 취소했거나 동의하지 않았습니다.", en: "Kakao sign-in was cancelled." },
  kakao_failed: { ko: "카카오 로그인에 실패했습니다. 다시 시도해 주세요.", en: "Kakao sign-in failed." },
  kakao_unavailable: { ko: "카카오에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", en: "Could not reach Kakao." },
  auth_failed: { ko: "로그인을 마치지 못했습니다. 다시 시도해 주세요.", en: "Sign-in failed." },
  bad_request: { ko: "입력 내용을 확인해 주세요.", en: "Please check what you entered." },
  bad_type: { ko: "사진(JPG·PNG) 또는 PDF만 올릴 수 있습니다.", en: "Only photos (JPG, PNG) or PDF files." },
  heic_unsupported: {
    ko: "이 사진 형식(HEIC)은 올릴 수 없습니다. 휴대폰 카메라 설정에서 '높은 호환성'을 고르거나 화면을 캡처해 올려 주세요.",
    en: "HEIC photos cannot be used. Choose 'Most Compatible' in camera settings or upload a screenshot.",
  },
  upload_failed: { ko: "올리지 못했습니다. 잠시 후 다시 해 주세요.", en: "Upload failed. Please try again." },
  too_many_receipts: { ko: "영수증은 한 청구서에 20장까지 올릴 수 있습니다.", en: "Up to 20 receipts per claim." },
  missing_object: { ko: "파일이 저장되지 않았습니다. 다시 올려 주세요.", en: "The file was not stored. Please try again." },
  bad_path: { ko: "잘못된 요청입니다.", en: "Invalid request." },
  bad_hash: { ko: "잘못된 요청입니다.", en: "Invalid request." },
  too_long: { ko: "글이 너무 깁니다. 줄여 주세요.", en: "The text is too long." },
  bad_lang: { ko: "언어 설정을 확인해 주세요.", en: "Please check the language." },
  bad_email: { ko: "메일 주소를 확인해 주세요.", en: "Please check the email address." },
  bad_delivery: { ko: "수표 받는 방법을 골라 주세요.", en: "Please choose how to receive the check." },
  name_required: { ko: "이름을 넣어 주세요.", en: "Please enter a name." },
  dup_note_required: {
    ko: "중복 의심 건입니다. 확인한 내용을 적어 주세요.",
    en: "Possible duplicate: please write what you checked.",
  },
  use_delete: { ko: "작성 중인 청구서는 '지우기'를 눌러 주세요.", en: "Use Delete for drafts." },
  use_confirm_in_person: { ko: "사용 시작은 '대면 확인 완료'로 해 주세요.", en: "Use 'Confirm in person' to activate." },
  not_suspended: { ko: "정지된 분이 아닙니다.", en: "This person is not suspended." },
  cannot_change_self: { ko: "본인 상태는 바꿀 수 없습니다.", en: "You cannot change your own status." },
  cannot_confirm_self: { ko: "본인은 대면 확인할 수 없습니다.", en: "You cannot confirm yourself." },
  check_no_taken: { ko: "이미 쓴 수표 번호입니다(무효 수표 포함).", en: "This check number was already used." },
  check_no_invalid: { ko: "수표 번호는 숫자만 넣어 주세요.", en: "Check numbers are digits only." },
  amount_mismatch: {
    ko: "수표 금액이 고른 청구서 합계와 다릅니다. 다시 확인해 주세요.",
    en: "The check amount does not match the selected claims.",
  },
  issuer_cannot_clear: {
    ko: "수표를 기록한 분은 결제 확인을 할 수 없습니다. 다른 재정부원께 부탁해 주세요.",
    en: "Another finance member must record that this check cleared.",
  },
  issued_before_void: { ko: "재발행 날짜는 무효 처리한 날 이후여야 합니다.", en: "Reissue date must be after the void." },
};

const fallback: Entry = { ko: "처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", en: "Something went wrong. Please try again." };

/**
 * Screen text for an error code. Without a language, both languages are
 * returned on two lines (Korean first), because one shared link is used by
 * Korean and English speakers. Show with `white-space: pre-line`.
 */
export function errorMessage(code: string, lang?: Lang): string {
  const e = errorText[code] ?? fallback;
  return lang ? e[lang] : `${e.ko}\n${e.en}`;
}

/** Extract our short error code from a Postgres error message. */
export function errorCode(message: string | undefined | null): string {
  if (!message) return "unknown";
  const m = /^[a-z_]+$/.exec(message.trim());
  return m ? m[0] : "unknown";
}
