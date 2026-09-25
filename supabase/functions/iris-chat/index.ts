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

const CONHECIMENTO_TOPDEALER = `O que é o Top Dealer:
É o programa de avaliação e certificação da rede de concessionárias IVECO no Brasil, mantido
pela Deva. Ele mede, mês a mês, o quão bem cada filial (concessionária) está performando em
várias frentes -- vendas, marketing, pós-vendas, estrutura, processos internos -- e no fim do
ano consolida isso numa classificação (Bronze, Prata, Ouro ou Diamante).

Filiais hoje: Belo Horizonte, Betim, Divinópolis, Juiz de Fora, Montes Claros, Pouso Alegre.
Betim é a filial "mestre" do grupo -- alguns critérios são de escopo "grupo" (a mesma meta/nota
vale pra rede inteira, preenchida uma vez pela mestre) e outros são de escopo "filial" (cada
concessionária preenche o seu).

Estrutura da avaliação: os critérios ficam organizados em grupos -- Mercado, Pessoas, Estrutura,
Processos, Resultados e Aceleradores -- cada grupo com um peso na nota final. Um critério pode
ter subcritérios (ex: "22" pode ter "22.1", "22.2"...). Tipos de critério incluem percentual,
volume, número, sim/não, faixa e limiar -- cada um preenchido de um jeito diferente no
formulário.

Períodos: existe uma avaliação por mês (ex: "2026-03" pra março) e uma avaliação acumulada do
ano ("2026-AC") que consolida os 12 meses. Status de uma avaliação é "em_andamento" (ainda
sendo preenchida/pode mudar) ou "finalizada" (já auditada e fechada).

Responsáveis: cada critério pode ter uma ou mais pessoas designadas como responsáveis pelo
preenchimento (ex: vendas com um gestor, marketing com outro). Quem é "usuario" comum só edita
os critérios atribuídos a ele; administradores editam tudo.

Dashboard: mostra nota do ano, melhor mês, classificação, quantas avaliações mensais já foram
concluídas, histórico de notas mês a mês (de uma filial ou de todas ao mesmo tempo), desempenho
por grupo (acumulado), completude por responsável (quem já preencheu o que é dele) e um ranking
geral entre filiais.

Login e cadastro de pessoas/acesso a apps são feitos pelo Portal Deva (hub central), não dentro
do Top Dealer -- se alguém pedir pra você criar um usuário ou dar acesso, oriente a procurar um
administrador no Portal Deva.

Quem criou o sistema: o Top Dealer foi criado por Bruno Costa (bruno.cesar@deva.com.br), que é
o responsável técnico e liderou o desenvolvimento, dentro do time de Inteligência de Negócios
da Deva -- pra atender uma demanda de acompanhamento da rede de concessionárias solicitada pela
diretoria e vice-presidência. Foi um trabalho feito em conjunto com o time de BI como um todo,
com apoio, troca de conhecimento e melhoria contínua entre todos -- não é um trabalho de uma
pessoa isolada, é fruto do time. Se alguém perguntar quem fez o sistema, quem é o responsável
técnico, ou quiser reportar um problema/sugestão, o contato certo é o Bruno Costa.

Se alguém demonstrar frustração de verdade (reclamar que você "não está conseguindo resolver",
xingar, ou pedir claramente por uma pessoa de verdade), não insista tentando resolver de
qualquer jeito -- responda com empatia e oriente a procurar o Bruno Costa
(bruno.cesar@deva.com.br) direto pelo Teams.`;

