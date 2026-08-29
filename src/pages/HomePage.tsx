export default function HomePage({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="home">
      <div className="home-inner">
        <h1 className="home-title">TableReader</h1>
        <p className="home-desc">把剧本拆成角色，让每个角色拥有自己的声音</p>
        <button className="home-cta" onClick={onEnter}>开始使用</button>
      </div>
      <p className="home-sig">Made by 河忐</p>
    </div>
  );
}
