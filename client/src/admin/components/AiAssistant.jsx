import { useEffect, useRef, useState, useMemo } from 'react';
import { useLocation } from 'react-router-dom';

// Map URL path prefixes to KB module names so the assistant loads relevant context first.
const PATH_MODULE_MAP = [
  ['/contacts',              'contacts'],
  ['/organizations',         'organizations'],
  ['/deals',                 'deals'],
  ['/pipeline',              'deals'],
  ['/tasks',                 'tasks'],
  ['/invoices',              'invoices'],
  ['/recurring',             'invoices'],
  ['/subscriptions',         'subscriptions'],
  ['/transactions',          'billing'],
  ['/billing',               'billing'],
  ['/comms/templates',       'email_templates'],
  ['/comms',                 'communications'],
  ['/website',               'website_builder'],
  ['/media',                 'website_builder'],
  ['/blog-posts',            'blog'],
  ['/forms',                 'forms'],
  ['/marketing',             'social'],
  ['/reports/seo-settings',  'seo'],
  ['/admin/ai-kb',           'ai'],
  ['/settings',              'settings'],
  ['/portal',                'portal'],
  ['/users',                 'admin'],
  ['/roles',                 'admin'],
  ['/admin',                 'admin'],
  ['/dashboard',             'dashboard'],
];

function currentModule(pathname) {
  for (const [prefix, mod] of PATH_MODULE_MAP) {
    if (pathname.startsWith(prefix)) return mod;
  }
  return null;
}

