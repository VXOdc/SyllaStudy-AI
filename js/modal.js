/**
 * js/modal.js  ·  SyllaStudy AI
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces all native browser dialogs (alert / confirm / prompt) with a
 * glassmorphism, Apple-style custom modal system.
 *
 * API:
 *   Modal.confirm({ title, description, confirmText, destructive })  → Promise<boolean>
 *   Modal.prompt({ title, description, placeholder, defaultValue })  → Promise<string|null>
 *   Modal.alert({ title, description })                              → Promise<void>
 */

/* ── inject styles once ─────────────────────────────────────────────────── */
(function injectStyles() {
  if (document.getElementById('ss-modal-styles')) return;
  const style = document.createElement('style');
  style.id = 'ss-modal-styles';
  style.textContent = `
    .ss-modal-overlay {
      position: fixed; inset: 0; z-index: 9000;
      background: rgba(0,0,0,0.55);
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      display: flex; align-items: center; justify-content: center;
      padding: 20px;
      opacity: 0; transition: opacity 0.2s ease;
    }
    .ss-modal-overlay.visible { opacity: 1; }

    .ss-modal {
      background: rgba(28,28,30,0.92);
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 20px;
      padding: 28px 28px 22px;
      width: 100%; max-width: 380px;
      box-shadow: 0 24px 60px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.06) inset;
      transform: scale(0.94) translateY(8px);
      transition: transform 0.22s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s ease;
      opacity: 0;
    }
    .ss-modal-overlay.visible .ss-modal {
      transform: scale(1) translateY(0);
      opacity: 1;
    }

    .ss-modal-title {
      font-size: 17px; font-weight: 650; color: #fff;
      margin: 0 0 8px; letter-spacing: -0.3px;
    }
    .ss-modal-desc {
      font-size: 14px; line-height: 1.55; color: rgba(255,255,255,0.6);
      margin: 0 0 20px;
    }

    .ss-modal-input {
      width: 100%; background: rgba(255,255,255,0.07);
      border: 1px solid rgba(255,255,255,0.18); border-radius: 12px;
      padding: 11px 14px; font-size: 15px; color: #fff;
      font-family: inherit; outline: none; margin-bottom: 18px;
      transition: border-color 0.2s;
    }
    .ss-modal-input::placeholder { color: rgba(255,255,255,0.35); }
    .ss-modal-input:focus { border-color: rgba(255,255,255,0.4); background: rgba(255,255,255,0.1); }

    .ss-modal-actions {
      display: flex; gap: 10px; justify-content: flex-end;
    }
    .ss-modal-actions.centered { justify-content: center; }

    .ss-btn {
      padding: 10px 20px; border: none; border-radius: 12px;
      font-size: 14px; font-weight: 600; cursor: pointer;
      font-family: inherit; transition: all 0.18s ease; min-width: 80px;
    }
    .ss-btn-cancel {
      background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.85);
    }
    .ss-btn-cancel:hover { background: rgba(255,255,255,0.18); }

    .ss-btn-confirm {
      background: rgba(255,255,255,0.9); color: #000;
    }
    .ss-btn-confirm:hover { background: #fff; transform: scale(1.02); }

    .ss-btn-destructive {
      background: rgba(255,59,48,0.85); color: #fff;
    }
    .ss-btn-destructive:hover { background: rgba(255,59,48,1); transform: scale(1.02); }

    @media (max-width: 480px) {
      .ss-modal { padding: 22px 18px 18px; }
      .ss-modal-actions { flex-direction: column-reverse; }
      .ss-btn { width: 100%; }
    }
  `;
  document.head.appendChild(style);
})();

/* ── core renderer ──────────────────────────────────────────────────────── */
function createOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'ss-modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'ss-modal';
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  // trigger animation
  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('visible')));
  return { overlay, modal };
}

function closeOverlay(overlay) {
  overlay.classList.remove('visible');
  setTimeout(() => overlay.remove(), 240);
}

