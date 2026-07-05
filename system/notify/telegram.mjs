/**
 * Telegram notifier — used by the scrape digest and (later) the review loop.
 *
 * Requires TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (env or system/.env).
 * No-ops gracefully when unconfigured so the pipeline never breaks on it.
 */
import { loadEnv } from "../lib/env.mjs";

const API = "https://api.telegram.org";

export function telegramConfigured() {
  loadEnv();
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/**
 * Send a message. `buttons` is an optional array of rows, each row an array of
 * { text, callback_data } or { text, url } — rendered as an inline keyboard.
 */
export async function sendTelegram(text, { buttons, chatId } = {}) {
  loadEnv();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = chatId || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — skipping notify");
    return false;
  }

  const body = {
    chat_id: chat,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (buttons?.length) {
    body.reply_markup = { inline_keyboard: buttons };
  }

  try {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[telegram] send failed ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[telegram] send error: ${err.message}`);
    return false;
  }
}

/** Escape user/content text for Telegram HTML parse mode. */
export function esc(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
