export default function HomePage({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="home" onClick={onEnter}>
      <div className="home-inner">
        <span className="home-eyebrow">SCREENPLAY READING STUDIO</span>
        <h1 className="home-title">剧本围读助手</h1>
        <p className="home-desc">把剧本拆成角色，让每个角色拥有自己的声音</p>
      </div>
      <p className="home-hint">点击进入</p>
    </div>
  );
}
