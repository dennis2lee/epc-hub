import { describe, expect, it } from "vitest";
import { detectInApp, externalBrowserUrl } from "./inapp";

const KAKAO_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.9.0";
const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

describe("in-app browser detection", () => {
  it("detects KakaoTalk", () => {
    expect(detectInApp(KAKAO_IOS)).toBe("kakaotalk");
    expect(externalBrowserUrl("https://example.org/claims/1", KAKAO_IOS)).toBe(
      "kakaotalk://web/openExternal?url=https%3A%2F%2Fexample.org%2Fclaims%2F1",
    );
  });

  it("returns null for normal browsers", () => {
    expect(detectInApp(SAFARI)).toBeNull();
    expect(externalBrowserUrl("https://example.org", SAFARI)).toBeNull();
  });
});
