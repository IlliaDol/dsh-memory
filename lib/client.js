/**
 * dsh-memory, browser half.
 *
 * One Settings page: a list of remembered facts, an input to add one, a
 * Delete per row, and a Clear-all behind a confirm. Everything talks to
 * /api/dsh-memory/items on the host's authenticated channel.
 *
 * Written as the module-loader CJS envelope by hand, so no bundler is needed.
 */
window.__ModuleLoader__.load({
  id: 'dsh-memory',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require('react');
    const h = React.createElement;

    const API = '/api/dsh-memory/items';

    /** Shell tokens, with fallbacks so the panel reads on older shells. */
    const T = {
      text: 'var(--dsw-alias-label-primary, #f0efec)',
      dim: 'var(--dsw-alias-label-secondary, #c3c2b7)',
      muted: 'var(--dsw-alias-label-tertiary, #8a8782)',
      border: 'var(--dsw-alias-border-l2, #33332f)',
      surface: 'var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-1, #1c1c1a))',
      danger: 'var(--dsw-alias-label-error, #e66767)',
      radius: 'var(--dsw-radius-md, 8px)',
    };

    /** A fact's text: one long unbroken token must wrap, not run out of the row. */
    const FACT_TEXT = {
      margin: 0,
      fontSize: 13,
      lineHeight: 1.55,
      color: T.text,
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      wordBreak: 'break-word',
      maxWidth: '100%',
    };

    /**
     * Call the memory API.
     * @param {string} method HTTP method
     * @param {any} [body] JSON body
     * @returns {Promise<any>} parsed response
     */
    async function call(method, body) {
      const response = await fetch(API, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `request failed (${response.status})`);
      return data;
    }

    /**
     * The Memory settings page.
     * @returns {any} React element
     */
    function MemoryPanel() {
      const [items, setItems] = React.useState([]);
      const [draft, setDraft] = React.useState('');
      const [status, setStatus] = React.useState('loading');
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [limit, setLimit] = React.useState(300);
      const [maxText, setMaxText] = React.useState(600);
      const [expanded, setExpanded] = React.useState({});

      const apply = (data) => {
        setItems(Array.isArray(data.items) ? data.items : []);
        if (typeof data.limit === 'number') setLimit(data.limit);
        if (typeof data.maxText === 'number') setMaxText(data.maxText);
      };

      React.useEffect(() => {
        let alive = true;
        call('GET')
          .then((data) => {
            if (!alive) return;
            apply(data);
            setStatus('ready');
          })
          .catch((cause) => {
            if (!alive) return;
            setError(cause.message || 'Memory API is not available on this host.');
            setStatus('error');
          });
        return () => {
          alive = false;
        };
      }, []);

      const run = async (body) => {
        setBusy(true);
        setError('');
        try {
          const data = await call('POST', body);
          apply(data);
          return true;
        } catch (cause) {
          setError(cause.message || 'That change did not stick.');
          return false;
        } finally {
          setBusy(false);
        }
      };

      const add = async (event) => {
        event?.preventDefault();
        const text = draft.trim();
        if (text.length === 0) {
          setError('Write the fact first.');
          return;
        }
        const ok = await run({ action: 'add', text });
        if (ok) setDraft('');
      };

      const remove = async (id) => {
        await run({ action: 'remove', id });
      };

      const clear = async () => {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function'
          && !window.confirm('Delete every remembered item? A copy of the list is kept at memory.json.bak.')) return;
        await run({ action: 'clear' });
      };

      const header = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('h2', { style: { margin: 0, fontSize: 18, fontWeight: 600, color: T.text } }, 'Memory'),
        h('p', { style: { margin: 0, fontSize: 13, lineHeight: 1.5, color: T.dim } },
          'Facts every new session should know. Each one is its own row, so you can delete one without rewriting the rest.'),
      );

      if (status === 'loading') {
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 } },
          header,
          h('p', { style: { margin: 0, fontSize: 13, color: T.muted } }, 'Loading…'),
        );
      }

      if (status === 'error') {
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 } },
          header,
          h('div', { role: 'alert', style: { border: `1px solid ${T.border}`, borderRadius: T.radius, padding: '10px 12px', fontSize: 13, color: T.danger } }, error),
          h('p', { style: { margin: 0, fontSize: 12, color: T.muted } },
            'The panel needs the dsh-memory host half. Install the plugin, restart the profile, then reopen Settings.'),
        );
      }

      const form = h('form', { onSubmit: add, style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('label', { htmlFor: 'dsh-memory-draft', style: { fontSize: 12, fontWeight: 500, color: T.dim } }, 'Add a fact'),
        h('textarea', {
          id: 'dsh-memory-draft',
          value: draft,
          rows: 2,
          maxLength: maxText,
          placeholder: 'e.g. Prefers pnpm; never run tests against production.',
          onChange: (event) => setDraft(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) add(event);
          },
          style: {
            width: '100%',
            resize: 'vertical',
            font: 'inherit',
            fontSize: 13,
            lineHeight: 1.5,
            color: T.text,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: T.radius,
            colorScheme: 'inherit',
            padding: '8px 10px',
          },
        }),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          h('button', { type: 'submit', disabled: busy || draft.trim().length === 0, style: { fontSize: 13 } }, busy ? 'Saving…' : 'Add'),
          h('span', { style: { fontSize: 11, color: T.muted } }, `${draft.length}/${maxText} · ${items.length}/${limit} saved`),
        ),
      );

      const rows = items.map((item) => {
        const text = String(item.text ?? '');
        // Three lines by default. A 600-character fact used to take the whole
        // page; the row now stays scannable and the rest is one click away.
        const long = text.length > 220 || text.split('\n').length > 3;
        const open = expanded[item.id] === true;
        const clamped = long && !open;
        return h('div', {
          key: item.id,
          style: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: '10px 0',
            borderTop: `1px solid ${T.border}`,
          },
        },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('p', {
            style: clamped ? { ...FACT_TEXT, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : FACT_TEXT,
          }, text),
          long ? h('button', {
            type: 'button',
            onClick: () => setExpanded((previous) => ({ ...previous, [item.id]: !previous[item.id] })),
            style: { marginTop: 2, padding: 0, fontSize: 12, color: T.dim, background: 'transparent', border: 'none', cursor: 'pointer' },
          }, open ? 'Show less' : `Show more (${text.length} characters)`) : null,
          h('p', { style: { margin: '4px 0 0', fontSize: 11, color: T.muted } },
            `${item.source === 'model' ? 'Remembered by the model' : 'Added by you'} · ${String(item.createdAt || '').slice(0, 10)}`),
        ),
        h('button', {
          type: 'button',
          disabled: busy,
          'aria-label': `Delete: ${text.slice(0, 60)}`,
          onClick: () => remove(item.id),
          style: { flex: 'none', fontSize: 12, color: T.danger, background: 'transparent', border: 'none', padding: '2px 4px' },
        }, 'Delete'),
        );
      });

      const empty = h('div', {
        style: { border: `1px dashed ${T.border}`, borderRadius: T.radius, padding: '24px 16px', textAlign: 'center' },
      },
      h('p', { style: { margin: 0, fontSize: 13, color: T.dim } }, 'Nothing remembered yet.'),
      h('p', { style: { margin: '4px 0 0', fontSize: 12, color: T.muted } }, 'Add a fact above, type /remember <fact> in a chat, or say “remember that…”.'));

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 } },
        header,
        form,
        error.length > 0 ? h('div', { role: 'alert', style: { fontSize: 12, color: T.danger } }, error) : null,
        items.length === 0 ? empty : h('div', { style: { display: 'flex', flexDirection: 'column' } }, rows),
        items.length > 0 ? h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h('span', { style: { fontSize: 11, color: T.muted } }, 'Injected into the system prompt of every new session.'),
          h('button', { type: 'button', disabled: busy, onClick: clear, style: { fontSize: 12, color: T.danger, background: 'transparent', border: 'none', padding: '2px 4px' } }, 'Clear all'),
        ) : null,
      );
    }

    exports.name = 'dsh-memory';
    exports.inject = ['slots'];

    /**
     * Client entry: one Settings section.
     * @param {any} ctx cordis client context
     * @returns {() => void} disposer
     */
    exports.apply = (ctx) => {
      const disposers = [];
      if (ctx.slots && typeof ctx.slots.inject === 'function') {
        disposers.push(ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'memory',
          order: 85,
          label: () => 'Memory',
        }, MemoryPanel)));
      }
      console.info('[dsh-memory] client active; settings=Memory');
      return () => {
        for (const dispose of disposers) {
          try {
            dispose();
          } catch {
            // The settings slot may already be gone.
          }
        }
      };
    };

    exports.MemoryPanel = MemoryPanel;
    exports.FACT_TEXT = FACT_TEXT;
    return module.exports;
  },
});
