"use client";

import { useEffect, useRef, useState } from "react";
import { MODELS } from "@/lib/models";

interface Message {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
}

// Simple markdown parsing to HTML without heavy external libraries
function renderMarkdown(text: string): string {
  if (!text) return "";
  
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Images
  html = html.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<div class="blog-body-image-container"><img src="$2" alt="$1" class="blog-body-image" /><span class="blog-body-image-caption">$1</span></div>'
  );

  // Code blocks: ```lang ... ```
  html = html.replace(/```(?:[a-zA-Z0-9]+)?\n([\s\S]*?)```/g, '<pre class="code-block"><code>$1</code></pre>');

  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Bold: **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Italic: *text*
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Bullet points: - item or * item
  html = html.replace(/^\s*[-*]\s+(.+)$/gm, "<li>$1</li>");
  // Wrap li groups in ul
  html = html.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>");
  
  // Links: [Text](URL)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Convert newlines to br, except inside pre blocks and image divs
  const parts = html.split(/(<pre[\s\S]*?<\/pre>|<div[\s\S]*?<\/div>)/);
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i].startsWith("<pre") && !parts[i].startsWith("<div")) {
      parts[i] = parts[i].replace(/\n/g, "<br />");
    }
  }
  return parts.join("");
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hello! I am your Terrytory intelligence assistant. I have direct access to all your scraped UAP/UFO articles. Ask me anything about recent articles, source comparisons, or summary trends!",
    },
  ]);
  const [inputText, setInputText] = useState("");
  const [selectedModel, setSelectedModel] = useState("deepseek/deepseek-r1");
  const [includeContext, setIncludeContext] = useState(true);
  const [loading, setLoading] = useState(false);
  const [expandedReasoning, setExpandedReasoning] = useState<Record<number, boolean>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isLoadedRef = useRef(false);

  // Load chat state from localStorage once on mount
  useEffect(() => {
    const savedMessages = localStorage.getItem("terrytory_chat_messages");
    if (savedMessages) {
      try {
        setMessages(JSON.parse(savedMessages));
      } catch (e) {
        console.error("Failed to parse saved chat messages", e);
      }
    }

    const savedModel = localStorage.getItem("terrytory_chat_model");
    if (savedModel) {
      setSelectedModel(savedModel);
    }

    const savedContext = localStorage.getItem("terrytory_chat_include_context");
    if (savedContext !== null) {
      setIncludeContext(savedContext === "true");
    }
    
    isLoadedRef.current = true;
  }, []);

  // Save chat messages to localStorage when they change
  useEffect(() => {
    if (isLoadedRef.current) {
      localStorage.setItem("terrytory_chat_messages", JSON.stringify(messages));
    }
  }, [messages]);

  // Save model selection to localStorage
  useEffect(() => {
    if (isLoadedRef.current) {
      localStorage.setItem("terrytory_chat_model", selectedModel);
    }
  }, [selectedModel]);

  // Save context setting to localStorage
  useEffect(() => {
    if (isLoadedRef.current) {
      localStorage.setItem("terrytory_chat_include_context", String(includeContext));
    }
  }, [includeContext]);

  // Keep chat viewport scrolled to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const toggleReasoning = (index: number) => {
    setExpandedReasoning((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const handleClearChat = () => {
    const defaultMsg: Message[] = [
      {
        role: "assistant",
        content: "Hello! I am your Terrytory intelligence assistant. I have direct access to all your scraped UAP/UFO articles. Ask me anything about recent articles, source comparisons, or summary trends!",
      },
    ];
    setMessages(defaultMsg);
    setExpandedReasoning({});
    localStorage.setItem("terrytory_chat_messages", JSON.stringify(defaultMsg));
  };

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!inputText.trim() || loading) return;

    const userMessage = inputText;
    setInputText("");

    // Add user message to history
    const updatedMessages: Message[] = [...messages, { role: "user", content: userMessage }];
    setMessages(updatedMessages);
    setLoading(true);

    try {
      // Map message history to standard API format
      const apiMessages = updatedMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // OpenRouter request options
      const options: Record<string, unknown> = {
        model: selectedModel,
        messages: apiMessages,
        includeScrapedContext: includeContext,
      };

      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `⚠️ Error from API: ${data.error || "Failed to fetch response."}`,
          },
        ]);
      } else {
        const choice = data.choices?.[0]?.message;
        let content = choice?.content || "No reply returned.";
        let reasoning = choice?.reasoning || choice?.reasoning_content || "";

        // Fallback parser if thinking tags are embedded directly in the main text block
        if (content.includes("<think>")) {
          const parts = content.split("</think>");
          if (parts.length > 1) {
            reasoning = parts[0].replace("<think>", "").trim();
            content = parts.slice(1).join("</think>").trim();
          }
        }

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content,
            reasoning: reasoning || undefined,
          },
        ]);

        // Auto-expand reasoning for the newly added assistant reply
        if (reasoning) {
          setExpandedReasoning((prev) => ({
            ...prev,
            [updatedMessages.length]: true,
          }));
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ Network error: ${(err as Error).message}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  // Find currently selected model metadata
  const currentModel = MODELS.find((m) => m.id === selectedModel);

  return (
    <div className="chat-layout">
      {/* Header Panel */}
      <header className="main-header" style={{ flexShrink: 0 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <h2>AI Intelligence Assistant</h2>
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
            Chat with model endpoints loaded with active scrape articles
          </span>
        </div>

        <div className="main-header-actions" style={{ gap: 16 }}>
          {/* Model selection */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Model:</span>
            <select
              className="input-field"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              style={{
                fontFamily: "var(--font-sans)",
                padding: "6px 12px",
                height: 36,
                fontSize: 13,
                minWidth: 220,
              }}
            >
              <optgroup label="⚡ Reasoning / Thinking">
                {MODELS.filter((m) => m.type === "thinking").map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.provider} — {m.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="🔮 Standard">
                {MODELS.filter((m) => m.type === "standard").map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.provider} — {m.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          {/* Model type indicator */}
          {currentModel?.type === "thinking" && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--accent-brand)",
                padding: "3px 8px",
                borderRadius: 6,
                border: "1px solid rgba(0, 230, 118, 0.2)",
                background: "rgba(0, 230, 118, 0.05)",
                textTransform: "uppercase",
                letterSpacing: "0.03em",
              }}
            >
              ⚡ Thinking
            </span>
          )}

          {/* Clear Conversation */}
          <button
            type="button"
            onClick={handleClearChat}
            style={{
              padding: "6px 12px",
              height: 36,
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 6,
              background: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.15)",
              color: "#f87171",
              cursor: "pointer",
              fontWeight: 500,
              fontFamily: "var(--font-sans)",
              transition: "all 0.2s ease",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)";
              e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.3)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "rgba(239, 68, 68, 0.08)";
              e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.15)";
            }}
          >
            Clear Conversation
          </button>
        </div>
      </header>

      {/* Message Feed */}
      <div className="chat-messages-container">
        {messages.map((m, idx) => (
          <div key={idx} className={`chat-message-row ${m.role}`}>
            <div className="chat-bubble">
              {/* Reasoning Block */}
              {m.role === "assistant" && m.reasoning && (
                <div className="thinking-card">
                  <div
                    className={`thinking-card-header ${expandedReasoning[idx] ? "open" : ""}`}
                    onClick={() => toggleReasoning(idx)}
                  >
                    <span>⚡ Thinking Process</span>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                  {expandedReasoning[idx] && (
                    <div className="thinking-content">{m.reasoning}</div>
                  )}
                </div>
              )}

              {/* Message Content */}
              <div
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(m.content),
                }}
              />
            </div>
          </div>
        ))}

        {loading && (
          <div className="chat-message-row assistant">
            <div className="chat-bubble" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="loading-spinner" style={{ width: 14, height: 14 }} />
              <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Assistant is typing...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Bottom Input Area */}
      <form onSubmit={handleSendMessage} className="chat-input-bar" style={{ flexShrink: 0 }}>
        <div className="chat-input-wrapper">
          <textarea
            className="chat-textarea"
            placeholder="Ask me anything about UAPs or scraped news articles..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage(e);
              }
            }}
            rows={1}
          />
          <button
            type="submit"
            className="chat-send-btn"
            disabled={loading || !inputText.trim()}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>

        <div className="chat-meta-bar">
          <label className="chat-context-toggle">
            <input
              type="checkbox"
              className="switch-input"
              checked={includeContext}
              onChange={(e) => setIncludeContext(e.target.checked)}
            />
            <span className="switch-label" />
            <span style={{ fontSize: 12, fontWeight: 500 }}>
              Inject Scraped Articles Context ({includeContext ? "Active" : "Disabled"})
            </span>
          </label>
          <span style={{ fontSize: 11, opacity: 0.8 }}>
            Press Enter to Send, Shift+Enter for newline
          </span>
        </div>
      </form>
    </div>
  );
}
