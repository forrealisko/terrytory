"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Stages {
  scraped: number;
  scrapedNew: number;
  picks: number;
  drafts: number;
  published: number;
}

const STAGE_META = [
  { key: "scraped", label: "Scraped", href: "/admin", color: "#00b0ff", sub: (s: Stages) => `${s.scrapedNew} new this run` },
  { key: "picks", label: "Picked", href: "/admin/content/picking", color: "#f59e0b", sub: () => "awaiting writer" },
  { key: "drafts", label: "Drafted", href: "/admin/content", color: "#a78bfa", sub: () => "awaiting review" },
  { key: "published", label: "Published", href: "/admin/content/published", color: "#00e676", sub: () => "live on the blog" },
] as const;

export function PipelineBoard() {
  const [stages, setStages] = useState<Stages | null>(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/pipeline")
        .then((r) => r.json())
        .then((d) => d.stages && setStages(d.stages))
        .catch(() => {});
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, []);

  if (!stages) {
    return <div className="loading-skeleton" style={{ height: 86, borderRadius: 14, marginBottom: 24 }} />;
  }

  return (
    <div className="pipeline-board">
      {STAGE_META.map((stage) => (
        <Link key={stage.key} href={stage.href} className="pipeline-stage">
          <span className="pipeline-stage-label">
            <span
              className="pipeline-stage-dot"
              style={{ background: stage.color, boxShadow: `0 0 6px ${stage.color}66` }}
            />
            {stage.label}
          </span>
          <span className="pipeline-stage-count">{stages[stage.key].toLocaleString()}</span>
          <span className="pipeline-stage-sub">{stage.sub(stages)}</span>
        </Link>
      ))}
    </div>
  );
}
