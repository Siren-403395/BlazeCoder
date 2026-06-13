export function PreviewPane({ html, error }: { html?: string; error?: string }) {
  if (error) {
    return <div className="pane-empty pane-error">Preview build failed:<br />{error}</div>;
  }
  if (!html) {
    return <div className="pane-empty">No preview yet — ask the agent to build something.</div>;
  }
  return (
    <iframe
      className="preview-frame"
      title="App preview"
      sandbox="allow-scripts"
      srcDoc={html}
    />
  );
}