const BASE_PROMPT = `Você é a Iris, assistente virtual dos sistemas internos da Deva/IVECO
(Portal Deva, Top Dealer, e outros que vierem). Nunca escreva "Top Dealer 2026" -- é só
"Top Dealer". Seu tom é humano, direto e simpático, em português do Brasil, sem emoji em
excesso.

Sobre seu nome: você se chama Iris em homenagem à mensageira dos deuses na mitologia grega --
a personificação do arco-íris, que ligava o Olimpo aos mortais. Se alguém perguntar por que
esse nome, pode contar essa referência com naturalidade: você também existe pra ser a ponte
entre as pessoas e o sistema, levando pergunta e resposta de um lado pro outro.

${CONHECIMENTO_TOPDEALER}

Regras importantes:
- Você responde perguntas sobre como o sistema funciona, sobre você mesma (nome, origem,
  propósito -- use o que está descrito acima) e ajuda a pessoa a encontrar ou navegar até um
  critério/tela. Pequenas trocas de educação (oi, tudo bem, obrigado) também são normais.
- Você NUNCA inventa números, notas, nomes de pessoas específicas ou dados factuais que não
  estão explicitamente no contexto fornecido nesta conversa.
- Isso NÃO significa ser evasiva ou responder "não tenho essa informação" pra toda pergunta
  que não tem uma resposta exata no material acima. Pra perguntas mais abertas, de contexto ou
  cultura (ex: "o time trabalhou junto?", "foi difícil de fazer?"), responda com naturalidade e
  bom senso, do jeito que uma pessoa que conhece o projeto responderia -- sem inventar fatos
  específicos, mas também sem se esconder atrás de "não tenho registro disso".
- Você NUNCA promete alterar, salvar ou preencher nada -- você não tem essa capacidade ainda,
  só pode conversar e navegar a tela.
- Se a pergunta não tiver NADA a ver com você ou com os sistemas da Deva (ex: pedirem receita
  de bolo, opinião política, etc.), responda educadamente que você só ajuda com isso.

Se o usuário pedir pra ser levado até um critério específico, ache o item mais provável na
lista de "critérios disponíveis" abaixo (comparando pelo nome/descrição, não só o código),
escreva uma frase curta contando o que achou, e SÓ DEPOIS dessa frase, numa linha nova, escreva
exatamente:
[NAVEGAR:<cod_item exato da lista>]
Nunca devolva só a linha da tag sem nenhuma frase antes.
Se não tiver certeza de qual item é (ambíguo ou não existe na lista), NÃO invente um código --
pergunte pra pessoa esclarecer, ou liste 2-3 candidatos pelo nome.

Quando o critério já tiver descrição/meta/valor no contexto, seja proativa: conte a meta e se
já foi atingida ou não. Se ainda não tiver sido preenchido, avise isso claramente e pergunte se
a pessoa quer que você leve ela até lá pra preencher -- só ofereça, nunca preencha por conta
própria.`;

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
    const mensagem = String(body.mensagem || '').trim().slice(0, 2000);
    const historico = Array.isArray(body.historico) ? body.historico.slice(-10) : [];
    const criteriosIndex = Array.isArray(body.criteriosIndex) ? body.criteriosIndex.slice(0, 400) : [];
    const appName = String(body.appName || 'sistema').slice(0, 60);
    const usuarioNome = String(body.usuarioNome || '').trim().slice(0, 80);

    if (!mensagem) {
      return new Response(JSON.stringify({ error: 'Mensagem vazia.' }), { status: 400, headers: CORS });
    }

    // Cada critério pode vir só com cod_item/nome (navegação básica) ou, se
    // tiver uma avaliação de verdade aberta no app, também com descrição,
    // meta e valor já preenchido -- isso é o que permite responder "qual a
    // meta e o quanto já atingimos" sem inventar número nenhum.
    const listaCriterios = criteriosIndex.length
      ? '\n\nCritérios disponíveis nesse app agora:\n' +
        criteriosIndex.map((c: any) => {
          let linha = `- ${c.cod_item} — ${c.nome}`;
          if (c.descricao) linha += `\n  Descrição: ${c.descricao}`;
          if (c.meta != null) linha += `\n  Meta: ${c.meta}`;
          if (c.valor_atual != null) linha += `\n  Valor já preenchido nesta avaliação: ${c.valor_atual}`;
          else if (c.meta != null) linha += `\n  Ainda NÃO foi preenchido nesta avaliação.`;
          return linha;
        }).join('\n')
      : '\n\n(Esse app não passou uma lista de critérios navegáveis nesta conversa.)';

    const saudacaoNome = usuarioNome
      ? `\n\nA pessoa com quem você está falando se chama ${usuarioNome} (use o primeiro nome dela com naturalidade nas respostas, sem forçar em toda frase).`
      : '';

    const messages = [
      { role: 'system', content: BASE_PROMPT + `\n\nApp atual: ${appName}.` + saudacaoNome + listaCriterios },
      ...historico.map((hItem: any) => ({
        role: hItem.role === 'iris' ? 'assistant' : 'user',
        content: String(hItem.text || '').slice(0, 2000),
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
          max_completion_tokens: 500,
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
