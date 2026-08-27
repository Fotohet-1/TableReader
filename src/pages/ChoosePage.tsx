export default function ChoosePage({ onUpload, onContinue }: {
  onUpload: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="choose-page">
      <div className="choose-inner">
        <span className="choose-eyebrow">SCREENPLAY READING STUDIO</span>
        <h1 className="choose-title">开始围读</h1>
        <div className="choose-cards">
          <button className="choose-card" onClick={onUpload}>
            <span className="choose-card-mark">01</span>
            <span className="choose-card-title">上传新剧本</span>
            <span className="choose-card-desc">解析角色、分配音色，开始一场新的围读</span>
          </button>
          <button className="choose-card" onClick={onContinue}>
            <span className="choose-card-mark">02</span>
            <span className="choose-card-title">继续围读</span>
            <span className="choose-card-desc">从本地存档接着上次的位置读下去</span>
          </button>
        </div>
      </div>
    </div>
  );
}
