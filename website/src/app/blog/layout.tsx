import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TERRYTORY",
  description: "Independent, AI-assisted journalism across technology, AI, and more.",
};

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="blog-layout">
      {/* Blog Header */}
      <header className="blog-header">
        <div className="blog-header-inner">
          <a href="/blog" className="blog-brand">
            <span className="blog-brand-icon">T</span>
            <span className="blog-brand-text">TERRYTORY</span>
          </a>
          <nav className="blog-nav">
            <a href="/blog" className="blog-nav-link">
              Articles
            </a>
            <a href="/admin" className="blog-nav-link blog-nav-link-admin">
              Dashboard
            </a>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="blog-main">{children}</main>

      {/* Footer */}
      <footer className="blog-footer">
        <div className="blog-footer-inner">
          <span className="blog-footer-brand">
            TERRYTORY © {new Date().getFullYear()}
          </span>
          <span className="blog-footer-tagline">
            Independent, AI-assisted journalism
          </span>
        </div>
      </footer>
    </div>
  );
}
