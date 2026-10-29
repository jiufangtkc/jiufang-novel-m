import { CardsIcon } from '../components/Icons';

export function CardsScreen() {
  return (
    <div className="page" data-testid="cards-screen">
      <header className="topbar">
        <h1>資料集</h1>
      </header>
      <div className="placeholder">
        <CardsIcon size={36} />
        <p>資料集還在準備中</p>
        <p className="hint">之後可以在這裡看角色、世界觀和靈感卡片。</p>
      </div>
    </div>
  );
}