const TOKEN_KEY = 'lc_impersonate_token';
const TOKEN_REAL = 'lc_token';

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_REAL) || '';
}

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api`
  : '/api';

// ── KB Browse mode — shown when no API key is configured ────────────────────
function KbBrowser() {
  const [articles, setArticles] = useState([]);
  const [search, setSearch]     = useState('');
  const [open, setOpen]         = useState(null); // expanded article id

  useEffect(() => {
    fetch(`${API_BASE}/ai/kb`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then((r) => r.json())
      .then((d) => setArticles(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return articles;
    return articles.filter(
      (a) => a.title.toLowerCase().includes(q) || a.content.toLowerCase().includes(q),
    );
  }, [articles, search]);

  // Group by module
  const grouped = useMemo(() => {
    const g = {};
    for (const a of filtered) { (g[a.module] = g[a.module] || []).push(a); }
    return g;
  }, [filtered]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--bs-border-color, #dee2e6)' }}>
        <input
          className="form-control form-control-sm"
          placeholder="Search help articles…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(null); }}
          autoFocus
        />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }}>
        {filtered.length === 0 && (
          <div className="text-muted small px-3 py-4 text-center">No articles found.</div>
        )}
        {Object.entries(grouped).map(([mod, arts]) => (
          <div key={mod}>
            <div
              className="text-uppercase fw-bold px-3 pt-2 pb-1"
              style={{ fontSize: '0.68rem', color: 'var(--bs-secondary-color, #6c757d)', letterSpacing: '0.06em' }}
            >
              {mod}
            </div>
            {arts.map((a) => (
              <div key={a.id}>
                <button
                  onClick={() => setOpen(open === a.id ? null : a.id)}
                  style={{
                    width: '100%', textAlign: 'left', background: open === a.id ? 'var(--bs-primary-bg-subtle, #fff3ed)' : 'transparent',
                    border: 'none', padding: '8px 14px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    cursor: 'pointer', color: 'var(--bs-body-color)',
                  }}
                >
                  <span style={{ fontSize: '0.85rem', fontWeight: open === a.id ? 600 : 400 }}>{a.title}</span>
                  <iconify-icon
                    icon={open === a.id ? 'solar:alt-arrow-up-line-duotone' : 'solar:alt-arrow-down-line-duotone'}
                    style={{ fontSize: 16, flexShrink: 0, color: 'var(--bs-secondary-color, #6c757d)' }}
                  />
                </button>
                {open === a.id && (
                  <div
                    style={{
                      margin: '0 14px 8px',
                      padding: '12px',
                      background: 'var(--bs-secondary-bg, #f8f8f8)',
                      borderRadius: 8,
                      fontSize: '0.82rem',
                      lineHeight: 1.65,
                      whiteSpace: 'pre-wrap',
                      color: 'var(--bs-body-color)',
                    }}
                  >
                    {a.content}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--bs-border-color, #dee2e6)', fontSize: '0.75rem', color: 'var(--bs-secondary-color, #6c757d)', textAlign: 'center' }}>
        AI chat requires an Anthropic API key —{' '}
        <a href="/admin/settings?tab=ai" style={{ color: 'var(--brand)' }}>configure in Settings</a>
      </div>
    </div>
  );
}

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`d-flex mb-3 ${isUser ? 'justify-content-end' : 'justify-content-start'}`}>
      {!isUser && (
        <div
          style={{
            width: 28, height: 28, borderRadius: '50%', background: 'var(--brand)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, marginRight: 8, marginTop: 2,
          }}
        >
          <iconify-icon icon="solar:stars-line-duotone" style={{ color: 'white', fontSize: 16 }}></iconify-icon>
        </div>
      )}
      <div
        style={{
          maxWidth: '80%',
          background: isUser ? 'var(--brand)' : 'var(--bs-secondary-bg, #f0f0f0)',
          color: isUser ? '#fff' : 'inherit',
          borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          padding: '10px 14px',
          fontSize: '0.875rem',
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {msg.content}
        {msg.streaming && (
          <span style={{ display: 'inline-block', width: 8, height: 14, background: 'currentColor', opacity: 0.6, marginLeft: 2, borderRadius: 2, verticalAlign: 'middle', animation: 'ai-blink 1s step-end infinite' }} />
        )}
      </div>
    </div>
  );
}

export default function AiAssistant({ open, onClose }) {
  const location  = useLocation();
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [streaming, setStreaming] = useState(false);
  const [available, setAvailable] = useState(true);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const abortRef  = useRef(null);

  // Check if AI is configured on first open
  useEffect(() => {
    if (!open) return;
    fetch(`${API_BASE}/ai/status`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then((r) => r.json())
      .then((d) => setAvailable(d.available !== false))
      .catch(() => {});
  }, [open]);

  // Seed a greeting when first opened
  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: 'Hi! I\'m your localCRM assistant. Ask me anything about using the application — how to create records, configure integrations, set up billing, and more.',
      }]);
    }
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg  = { role: 'user', content: text };
    const history  = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setStreaming(true);

    // Placeholder for the streaming assistant reply
    const assistantIdx = history.length;
    setMessages((prev) => [...prev, { role: 'assistant', content: '', streaming: true }]);

    const mod = currentModule(location.pathname);

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const resp = await fetch(`${API_BASE}/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          module: mod,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Request failed' }));
        setMessages((prev) => {
          const next = [...prev];
          next[assistantIdx] = { role: 'assistant', content: err.error || 'Something went wrong. Please try again.' };
          return next;
        });
        setStreaming(false);
        return;
      }

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') { setStreaming(false); break; }
          try {
            const parsed = JSON.parse(raw);
            if (parsed.error) {
              setMessages((prev) => {
                const next = [...prev];
                next[assistantIdx] = { role: 'assistant', content: `Error: ${parsed.error}` };
                return next;
              });
              setStreaming(false);
              return;
            }
            if (parsed.text) {
              setMessages((prev) => {
                const next = [...prev];
                next[assistantIdx] = {
                  role: 'assistant',
                  content: (next[assistantIdx]?.content || '') + parsed.text,
                  streaming: true,
                };
                return next;
              });
            }
          } catch { /* non-JSON line */ }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages((prev) => {
          const next = [...prev];
          next[assistantIdx] = { role: 'assistant', content: 'Connection error. Please try again.' };
          return next;
        });
      }
    } finally {
      setStreaming(false);
      setMessages((prev) => {
        const next = [...prev];
        if (next[assistantIdx]) next[assistantIdx] = { ...next[assistantIdx], streaming: false };
        return next;
      });
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function clearChat() {
    abortRef.current?.abort();
    setStreaming(false);
    setMessages([{
      role: 'assistant',
      content: 'Chat cleared. What would you like to know?',
    }]);
  }

  if (!open) return null;

  return (
    <>
      {/* Blink animation */}
      <style>{`@keyframes ai-blink { 0%,100%{opacity:0.6} 50%{opacity:0} }`}</style>

      {/* Backdrop (mobile) */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 1040,
          background: 'rgba(0,0,0,0.3)',
          display: 'block',
        }}
        className="d-md-none"
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: 400,
          maxWidth: '100vw',
          background: 'var(--bs-body-bg, #fff)',
          borderLeft: '1px solid var(--bs-border-color, #dee2e6)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1045,
          boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid var(--bs-border-color, #dee2e6)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--brand)',
          }}
        >
          <iconify-icon icon="solar:stars-line-duotone" style={{ color: 'white', fontSize: 22, flexShrink: 0 }}></iconify-icon>
          <div style={{ flex: 1 }}>
            <div style={{ color: 'white', fontWeight: 700, fontSize: '0.95rem' }}>AI Assistant</div>
            <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.75rem' }}>
              {available ? 'localCRM support · AI chat' : 'Knowledge base · AI chat not configured'}
            </div>
          </div>
          <button
            onClick={clearChat}
            title="Clear chat"
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}
          >
            Clear
          </button>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
            title="Close"
          >
            <iconify-icon icon="solar:close-circle-line-duotone" style={{ fontSize: 22 }}></iconify-icon>
          </button>
        </div>

        {/* KB Browse mode — shown when no API key */}
        {!available && <KbBrowser />}

        {/* Chat mode — shown when API key is configured */}
        {available && <>
          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px' }}>
            {messages.map((m, i) => <MessageBubble key={i} msg={m} />)}
            <div ref={bottomRef} />
          </div>

          {/* Suggested starters */}
          {messages.length === 1 && (
            <div style={{ padding: '0 14px 10px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[
                'How do I create an invoice?',
                'How do I import from ConnectWise?',
                'How do I set up email?',
                'How do automations work?',
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); setTimeout(sendMessage, 0); }}
                  style={{
                    border: '1px solid var(--brand)',
                    background: 'transparent',
                    color: 'var(--brand)',
                    borderRadius: 20,
                    padding: '4px 12px',
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{ padding: '12px 14px', borderTop: '1px solid var(--bs-border-color, #dee2e6)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Ask anything about localCRM…"
                disabled={streaming}
                style={{
                  flex: 1, resize: 'none', borderRadius: 12,
                  border: '1px solid var(--bs-border-color, #dee2e6)',
                  padding: '8px 12px', fontSize: '0.875rem', lineHeight: 1.4,
                  background: 'var(--bs-body-bg, #fff)', color: 'var(--bs-body-color, #000)',
                  outline: 'none', maxHeight: 120, overflow: 'hidden auto',
                }}
                onInput={(e) => {
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                }}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || streaming}
                style={{
                  width: 44, height: 44, borderRadius: '50%', background: 'var(--brand)',
                  border: 'none', color: 'white', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
                  opacity: (!input.trim() || streaming) ? 0.5 : 1, transition: 'opacity .15s',
                }}
              >
                {streaming
                  ? <iconify-icon icon="solar:refresh-line-duotone" style={{ fontSize: 18, animation: 'spin 1s linear infinite' }}></iconify-icon>
                  : <iconify-icon icon="solar:arrow-up-line-duotone" style={{ fontSize: 18 }}></iconify-icon>
                }
              </button>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--bs-secondary-color, #6c757d)', marginTop: 6, textAlign: 'center' }}>
              Press Enter to send · Shift+Enter for new line
            </div>
          </div>
        </>}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
