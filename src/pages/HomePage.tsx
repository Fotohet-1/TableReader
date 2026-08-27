export default function HomePage({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="home" onClick={onEnter}>
      <div className="home-inner">
        <h1 className="home-title">剧本围读助手</h1>
        <p className="home-desc">把剧本拆成角色，让每个角色拥有自己的声音</p>
        <button className="home-cta">开始使用</button>
      </div>
    </div>
  );
}
