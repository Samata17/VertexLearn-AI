import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Renders Markdown safely (react-markdown never injects raw HTML). */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-ai">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ ...p }) => <a {...p} target="_blank" rel="noreferrer" /> }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
