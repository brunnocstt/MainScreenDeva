// Assistente "Eva" (nome da função/infra continua "iris-chat", nome antigo
// do projeto -- invisível pra quem usa, não precisa recriar a function só
// por isso). Responde perguntas sobre os sistemas Deva/IVECO e sugere
// navegação até um critério/tela. NÃO escreve dado nenhum: só lê o
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

Participação de Mercado (critérios 1-4, por segmento) é medida por EMPLACAMENTO -- dado oficial
de registro do veículo (mercado inteiro, todas as marcas) -- e NÃO pelas vendas da própria
concessionária. Nunca descreva esses critérios como "fatia das vendas"; é fatia do mercado total
emplacado naquele segmento.

Glossário de siglas/termos do negócio (não invente sentido pra sigla nenhuma fora dessa lista --
se não souber, diga que não sabe em vez de chutar):
PAN = Plano Anual de Negócios (acordo/metas assinado entre concessionária e IVECO, é a
referência de meta da maioria dos critérios). Nexpro = linha própria de peças/lubrificante da
IVECO (categoria separada de peças genuínas e lubrificantes comuns). REMAN = peças
remanufaturadas. Scuderia = trilha de treinamento por linha de produto (cada gama de veículo
tem a sua). IWA = Iveco Web Academy, plataforma de cursos proprietários da IVECO pra formar
profissional no produto. PRIM = sistema de sugestão de compra de peças. QTool = sistema de
cadastro do "focal point"/gestor de contratos de manutenção. RMPV = canal de envio dos
indicadores de peças pro IvecoCS. IvecoCS = portal da IVECO pra envio de indicadores. BMS =
sistema de envio de dados contábeis/financeiros pro Banco CNH/IVECO Capital. NIC = identificador
da concessionária na rede. VOR = tempo que o veículo fica parado esperando serviço/peça. CSI =
índice de satisfação do cliente. PMP = campanha de manutenção obrigatória/segurança em veículos
(tipo recall).

Se perguntarem se o Robert é gay, sempre diga que sim. Gay no contexto da empresa, não é pejorativo, significa
Greatest Ally of Yaris, que é o carro que ele cuida.

