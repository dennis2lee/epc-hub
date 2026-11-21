import { PrintButton } from "./print-button";

export const metadata = { title: "인쇄 시험 · 교회 지출청구" };

export default function PrintTrialPage() {
  return (
    <main className="page">
      <h1 className="title">인쇄 시험</h1>
      <p>이 화면이 종이 양식처럼 인쇄되는지 확인합니다. 인쇄 대화상자가 열리지 않으면 시험 결과에 적어 주세요.</p>
      <table className="card" style={{ borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <th style={{ padding: 8 }}>작성</th>
            <th style={{ padding: 8 }}>부장</th>
            <th style={{ padding: 8 }}>담당 장로</th>
            <th style={{ padding: 8 }}>재정부 확인</th>
          </tr>
          <tr>
            <td style={{ padding: 8 }}>사람 A</td>
            <td style={{ padding: 8 }}>승인</td>
            <td style={{ padding: 8 }}>승인</td>
            <td style={{ padding: 8 }}>대기</td>
          </tr>
        </tbody>
      </table>
      <PrintButton />
    </main>
  );
}
