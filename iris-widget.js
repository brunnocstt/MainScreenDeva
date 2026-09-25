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
 *     getUserName: () => 'Primeiro nome' (opcional -- pra ela chamar a pessoa pelo nome),
 *     getCriteriosIndex: () => [{cod_item, nome, descricao?, meta?, valor_atual?}, ...],
 *     onNavigate: (tela, codItem) => true (achou e destacou) | false (não achou, sem detalhe) |
 *       string (não achou, mas com o motivo pra pessoa corrigir -- ex: "tentei a filial X
 *       no mês Y, mas não existe avaliação"). Pode devolver Promise de qualquer um desses.
 *       "tela" é o que a Iris decidiu (ex: 'avaliacao', 'metas') -- o app decide o que suportar.
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
    + '.iris-online-dot{position:absolute;bottom:-2px;right:-2px;width:14px;height:14px;background:#22C55E;'
    + 'border:2.5px solid #fff;border-radius:999px;}'
    + '@media (max-width:767px){.iris-bubble{bottom:80px;right:16px;width:50px;height:50px;}}'
    + '.iris-teaser{position:fixed;right:84px;bottom:36px;background:#fff;color:#1E293B;font-size:12.5px;'
    + 'font-weight:700;padding:9px 14px;border-radius:999px;box-shadow:0 6px 16px rgba(15,23,42,.16);'
    + 'white-space:nowrap;z-index:9997;cursor:pointer;animation:iris-teaser-in .35s ease;'
    + 'font-family:"Plus Jakarta Sans",system-ui,-apple-system,sans-serif;}'
    + '@keyframes iris-teaser-in{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}'
    + '@media (max-width:767px){.iris-teaser{bottom:94px;right:70px;font-size:11.5px;padding:7px 12px;}}'
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
    + 'display:flex;align-items:center;justify-content:center;flex-shrink:0;position:relative;}'
    + '.iris-head-avatar .iris-online-dot{width:10px;height:10px;bottom:-1px;right:-1px;border-width:2px;}'
    + '.iris-head-text{flex:1;min-width:0;}'
    + '.iris-head-text b{display:block;font-size:14px;font-weight:800;}'
    + '.iris-head-text span{display:block;font-size:11px;opacity:.85;margin-top:1px;}'
    + '.iris-close,.iris-reset{background:none;border:none;color:#fff;opacity:.85;cursor:pointer;padding:4px;'
    + 'display:flex;flex-shrink:0;}'
    + '.iris-close:hover,.iris-reset:hover{opacity:1;}'
    + '.iris-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;'
    + 'background:#F8FAFC;}'
    + '.iris-msg{max-width:85%;font-size:13.5px;line-height:1.45;padding:9px 12px;border-radius:14px;'
    + 'white-space:pre-wrap;word-break:break-word;}'
    + '.iris-msg-iris{align-self:flex-start;background:#fff;color:#1E293B;white-space:normal;'
    + 'box-shadow:0 1px 2px rgba(15,23,42,.06);border-bottom-left-radius:4px;}'
    + '.iris-msg-iris p{margin:0 0 8px;}'
    + '.iris-msg-iris >:last-child{margin-bottom:0;}'
    + '.iris-msg-iris ul,.iris-msg-iris ol{margin:0 0 8px;padding-left:18px;}'
    + '.iris-msg-iris li{margin-bottom:2px;}'
    + '.iris-md-h{font-weight:800;font-size:13px;margin:2px 0 6px;color:#1955FF;}'
    + '.iris-msg-iris code{background:#F1F5F9;padding:1px 5px;border-radius:4px;font-size:12px;'
    + 'font-family:ui-monospace,Menlo,Consolas,monospace;}'
    + '.iris-msg-iris a{color:#1955FF;font-weight:700;text-decoration:underline;}'
    + '.iris-md-table-wrap{overflow-x:auto;margin:0 0 8px;-webkit-overflow-scrolling:touch;}'
    + '.iris-md-table{border-collapse:collapse;font-size:12px;white-space:nowrap;}'
    + '.iris-md-table th,.iris-md-table td{border:1px solid #E2E8F0;padding:5px 8px;text-align:left;}'
    + '.iris-md-table th{background:#F8FAFC;font-weight:700;}'
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
  var ICON_RESET = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';

  function montarDom() {
    var teaser = document.createElement('div');
    teaser.className = 'iris-teaser';
    teaser.id = 'iris-teaser';
    teaser.textContent = 'Pergunte à Iris';

    var bubble = document.createElement('button');
    bubble.className = 'iris-bubble';
    bubble.type = 'button';
    bubble.setAttribute('aria-label', 'Abrir a Iris');
    bubble.innerHTML = ICON_IRIS + '<span class="iris-online-dot"></span>';

    var panel = document.createElement('div');
    panel.className = 'iris-panel';
    panel.innerHTML =
      '<div class="iris-head">' +
        '<div class="iris-head-avatar">' + ICON_IRIS.replace('width="17" height="17"', 'width="18" height="18"') + '<span class="iris-online-dot"></span></div>' +
        '<div class="iris-head-text"><b>Iris</b><span>Assistente de IA</span></div>' +
        '<button type="button" class="iris-reset" aria-label="Reiniciar conversa" title="Reiniciar conversa">' + ICON_RESET + '</button>' +
        '<button type="button" class="iris-close" aria-label="Fechar">' + ICON_CLOSE + '</button>' +
      '</div>' +
      '<div class="iris-body" id="iris-body"></div>' +
      '<div class="iris-foot">' +
        '<textarea class="iris-input" id="iris-input" placeholder="Pergunte à Iris…" rows="1"></textarea>' +
        '<button type="button" class="iris-send" id="iris-send">' + ICON_SEND + '</button>' +
      '</div>';

    document.body.appendChild(teaser);
    document.body.appendChild(bubble);
    document.body.appendChild(panel);
    return { teaser: teaser, bubble: bubble, panel: panel };
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Parser de Markdown bem simples, só pro que o modelo costuma gerar
  // (negrito, código, cabeçalho #, lista, tabela) -- sem lib externa.
  // Escapa o texto ANTES de aplicar qualquer tag, então HTML que vier na
  // resposta da IA nunca é interpretado como marcação de verdade.
  function markdownParaHtml(texto) {
    function inline(s) {
      // Só http(s):// -- evita esquema tipo javascript: vazar num link clicável.
      s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/`(.+?)`/g, '<code>$1</code>');
      return s;
    }
    function celulas(linha) {
      return linha.replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); });
    }
    function renderTabela(linhas) {
      if (linhas.length < 2) return linhas.map(function (l) { return '<p>' + inline(l) + '</p>'; }).join('');
      var cab = celulas(linhas[0]);
      var corpo = linhas.slice(2).filter(function (l) { return l.length; });
      var html = '<div class="iris-md-table-wrap"><table class="iris-md-table"><thead><tr>' +
        cab.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
      corpo.forEach(function (l) {
        html += '<tr>' + celulas(l).map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
      });
      return html + '</tbody></table></div>';
    }

    var linhas = escapeHtml(texto).split('\n');
    var html = '';
    var emLista = null; // 'ul' | 'ol' | null
    var linhasTabela = [];

    function fecharLista() { if (emLista) { html += '</' + emLista + '>'; emLista = null; } }
    function fecharTabela() { if (linhasTabela.length) { html += renderTabela(linhasTabela); linhasTabela = []; } }

    linhas.forEach(function (linhaRaw) {
      var linha = linhaRaw.trim();

      if (/^\|.*\|$/.test(linha)) { fecharLista(); linhasTabela.push(linha); return; }
      fecharTabela();

      if (!linha) { fecharLista(); return; }

      var mH = linha.match(/^#{1,4}\s+(.*)$/);
      if (mH) { fecharLista(); html += '<div class="iris-md-h">' + inline(mH[1]) + '</div>'; return; }

      var mLi = linha.match(/^[-*]\s+(.*)$/);
      if (mLi) {
        if (emLista !== 'ul') { fecharLista(); html += '<ul>'; emLista = 'ul'; }
        html += '<li>' + inline(mLi[1]) + '</li>';
        return;
      }

      var mOli = linha.match(/^\d+[.)]\s+(.*)$/);
      if (mOli) {
        if (emLista !== 'ol') { fecharLista(); html += '<ol>'; emLista = 'ol'; }
        html += '<li>' + inline(mOli[1]) + '</li>';
        return;
      }

      fecharLista();
      html += '<p>' + inline(linha) + '</p>';
    });
    fecharLista();
    fecharTabela();
    return html;
  }

  function addMsg(body, role, texto) {
    var div = document.createElement('div');
    div.className = 'iris-msg ' + (role === 'user' ? 'iris-msg-user' : role === 'erro' ? 'iris-msg-erro' : 'iris-msg-iris');
    if (role === 'iris') {
      div.innerHTML = markdownParaHtml(texto);
    } else {
      div.textContent = texto;
    }
    body.appendChild(div);
    // Foca no COMEÇO da mensagem nova, não no fim -- resposta grande ia
    // sempre direto pro fim dela, ficava difícil voltar pro início pra ler.
    div.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function addTyping(body) {
    var div = document.createElement('div');
    div.className = 'iris-typing';
    div.id = 'iris-typing-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    body.appendChild(div);
    div.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return div;
  }

  async function enviarMensagem(texto, body, input, sendBtn) {
    addMsg(body, 'user', texto);
    // Manda só o histórico ANTERIOR a essa mensagem -- "mensagem" já é a
    // atual, então incluir ela de novo no histórico duplicava o turno pro
    // modelo. Só entra na lista depois de confirmado que deu certo.
    var historicoParaEnviar = historico.slice(-10);
    input.value = '';
    input.style.height = 'auto';
    sendBtn.disabled = true;
    var typingEl = addTyping(body);

    try {
      var token = CFG.getAccessToken ? await CFG.getAccessToken() : null;
      if (!token) throw new Error('Sessão não encontrada -- recarregue a página e faça login de novo.');

      var criteriosIndex = [];
      try { criteriosIndex = (CFG.getCriteriosIndex && CFG.getCriteriosIndex()) || []; } catch (_) {}
      var usuarioNome = '';
      try { usuarioNome = (CFG.getUserName && CFG.getUserName()) || ''; } catch (_) {}

      var res = await fetch(IRIS_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          mensagem: texto,
          historico: historicoParaEnviar,
          criteriosIndex: criteriosIndex,
          appName: CFG.appName || 'sistema',
          usuarioNome: usuarioNome,
        }),
      });
      var json = await res.json();
      typingEl.remove();
      if (!res.ok || json.error) throw new Error(json.error || 'Erro desconhecido.');

      historico.push({ role: 'user', text: texto });
      addMsg(body, 'iris', json.resposta);
      historico.push({ role: 'iris', text: json.resposta });

      if (json.navegar_para) {
        // Formato "tela:cod_item" (ex: "metas:22"); se vier sem tela (jeito
        // antigo, só "22"), assume "avaliacao" pra não quebrar.
        var partesNav = String(json.navegar_para).split(':');
        var telaNav = partesNav.length > 1 ? partesNav[0] : 'avaliacao';
        var codItemNav = partesNav.length > 1 ? partesNav.slice(1).join(':') : partesNav[0];
        // onNavigate pode ser assíncrono (às vezes precisa abrir a
        // avaliação certa antes de destacar o critério na tela). Pode
        // devolver true (achou), false (não achou, sem detalhe) ou uma
        // string (não achou, mas com o motivo específico pra pessoa
        // corrigir -- ex: "tentei a filial X no mês Y, mas não existe").
        var resultadoNav = CFG.onNavigate ? await CFG.onNavigate(telaNav, codItemNav) : false;
        if (resultadoNav === false) {
          addMsg(body, 'iris', 'Não consegui destacar esse item na tela atual -- talvez precise abrir a avaliação certa primeiro.');
        } else if (typeof resultadoNav === 'string') {
          addMsg(body, 'iris', resultadoNav);
        }
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
    var resetBtn = dom.panel.querySelector('.iris-reset');

    function saudacao() {
      addMsg(body, 'iris', 'Oi, eu sou a Iris! Posso responder dúvidas sobre o sistema ou te levar até um critério específico. É só perguntar.');
    }
    saudacao();

    function toggle() {
      aberto = !aberto;
      dom.panel.classList.toggle('iris-open', aberto);
      if (aberto) { input.focus(); dom.teaser.remove(); }
    }
    dom.teaser.addEventListener('click', toggle);
    dom.bubble.addEventListener('click', toggle);
    closeBtn.addEventListener('click', toggle);
    // Se o modelo recusar responder por algum motivo, essa recusa fica
    // salva no histórico e ele repete ela pra sempre depois -- reiniciar
    // limpa tudo (memória + tela) e a conversa volta a funcionar.
    resetBtn.addEventListener('click', function () {
      historico = [];
      body.innerHTML = '';
      saudacao();
    });

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