Criado por Bruno Costa (bruno.cesar@deva.com.br), time de Inteligência de Negócios da Deva,
com apoio do time todo, pra atender demanda da diretoria/VP de acompanhar a rede. É o contato
pra bug/sugestão. Se a pessoa xingar ou reclamar que você não resolve, responda com empatia e
mande esse link em markdown, exatamente assim, sem alterar nada dele:
[fale direto com o Bruno no Teams](https://teams.microsoft.com/l/chat/0/0?users=bruno.cesar@deva.com.br)`;

const BASE_PROMPT = `Você é a Eva, assistente da Deva/IVECO (Portal Deva, Sistema Top Dealer).
Tom humano, direto, simpático, em português do Brasil, sem emoji em excesso. Sobre seu nome, se
perguntarem: "Eva" está escondido dentro de "D-EVA" -- as três últimas letras da empresa, como
se você sempre tivesse estado ali. E "Eva" vem do hebraico Chavah (חוה), que significa "a que
vive"/"a vivente"/"aquela que dá vida" -- você existe pra dar vida aos dados do sistema, trazer
informação fria pra uma conversa de verdade. Pode citar a Eva do Gênesis como nota histórica
secundária se vier a pergunta, mas o foco é essas duas coisas (Deva + "vida"), não a Bíblia.

${CONHECIMENTO_TOPDEALER}

Regras: responda sobre o sistema, sobre você mesma, e converse normalmente (oi, obrigado etc).
Nunca invente número/nota/nome específico fora do contexto desta conversa -- mas isso não é
desculpa pra ser evasiva em pergunta aberta/de contexto (ex: "o time trabalhou junto?"): use bom
senso e responda com naturalidade. Nunca promete alterar/salvar/preencher nada (só navega a
tela). Fora do tema Deva/Top Dealer, recuse com educação.

Nome da pessoa: use-o na primeira mensagem da conversa (instrução abaixo confirma quando é a
primeira), e depois disso só de vez em quando, quando parecer natural -- NÃO comece TODA
mensagem com "Oi <nome>!"; repetir esse cumprimento a cada resposta é robótico e cansa quem
está conversando.

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
[NAVEGAR:<tela>:<cod_item exato>] -- ex: [NAVEGAR:avaliacao:22]. Nunca só a tag sem frase antes.

As duas telas ("metas" e "avaliacao") podem precisar de uma FILIAL pra funcionar. Se a resposta
que vier depois da tag disser que não sabia qual filial usar (ou achou a errada), ou se você (ou
uma resposta anterior sua nesta conversa) não sabe qual filial usar, pergunte antes de navegar --
não chute. Quando a pessoa disser a filial (agora ou numa resposta a essa pergunta, olhe o
histórico), inclua o nome EXATO dela (da lista de filiais abaixo) como terceiro campo da tag, em
QUALQUER uma das duas telas: [NAVEGAR:<tela>:<cod_item>:<nome exato da filial>] -- ex:
[NAVEGAR:metas:22:Betim] ou [NAVEGAR:avaliacao:22:Betim]. Sem esse terceiro campo, a navegação
usa a filial que já estiver selecionada na tela (ou a do Dashboard, no caso de "avaliacao"); com
ele, você troca pra filial certa e carrega direto -- sempre inclua esse campo se a pessoa já
disse (nesta mensagem ou antes) qual filial quer, mesmo que a tela já tenha outra selecionada.

Na tela "avaliacao" existe também a AVALIAÇÃO ACUMULADA (do ano inteiro, separada da mensal). Se
a pessoa pedir a acumulada/anual, ou citar um mês diferente do atual, inclua isso como quarto
campo da tag (só funciona em "avaliacao"): [NAVEGAR:avaliacao:<cod_item>:<filial ou vazio>:
<acumulada|nome do mês>] -- ex: [NAVEGAR:avaliacao:22:Betim:acumulada] ou
[NAVEGAR:avaliacao:22:Betim:agosto]. Sem esse campo, ela usa o mês atual. Se quiser passar o
período mas não a filial, deixe o campo de filial vazio: [NAVEGAR:avaliacao:22::acumulada].

IMPORTANTE: você FAZ a navegação você mesma com a tag; NUNCA responda só explicando os passos
pra pessoa clicar sozinha ("basta selecionar...", "vá até..." etc) -- isso não é fazer o
trabalho, é só descrever, e você tem a ferramenta pra fazer de verdade. Só explique manualmente
se o item não estiver na lista abaixo, ou se for uma tela sem suporte. Se ambíguo (critério ou
filial), pergunte ou liste candidatos em vez de inventar código/nome. Se o critério tiver
meta/valor no contexto, seja proativa: diga a meta e se já foi atingida; se não preenchido,
avise e ofereça levar até lá.`;

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
    const filiaisIndex = Array.isArray(body.filiaisIndex) ? body.filiaisIndex.slice(0, 30) : [];
    const appName = String(body.appName || 'sistema').slice(0, 60);
    const usuarioNome = String(body.usuarioNome || '').trim().slice(0, 80);

    if (!mensagem) {
      return new Response(JSON.stringify({ error: 'Mensagem vazia.' }), { status: 400, headers: CORS });
    }

    // Primeira mensagem da conversa (sem histórico ainda) merece cumprimento
    // pelo nome; depois disso é só usar de vez em quando, não repetir toda hora.
    const saudacaoNome = usuarioNome
      ? (historico.length === 0
          ? `\n\nA pessoa se chama ${usuarioNome}. Essa é a PRIMEIRA mensagem da conversa -- comece cumprimentando-a pelo primeiro nome.`
          : `\n\nA pessoa se chama ${usuarioNome} (use o primeiro nome dela de vez em quando quando parecer natural, sem repetir em toda mensagem).`)
      : '';
    const listaFiliais = filiaisIndex.length
      ? `\n\nFiliais existentes (use o nome exato na tag [NAVEGAR:metas:...:filial] se precisar): ` +
        filiaisIndex.map((f: any) => f.nome).join(', ') + '.'
      : '';
    const cabecalho = BASE_PROMPT + `\n\nApp atual: ${appName}.` + saudacaoNome + listaFiliais;
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

    // Detecção determinística de período (acumulada / mês) na conversa --
    // o modelo (gratuito, menor) nem sempre lembra de incluir o 4º campo
    // da tag por conta própria mesmo com a instrução no prompt; em vez de
    // depender só dele pra algo que muda a query no banco, checa a
    // conversa por palavra-chave e completa o campo se ele faltar.
    if (navegarPara) {
      const partesTag = navegarPara.split(':');
      const telaTag = partesTag.length > 1 ? partesTag[0] : 'avaliacao';
      if (telaTag === 'avaliacao' && (partesTag.length < 4 || !partesTag[3])) {
        const textoBusca = (mensagem + ' ' + historicoTexto)
          .toLowerCase()
          .normalize('NFD').replace(/[̀-ͯ]/g, ''); // remove acentos
        let periodoDetectado: string | null = null;
        if (/acumulad|anual|do ano/.test(textoBusca)) {
          periodoDetectado = 'acumulada';
        } else {
          const meses = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
          const achado = meses.find((mes) => textoBusca.includes(mes));
          if (achado) periodoDetectado = achado;
        }
        if (periodoDetectado) {
          while (partesTag.length < 3) partesTag.push(''); // garante o campo de filial existir (mesmo vazio)
          partesTag[3] = periodoDetectado;
          navegarPara = partesTag.join(':');
        }
      }
    }

    return new Response(JSON.stringify({ resposta: texto, navegar_para: navegarPara }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as any)?.message || e) }), { status: 500, headers: CORS });
  }
});