/* ── public API ─────────────────────────────────────────────────────────── */
export const Modal = {

  /**
   * Confirm dialog.
   * @param {{ title:string, description?:string, confirmText?:string, cancelText?:string, destructive?:boolean }} opts
   * @returns {Promise<boolean>}
   */
  confirm({ title, description = '', confirmText = 'Confirm', cancelText = 'Cancel', destructive = false } = {}) {
    return new Promise((resolve) => {
      const { overlay, modal } = createOverlay();

      modal.innerHTML = `
        <p class="ss-modal-title">${title}</p>
        ${description ? `<p class="ss-modal-desc">${description}</p>` : ''}
        <div class="ss-modal-actions">
          <button class="ss-btn ss-btn-cancel" id="ssCancel">${cancelText}</button>
          <button class="ss-btn ${destructive ? 'ss-btn-destructive' : 'ss-btn-confirm'}" id="ssConfirm">${confirmText}</button>
        </div>`;

      const done = (val) => { closeOverlay(overlay); resolve(val); };
      modal.querySelector('#ssCancel').onclick  = () => done(false);
      modal.querySelector('#ssConfirm').onclick = () => done(true);
      overlay.onclick = (e) => { if (e.target === overlay) done(false); };
    });
  },

  /**
   * Prompt dialog.
   * @param {{ title:string, description?:string, placeholder?:string, defaultValue?:string, confirmText?:string }} opts
   * @returns {Promise<string|null>}  null = cancelled
   */
  prompt({ title, description = '', placeholder = '', defaultValue = '', confirmText = 'Save' } = {}) {
    return new Promise((resolve) => {
      const { overlay, modal } = createOverlay();

      modal.innerHTML = `
        <p class="ss-modal-title">${title}</p>
        ${description ? `<p class="ss-modal-desc">${description}</p>` : ''}
        <input class="ss-modal-input" id="ssInput" type="text" placeholder="${placeholder}" value="${defaultValue}" autocomplete="off" />
        <div class="ss-modal-actions">
          <button class="ss-btn ss-btn-cancel" id="ssCancel">Cancel</button>
          <button class="ss-btn ss-btn-confirm" id="ssConfirm">${confirmText}</button>
        </div>`;

      const inputEl = modal.querySelector('#ssInput');
      // focus + select existing text
      setTimeout(() => { inputEl.focus(); inputEl.select(); }, 80);

      const done = (val) => { closeOverlay(overlay); resolve(val); };
      modal.querySelector('#ssCancel').onclick  = () => done(null);
      modal.querySelector('#ssConfirm').onclick = () => done(inputEl.value.trim() || null);
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') done(inputEl.value.trim() || null);
        if (e.key === 'Escape') done(null);
      });
      overlay.onclick = (e) => { if (e.target === overlay) done(null); };
    });
  },

  /**
   * Alert dialog (single dismiss button).
   * @param {{ title:string, description?:string, buttonText?:string }} opts
   * @returns {Promise<void>}
   */
  alert({ title, description = '', buttonText = 'OK' } = {}) {
    return new Promise((resolve) => {
      const { overlay, modal } = createOverlay();

      modal.innerHTML = `
        <p class="ss-modal-title">${title}</p>
        ${description ? `<p class="ss-modal-desc">${description}</p>` : ''}
        <div class="ss-modal-actions centered">
          <button class="ss-btn ss-btn-confirm" id="ssOk">${buttonText}</button>
        </div>`;

      const done = () => { closeOverlay(overlay); resolve(); };
      modal.querySelector('#ssOk').onclick = done;
      overlay.onclick = (e) => { if (e.target === overlay) done(); };
    });
  },

  /**
   * Project-picker modal: shows a list of project options as tappable rows.
   * @param {{ projects: {[id]:string}, currentProjectId?:string }} opts
   * @returns {Promise<string|null|'remove'>}  projectId, 'remove', or null (cancelled)
   */
  pickProject({ projects = {}, currentProjectId = null } = {}) {
    return new Promise((resolve) => {
      const { overlay, modal } = createOverlay();
      const entries = Object.entries(projects);

      const rows = entries.map(([id, name]) => `
        <button class="ss-proj-row ${id === currentProjectId ? 'active' : ''}" data-id="${id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          ${name}
          ${id === currentProjectId ? '<span class="ss-proj-check">✓</span>' : ''}
        </button>`).join('');

      const removeRow = currentProjectId
        ? `<button class="ss-proj-row remove" data-id="__remove__">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
               <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
             </svg>
             Remove from project
           </button>` : '';

      modal.innerHTML = `
        <p class="ss-modal-title">Move to Project</p>
        <p class="ss-modal-desc">Choose a project to organise this chat.</p>
        <div class="ss-proj-list">${rows}${removeRow}</div>
        <div class="ss-modal-actions" style="margin-top:16px;">
          <button class="ss-btn ss-btn-cancel" id="ssCancel">Cancel</button>
        </div>`;

      // inject list styles if needed
      if (!document.getElementById('ss-proj-styles')) {
        const s = document.createElement('style');
        s.id = 'ss-proj-styles';
        s.textContent = `
          .ss-proj-list { display:flex; flex-direction:column; gap:4px; max-height:240px; overflow-y:auto; margin-bottom:4px; }
          .ss-proj-row {
            display:flex; align-items:center; gap:10px; width:100%;
            background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1);
            border-radius:11px; padding:11px 14px; font-size:14px; font-weight:500;
            color:rgba(255,255,255,0.85); cursor:pointer; font-family:inherit; text-align:left;
            transition: background 0.15s;
          }
          .ss-proj-row:hover { background:rgba(255,255,255,0.12); }
          .ss-proj-row.active { border-color:rgba(255,255,255,0.3); background:rgba(255,255,255,0.1); }
          .ss-proj-row.remove { color:rgba(255,99,88,0.9); background:rgba(255,59,48,0.06); border-color:rgba(255,59,48,0.2); }
          .ss-proj-row.remove:hover { background:rgba(255,59,48,0.15); }
          .ss-proj-check { margin-left:auto; opacity:.7; font-size:13px; }
        `;
        document.head.appendChild(s);
      }

      const done = (val) => { closeOverlay(overlay); resolve(val); };
      modal.querySelector('#ssCancel').onclick = () => done(null);
      modal.querySelectorAll('.ss-proj-row').forEach(btn => {
        btn.onclick = () => {
          const id = btn.dataset.id;
          done(id === '__remove__' ? 'remove' : id);
        };
      });
      overlay.onclick = (e) => { if (e.target === overlay) done(null); };
    });
  },
};
