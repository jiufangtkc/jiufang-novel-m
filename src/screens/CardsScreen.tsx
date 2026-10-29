import { CardsIcon } from '../components/Icons';

export function CardsScreen() {
  return (
    <div className="page" data-testid="cards-screen">
      <header className="topbar">
        <h1>資料集</h1>
      </header>
      <div className="placeholder">
        <CardsIcon size={36} />
        <p>資料集會在後續階段開放。</p>
        <p className="hint">這個樣品先把底部的「資料集」留在導覽列上，點了不會讀取任何書稿。</p>
      </div>
    </div>
  );
}
