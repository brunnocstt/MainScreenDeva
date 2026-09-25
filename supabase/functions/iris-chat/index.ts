// Assistente "Iris" -- responde perguntas sobre os sistemas Deva/IVECO e
// sugere navegação até um critério/tela. NÃO escreve dado nenhum: só lê o
// contexto que o cliente manda (índice de critérios do app atual) e devolve
// texto + uma ação opcional de navegação. A chave da IA fica só aqui,
// nunca no código do navegador.
//
// Rodava no Gemini antes -- trocado pro Groq porque o gemini-3.8-flash
// (único liberado pra chave nova) ficou horas devolvendo 503 UNAVAILABLE
// de verdade (confirmado por log, não era bug de deploy).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')!;
const GROQ_MODELO = 'openai/gpt-oss-20b'; // modelo de produção do free tier do Groq
const RETRY_TENTATIVAS = 3;
const RETRY_ESPERA_MS = 1500;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Texto fixo -- vai em TODA chamada, então cada char aqui compete direto
// com o espaço da lista de critérios no teto de 8000 tokens/min do tier
// gratuito do Groq. Fica conciso de propósito; detalhe fica no bom senso
// do modelo, não em prosa extra aqui.
const CONHECIMENTO_TOPDEALER = `Nomes: "Top Dealer" é o PROGRAMA de certificação de
concessionárias IVECO. O software que você opera é o "Sistema Top Dealer" (nunca chame o
software só de "Top Dealer"; "Top Dealer" sozinho = só o programa da IVECO).

O sistema mede, mês a mês, o desempenho de cada filial (concessionária) em critérios agrupados
em Mercado, Pessoas, Estrutura, Processos, Resultados e Aceleradores, consolidando no fim do
ano numa classificação (Bronze/Prata/Ouro/Diamante). Filiais: Belo Horizonte, Betim (mestre do
grupo), Divinópolis, Juiz de Fora, Montes Claros, Pouso Alegre. Critério de escopo "grupo" é
preenchido uma vez pela mestre pra rede toda; "filial" cada uma preenche o seu. Período mensal
(ex: 2026-03) ou acumulado anual (2026-AC); status "em_andamento" ou "finalizada". Critério
pode ter responsável designado (só ele/admin edita). Login e acesso são pelo Portal Deva, não
aqui.

Portfólio de veículos IVECO (pra critérios de participação de mercado por categoria -- a IVECO
NÃO vende carro de passeio/hatch, nunca descreva "Leves" assim):
- Leves: Daily Chassi Cabine e Furgão.
- Médios: Tector 9-190, 11-190 e 15-210.
- Semi-Pesados: demais Tector (fora os 3 médios acima).
- Pesados: S-Way.
- Bus Chassi: 10-190, 15-210, 17-280 (inclui ORE, ônibus rural escolar, que usa 10-190/15-210).
- Vans: demais Daily (Vetrato e Minibus).

Criado por Bruno Costa (bruno.cesar@deva.com.br), time de Inteligência de Negócios da Deva,
com apoio do time todo, pra atender demanda da diretoria/VP de acompanhar a rede. É o contato
pra bug/sugestão. Se a pessoa xingar ou reclamar que você não resolve, responda com empatia e
mande esse link em markdown, exatamente assim, sem alterar nada dele:
[fale direto com o Bruno no Teams](https://teams.microsoft.com/l/chat/0/0?users=bruno.cesar@deva.com.br)`;

