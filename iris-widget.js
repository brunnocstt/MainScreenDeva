/*
 * Iris — assistente compartilhada dos apps Deva/IVECO (*.albusdata.com.br).
 * Um arquivo só, incluído por <script> em cada app. Cada app fornece um
 * pequeno "adaptador" via window.IRIS_CONFIG ANTES de incluir esse script,
 * porque cada app tem seus próprios nomes de variável global (S, sb, etc.)
 * -- a Iris não assume nada sobre eles, só chama os hooks:
 *
 *   window.IRIS_CONFIG = {
 *     appName: 'topdealer',
 *     getAccessToken: async () => (await sb.auth.getSession()).data.session?.access_token,
 *     getCriteriosIndex: () => [{cod_item, nome}, ...] ou [] se não fizer sentido nesse app,
 *     onNavigate: (codItem) => true/false  -- true se encontrou e destacou, false se não.
 *   };
 *
 * Não escreve dado nenhum no sistema -- só conversa e chama onNavigate.
 */
(function () {
  'use strict';

  var IRIS_FN_URL = 'https://iueakatarwkvaoomhhah.supabase.co/functions/v1/iris-chat';
  var CFG = window.IRIS_CONFIG || {};
  var historico = []; // [{role:'user'|'iris', text}]
  var aberto = false;

  var CSS = ''
    + '.iris-bubble{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:999px;'
    + 'background:linear-gradient(135deg,#1955FF,#7C3AED);box-shadow:0 8px 24px rgba(25,85,255,.35);'
    + 'display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:9998;border:none;'
    + 'transition:transform .15s ease;}'
    + '.iris-bubble:hover{transform:scale(1.06);}'
    + '.iris-bubble svg{width:26px;height:26px;color:#fff;}'
    + '@media (max-width:767px){.iris-bubble{bottom:80px;right:16px;width:50px;height:50px;}}'
    + '.iris-panel{position:fixed;right:20px;bottom:86px;width:360px;max-width:calc(100vw - 32px);'
    + 'height:520px;max-height:calc(100vh - 140px);background:#fff;border-radius:18px;'
    + 'box-shadow:0 22px 40px -18px rgba(15,23,42,.35),0 6px 14px rgba(15,23,42,.12);'
    + 'display:none;flex-direction:column;overflow:hidden;z-index:9999;'
    + 'font-family:"Plus Jakarta Sans",system-ui,-apple-system,sans-serif;}'
    + '.iris-panel.iris-open{display:flex;}'
    + '@media (max-width:767px){.iris-panel{bottom:140px;right:16px;}}'
    + '.iris-head{background:linear-gradient(135deg,#1955FF,#7C3AED);color:#fff;padding:14px 16px;'
    + 'display:flex;align-items:center;gap:10px;flex-shrink:0;}'
    + '.iris-head-avatar{width:32px;height:32px;border-radius:999px;background:rgba(255,255,255,.2);'
    + 'display:flex;align-items:center;justify-content:center;flex-shrink:0;}'
    + '.iris-head-text{flex:1;min-width:0;}'
    + '.iris-head-text b{display:block;font-size:14px;font-weight:800;}'
    + '.iris-head-text span{display:block;font-size:11px;opacity:.85;margin-top:1px;}'
    + '.iris-close{background:none;border:none;color:#fff;opacity:.85;cursor:pointer;padding:4px;'
    + 'display:flex;flex-shrink:0;}'
    + '.iris-close:hover{opacity:1;}'
    + '.iris-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;'
    + 'background:#F8FAFC;}'
    + '.iris-msg{max-width:85%;font-size:13.5px;line-height:1.45;padding:9px 12px;border-radius:14px;'
    + 'white-space:pre-wrap;word-break:break-word;}'
    + '.iris-msg-iris{align-self:flex-start;background:#fff;color:#1E293B;'
    + 'box-shadow:0 1px 2px rgba(15,23,42,.06);border-bottom-left-radius:4px;}'
    + '.iris-msg-user{align-self:flex-end;background:#1955FF;color:#fff;border-bottom-right-radius:4px;}'
    + '.iris-msg-erro{align-self:flex-start;background:#FEF2F2;color:#B91C1C;border-bottom-left-radius:4px;}'
    + '.iris-typing{align-self:flex-start;display:flex;gap:4px;padding:10px 12px;background:#fff;'
    + 'border-radius:14px;border-bottom-left-radius:4px;box-shadow:0 1px 2px rgba(15,23,42,.06);}'
    + '.iris-typing span{width:6px;height:6px;border-radius:999px;background:#94A3B8;'
    + 'animation:iris-bounce 1.2s infinite ease-in-out;}'
    + '.iris-typing span:nth-child(2){animation-delay:.15s;}'
    + '.iris-typing span:nth-child(3){animation-delay:.3s;}'
    + '@keyframes iris-bounce{0%,80%,100%{transform:translateY(0);opacity:.5;}40%{transform:translateY(-4px);opacity:1;}}'
    + '.iris-foot{border-top:1px solid #F1F5F9;padding:10px;display:flex;gap:8px;flex-shrink:0;background:#fff;}'
    + '.iris-input{flex:1;border:1.5px solid #E2E8F0;border-radius:12px;padding:9px 12px;font-size:13.5px;'
    + 'outline:none;font-family:inherit;resize:none;max-height:80px;}'
    + '.iris-input:focus{border-color:#1955FF;}'
    + '.iris-send{background:#1955FF;border:none;border-radius:12px;width:38px;height:38px;flex-shrink:0;'
    + 'display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;}'
    + '.iris-send:hover{background:#123FCB;}'
    + '.iris-send:disabled{opacity:.5;cursor:not-allowed;}'
    + '@keyframes iris-pulse-highlight{'
    + '0%{box-shadow:0 0 0 0 rgba(25,85,255,.55);}'
    + '70%{box-shadow:0 0 0 14px rgba(25,85,255,0);}'
    + '100%{box-shadow:0 0 0 0 rgba(25,85,255,0);}}'
    + '.iris-highlight{animation:iris-pulse-highlight 1s ease-out 3;outline:2px solid #1955FF;'
    + 'outline-offset:2px;border-radius:10px;}';

  function injetarCss() {
    var tag = document.createElement('style');
    tag.textContent = CSS;
    document.head.appendChild(tag);
  }

  var ICON_IRIS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a5 5 0 0 1 5 5v2a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z"/><path d="M8 14a6 6 0 0 0 8 0"/><circle cx="12" cy="12" r="10"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

  function montarDom() {
    var bubble = document.createElement('button');
    bubble.className = 'iris-bubble';
    bubble.type = 'button';
    bubble.setAttribute('aria-label', 'Abrir a Iris');
    bubble.innerHTML = ICON_IRIS;

    var panel = document.createElement('div');
    panel.className = 'iris-panel';
    panel.innerHTML =
      '<div class="iris-head">' +
        '<div class="iris-head-avatar">' + ICON_IRIS.replace('width="17" height="17"', 'width="18" height="18"') + '</div>' +
        '<div class="iris-head-text"><b>Iris</b><span>Assistente Deva</span></div>' +
        '<button type="button" class="iris-close" aria-label="Fechar">' + ICON_CLOSE + '</button>' +
      '</div>' +
      '<div class="iris-body" id="iris-body"></div>' +
      '<div class="iris-foot">' +
        '<textarea class="iris-input" id="iris-input" placeholder="Pergunte algo ou peça pra te levar a um critério…" rows="1"></textarea>' +
        '<button type="button" class="iris-send" id="iris-send">' + ICON_SEND + '</button>' +
      '</div>';

    document.body.appendChild(bubble);
    document.body.appendChild(panel);
    return { bubble: bubble, panel: panel };
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function addMsg(body, role, texto) {
    var div = document.createElement('div');
    div.className = 'iris-msg ' + (role === 'user' ? 'iris-msg-user' : role === 'erro' ? 'iris-msg-erro' : 'iris-msg-iris');
    div.textContent = texto;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  function addTyping(body) {
    var div = document.createElement('div');
    div.className = 'iris-typing';
    div.id = 'iris-typing-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return div;
  }

  async function enviarMensagem(texto, body, input, sendBtn) {
    addMsg(body, 'user', texto);
    historico.push({ role: 'user', text: texto });
    input.value = '';
    input.style.height = 'auto';
    sendBtn.disabled = true;
    var typingEl = addTyping(body);

    try {
      var token = CFG.getAccessToken ? await CFG.getAccessToken() : null;
      if (!token) throw new Error('Sessão não encontrada -- recarregue a página e faça login de novo.');

      var criteriosIndex = [];
      try { criteriosIndex = (CFG.getCriteriosIndex && CFG.getCriteriosIndex()) || []; } catch (_) {}

      var res = await fetch(IRIS_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          mensagem: texto,
          historico: historico.slice(-10),
          criteriosIndex: criteriosIndex,
          appName: CFG.appName || 'sistema',
        }),
      });
      var json = await res.json();
      typingEl.remove();
      if (!res.ok || json.error) throw new Error(json.error || 'Erro desconhecido.');

      addMsg(body, 'iris', json.resposta);
      historico.push({ role: 'iris', text: json.resposta });

      if (json.navegar_para) {
        var achou = CFG.onNavigate ? CFG.onNavigate(json.navegar_para) : false;
        if (!achou) addMsg(body, 'iris', 'Não consegui destacar esse item na tela atual -- talvez precise abrir a avaliação certa primeiro.');
      }
    } catch (e) {
      typingEl.remove();
      addMsg(body, 'erro', 'Deu ruim: ' + (e.message || e));
    } finally {
      sendBtn.disabled = false;
    }
  }

  function init() {
    CFG = window.IRIS_CONFIG || {};
    injetarCss();
    var dom = montarDom();
    var body = dom.panel.querySelector('#iris-body');
    var input = dom.panel.querySelector('#iris-input');
    var sendBtn = dom.panel.querySelector('#iris-send');
    var closeBtn = dom.panel.querySelector('.iris-close');

    addMsg(body, 'iris', 'Oi, eu sou a Iris! Posso responder dúvidas sobre o sistema ou te levar até um critério específico. É só perguntar.');

    function toggle() {
      aberto = !aberto;
      dom.panel.classList.toggle('iris-open', aberto);
      if (aberto) input.focus();
    }
    dom.bubble.addEventListener('click', toggle);
    closeBtn.addEventListener('click', toggle);

    function tentarEnviar() {
      var texto = input.value.trim();
      if (!texto || sendBtn.disabled) return;
      enviarMensagem(texto, body, input, sendBtn);
    }
    sendBtn.addEventListener('click', tentarEnviar);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); tentarEnviar(); }
    });
    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 80) + 'px';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
