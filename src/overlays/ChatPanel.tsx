/**
 * The in-stay assistant.
 *
 * Deliberately not a full-height chat app. It is a compact top sheet that
 * knows where the guest is staying, so the suggestions and the replies name
 * real places on the map rather than talking in general terms.
 *
 * Replies are canned for now; `respondTo` is the single seam where a real
 * model call would go.
 */

import { Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { SheetHeader, TopSheet } from "../ui/sheets/Sheets";
import { CHAT_GREETING, CHAT_SUGGESTIONS, STAY } from "../data/seed";
import type { ChatMessage } from "../data/types";

function respondTo(question: string): string {
  const text = question.toLowerCase();

  if (/tonight|evening|late|night/.test(text)) {
    return "Rooftop jazz starts at 21:00, one floor above your room. If you would rather be outside, the ridge cable car runs until 23:00.";
  }
  if (/near|nearby|close|around|walk/.test(text)) {
    return "Four minutes on foot is the Museum of History. Six minutes the other way is Riverside Table, which has a terrace over the river.";
  }
  if (/hotel|inside|room|spa/.test(text)) {
    return `Inside ${STAY.hotelName} today: the rooftop terrace, a cellar tasting at 18:00 on level −1, and the spa until 22:00.`;
  }
  if (/plan|free|time|day|tomorrow/.test(text)) {
    return "Two steps left on Explore Old Tbilisi. Narikala first while the light is good, then the qvevri cellar on the way back — about three hours together.";
  }
  return "I can point you at something nearby, plan your free time, or find what is open inside the hotel.";
}

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ChatPanel({ open, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([CHAT_GREETING]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | undefined>(undefined);

  // Keep the newest message in view without yanking the whole panel around.
  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, thinking]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  function send(text: string) {
    const question = text.trim();
    if (!question || thinking) return;

    setMessages((current) => [
      ...current,
      { id: `g-${Date.now()}`, author: "guest", text: question },
    ]);
    setDraft("");
    setThinking(true);

    timerRef.current = window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        { id: `a-${Date.now()}`, author: "assistant", text: respondTo(question) },
      ]);
      setThinking(false);
    }, 620);
  }

  return (
    <TopSheet open={open} onClose={onClose} label="Assistant">
      <SheetHeader eyebrow="Assistant" title="Ask about your stay" onClose={onClose} />

      <div className="sheet__body">
        <div className="chat__intro">
          <span className="chat__avatar">
            <Sparkles size={16} strokeWidth={2.2} aria-hidden="true" />
          </span>
          <span>
            <span className="chat__greeting">{CHAT_GREETING.text}</span>
            <span className="chat__caption">
              {STAY.hotelName} · {STAY.daysLeft} days left of Guest Mode
            </span>
          </span>
        </div>

        <div className="chip-row" role="group" aria-label="Suggested questions">
          {CHAT_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="chip"
              onClick={() => send(suggestion)}
              disabled={thinking}
            >
              {suggestion}
            </button>
          ))}
        </div>

        <div
          className="chat__thread scroll-region"
          ref={threadRef}
          role="log"
          aria-live="polite"
          aria-label="Conversation"
        >
          {messages.slice(1).map((message) => (
            <p key={message.id} className="msg" data-author={message.author}>
              {message.text}
            </p>
          ))}
          {thinking ? (
            <p className="msg" data-author="assistant">
              Looking…
            </p>
          ) : null}
        </div>

        <form
          className="chat__composer"
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
        >
          <input
            className="chat__input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask about your stay…"
            aria-label="Message the assistant"
            enterKeyHint="send"
          />
          <button
            type="submit"
            className="chat__send"
            disabled={!draft.trim() || thinking}
            aria-label="Send message"
          >
            <Send size={16} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </form>
      </div>
    </TopSheet>
  );
}