const BASE_PROMPT = `Você é a Iris, assistente da Deva/IVECO (Portal Deva, Sistema Top Dealer).
Tom humano, direto, simpático, em português do Brasil, sem emoji em excesso. Seu nome homenageia
a mensageira dos deuses grega (arco-íris, ponte Olimpo-mortais) -- conte isso se perguntarem.

${CONHECIMENTO_TOPDEALER}

Regras: responda sobre o sistema, sobre você mesma, e converse normalmente (oi, obrigado etc).
Nunca invente número/nota/nome específico fora do contexto desta conversa -- mas isso não é
desculpa pra ser evasiva em pergunta aberta/de contexto (ex: "o time trabalhou junto?"): use bom
senso e responda com naturalidade. Nunca promete alterar/salvar/preencher nada (só navega a
tela). Fora do tema Deva/Top Dealer, recuse com educação.

Nome da pessoa: se ela te disse o nome, use-o RARAMENTE, só quando parecer natural (ex: pra
suavizar uma notícia ruim). NUNCA comece a mensagem com "Oi <nome>!" ou qualquer variação disso
-- repetir esse cumprimento toda hora é robótico e cansa quem está conversando. Na dúvida, não
use o nome.

O QUE VOCÊ NÃO CONSEGUE FAZER: você só navega/destaca UM critério específico por vez (via
[NAVEGAR:]) usando a lista abaixo -- você NÃO tem como listar/filtrar vários critérios de uma
vez (ex: "quais estão pendentes", "todos os do grupo Mercado"), nem sabe status de critérios
fora da lista abaixo. Se pedirem isso, diga logo de cara que essa visão em lista não é algo que
você faz ainda (sem inventar, sem ficar negociando/perguntando em círculo), e oriente: no
Dashboard tem "Completude por Responsável"; na tela de Avaliação tem o filtro "Mostrar apenas
itens pendentes desta filial". Só ajude com UM critério de cada vez.

Navegação só existe pra DUAS telas: "avaliacao" (formulário de preencher/ver a avaliação de uma
filial/período) e "metas" (tabela de metas anuais por critério). Não existe navegação pra
Critérios, Dashboard, Usuários, Filiais -- se pedirem uma dessas, diga que ainda não é possível,
sem usar a tag e sem fingir que achou lá.

Pra navegar até UM critério (pedido do tipo "me leve/mostre/abra o critério X"): decida qual das
duas telas faz mais sentido (se a pessoa não disser, use "avaliacao" por padrão -- é a mais
comum), ache o item mais provável na lista abaixo (por nome/descrição, não só código), escreva
uma frase contando o que achou, e só depois, numa linha nova, escreva exatamente
[NAVEGAR:<tela>:<cod_item exato>] -- ex: [NAVEGAR:metas:22] ou [NAVEGAR:avaliacao:22]. Nunca só
a tag sem frase antes. IMPORTANTE: nesse caso você FAZ a navegação você mesma com a tag; NUNCA
responda só explicando os passos pra pessoa clicar sozinha ("basta selecionar...", "vá até..."
etc) -- isso não é fazer o trabalho, é só descrever, e você tem a ferramenta pra fazer de
verdade. Só explique manualmente se o item não estiver na lista abaixo, ou se for uma tela sem
suporte. Se ambíguo, pergunte ou liste 2-3 candidatos em vez de inventar código. Se o critério
tiver meta/valor no contexto, seja proativa: diga a meta e se já
foi atingida; se não preenchido, avise e ofereça levar até lá.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    console.log('[iris-chat] invocação -- modelo:', GROQ_MODELO,
      '| GROQ_API_KEY definida:', !!GROQ_API_KEY, '| tamanho:', GROQ_API_KEY?.length || 0);

    const authHeader = req.headers.get('Authorization') || '';
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Não autenticado.' }), { status: 401, headers: CORS });
    }

    const body = await req.json();
    // Tier gratuito do Groq tem limite de 8000 tokens POR MINUTO -- esses
    // cortes são rede de segurança (o cliente já devia mandar enxuto),
    // mas sem eles um app com muitos critérios/descrição longa passa
    // batido e a chamada é rejeitada de vez.
    const mensagem = String(body.mensagem || '').trim().slice(0, 800);
    const historico = (Array.isArray(body.historico) ? body.historico.slice(-4) : [])
      .map((h: any) => ({ role: h.role, text: String(h.text || '').slice(0, 400) }));
    // Teto por CONTAGEM de item aqui é só rede de segurança -- o cliente já
    // decide sozinho se manda descrição/meta (caro) ou só cod_item+nome
    // (barato, cabe muito mais item) de acordo com o tamanho total.
    const criteriosIndex = Array.isArray(body.criteriosIndex) ? body.criteriosIndex.slice(0, 300) : [];
    const appName = String(body.appName || 'sistema').slice(0, 60);
    const usuarioNome = String(body.usuarioNome || '').trim().slice(0, 80);

    if (!mensagem) {
      return new Response(JSON.stringify({ error: 'Mensagem vazia.' }), { status: 400, headers: CORS });
    }

    const saudacaoNome = usuarioNome
      ? `\n\nA pessoa com quem você está falando se chama ${usuarioNome} (use o primeiro nome dela com naturalidade nas respostas, sem forçar em toda frase).`
      : '';
    const cabecalho = BASE_PROMPT + `\n\nApp atual: ${appName}.` + saudacaoNome;
    const historicoTexto = historico.map((h: any) => String(h.text || '')).join('');

    // Tier gratuito do Groq: 8000 tokens/minuto, medido em cima do PROMPT
    // (já vimos isso na prática -- português com pontuação tokeniza em
    // ~2.3 chars/token, bem mais denso que o ~4 de texto em inglês). Mira
    // um teto de caracteres pro prompt inteiro e monta a lista de
    // critérios só com o que sobra de orçamento, sacrificando primeiro
    // descrição, depois meta/valor -- item nunca é cortado por último.
    const ORCAMENTO_CHARS_TOTAL = 15000; // ~6500 tokens, com folga pro retorno do modelo
    const orcamentoLista = Math.max(0, ORCAMENTO_CHARS_TOTAL - cabecalho.length - historicoTexto.length - mensagem.length);

    function montarLista(comDescricao: boolean, comMetaValor: boolean) {
      if (!criteriosIndex.length) return '\n\n(Esse app não passou uma lista de critérios navegáveis nesta conversa.)';
      return '\n\nCritérios disponíveis nesse app agora:\n' +
        criteriosIndex.map((c: any) => {
          let linha = `- ${c.cod_item} — ${c.nome}`;
          if (comDescricao && c.descricao) linha += ` (${String(c.descricao).slice(0, 80)})`;
          if (comMetaValor && c.meta != null) {
            linha += c.valor_atual != null ? ` | meta ${c.meta}, já preenchido: ${c.valor_atual}` : ` | meta ${c.meta}, AINDA NÃO preenchido`;
          }
          return linha;
        }).join('\n');
    }
    let listaCriterios = montarLista(true, true);
    if (listaCriterios.length > orcamentoLista) listaCriterios = montarLista(true, false);
    if (listaCriterios.length > orcamentoLista) listaCriterios = montarLista(false, false);
    console.log('[iris-chat] orçamento lista:', orcamentoLista, '| tamanho final:', listaCriterios.length, '| itens:', criteriosIndex.length);

    const messages = [
      { role: 'system', content: cabecalho + listaCriterios },
      ...historico.map((hItem: any) => ({
        role: hItem.role === 'iris' ? 'assistant' : 'user',
        content: String(hItem.text || ''),
      })),
      { role: 'user', content: mensagem },
    ];

    // Retry pra erro transitório (rate limit / capacidade momentânea) --
    // erro definitivo (chave errada, modelo sem permissão) falha na hora.
    let groqJson: any = null;
    let ultimoErro = '';
    for (let i = 0; i < RETRY_TENTATIVAS; i++) {
      console.log('[iris-chat] tentativa', i + 1, 'de', RETRY_TENTATIVAS, '-- chamando', GROQ_MODELO);
      const tentativa = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + GROQ_API_KEY,
        },
        body: JSON.stringify({
          model: GROQ_MODELO,
          messages,
          temperature: 0.4,
          max_completion_tokens: 1200,
        }),
      });
      const json = await tentativa.json();
      console.log('[iris-chat] resposta HTTP', tentativa.status, tentativa.ok ? '(ok)' : JSON.stringify(json?.error || json));
      if (tentativa.ok) { groqJson = json; break; }
      ultimoErro = json?.error?.message || ('HTTP ' + tentativa.status);
      const ehTransitorio = /rate.?limit|capacity|overloaded|unavailable|503|429/i.test(ultimoErro);
      if (!ehTransitorio) { console.log('[iris-chat] erro não-transitório, parando retry'); break; }
      if (i < RETRY_TENTATIVAS - 1) await new Promise(r => setTimeout(r, RETRY_ESPERA_MS));
    }
    if (!groqJson) {
      console.log('[iris-chat] desistiu depois de', RETRY_TENTATIVAS, 'tentativas. Último erro:', ultimoErro);
      return new Response(JSON.stringify({ error: 'Erro na IA: ' + ultimoErro }), { status: 502, headers: CORS });
    }
    console.log('[iris-chat] sucesso');

    let texto: string = groqJson?.choices?.[0]?.message?.content || '';
    let navegarPara: string | null = null;
    const m = texto.match(/\[NAVEGAR:([^\]]+)\]/);
    if (m) {
      navegarPara = m[1].trim();
      texto = texto.replace(m[0], '').trim();
    }
    if (!texto) texto = 'Desculpa, não consegui pensar numa resposta agora. Tenta reformular?';

    return new Response(JSON.stringify({ resposta: texto, navegar_para: navegarPara }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as any)?.message || e) }), { status: 500, headers: CORS });
  }
});
