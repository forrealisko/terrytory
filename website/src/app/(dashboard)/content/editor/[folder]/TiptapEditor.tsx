"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { useEffect, forwardRef, useImperativeHandle } from "react";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { marked } from "marked";

// --- Custom Resizable Image Node View ---
const ResizableImageNode = (props: any) => {
  return (
    <NodeViewWrapper className="resizable-image-wrapper">
      <div
        className="resizable-image-container"
        style={{
          width: props.node.attrs.width || "100%",
          textAlign: props.node.attrs.textAlign || "center",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={props.node.attrs.src}
          alt={props.node.attrs.alt}
          title={props.node.attrs.title}
          style={{ width: "100%", height: "auto", display: "inline-block", borderRadius: "8px" }}
        />
        {/* We can add resize handles here later */}
      </div>
    </NodeViewWrapper>
  );
};

const CustomImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: "100%",
      },
      textAlign: {
        default: "center",
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageNode);
  },
});

interface TiptapEditorProps {
  initialContent: string;
  isMarkdown?: boolean;
  onChange: (html: string) => void;
}

export interface TiptapRef {
  insertImage: (url: string) => void;
}

const TiptapEditor = forwardRef<TiptapRef, TiptapEditorProps>(
  ({ initialContent, isMarkdown, onChange }, ref) => {
    const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [2, 3],
        },
      }),
      CustomImage,
      Link.configure({
        openOnClick: false,
      }),
      TextAlign.configure({
        types: ["heading", "paragraph", "image"],
      }),
    ],
    content: isMarkdown ? (marked.parse(initialContent) as string) : initialContent,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "tiptap-content ed-textarea",
      },
    },
  });

  // Effect to update content if it comes in late
  useEffect(() => {
    if (editor && initialContent && editor.isEmpty) {
      editor.commands.setContent(isMarkdown ? (marked.parse(initialContent) as string) : initialContent);
    }
  }, [editor, initialContent, isMarkdown]);

  useImperativeHandle(ref, () => ({
    insertImage: (url: string) => {
      if (editor) {
        editor.chain().focus().setImage({ src: url }).run();
      }
    },
  }));

  if (!editor) {
    return null;
  }

  return (
    <div className="tiptap-container">
      {editor && (
        <BubbleMenu editor={editor} className="ed-bubble-menu">
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={editor.isActive("bold") ? "is-active" : ""}
          >
            B
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={editor.isActive("italic") ? "is-active" : ""}
          >
            I
          </button>
          <div className="sep" />
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={editor.isActive("heading", { level: 2 }) ? "is-active" : ""}
          >
            H2
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={editor.isActive("heading", { level: 3 }) ? "is-active" : ""}
          >
            H3
          </button>
          <div className="sep" />
          <button
            onClick={() => {
              const previousUrl = editor.getAttributes("link").href;
              const url = window.prompt("URL", previousUrl);
              if (url === null) return;
              if (url === "") {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                return;
              }
              editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
            }}
            className={editor.isActive("link") ? "is-active" : ""}
          >
            🔗
          </button>
          <div className="sep" />
          <button className="ai-btn" title="AI Rewrite (Coming Soon)">✨</button>
        </BubbleMenu>
      )}

      <EditorContent editor={editor} />
    </div>
  );
});

export default TiptapEditor;
