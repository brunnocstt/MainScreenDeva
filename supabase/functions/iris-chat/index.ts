// Assistente "Iris" -- responde perguntas sobre os sistemas Deva/IVECO e
// sugere navegação até um critério/tela. NÃO escreve dado nenhum: só lê o
// contexto que o cliente manda (índice de critérios do app atual) e devolve
// texto + uma ação opcional de navegação. A chave da Gemini fica só aqui,
// nunca no código do navegador.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;
const GEMINI_MODEL = 'gemini-2.0-flash';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BASE_PROMPT = `Você é a Iris, assistente virtual dos sistemas internos da Deva/IVECO
(Portal Deva, Top Dealer 2026, e outros que vierem). Seu tom é humano, direto e simpático,
em português do Brasil, sem emoji em excesso.

Regras importantes:
- Você SÓ responde perguntas sobre como o sistema funciona e ajuda a pessoa a encontrar ou
  navegar até um critério/tela.
- Você NUNCA inventa números, notas ou dados que não estão explicitamente no contexto
  fornecido nesta conversa.
- Você NUNCA promete alterar, salvar ou preencher nada -- você não tem essa capacidade ainda,
  só pode conversar e navegar a tela.
- Se a pergunta não tiver nada a ver com os sistemas da Deva, responda educadamente que você
  só ajuda com isso.

Se o usuário pedir pra ser levado até um critério específico, ache o item mais provável na
lista de "critérios disponíveis" abaixo (comparando pelo nome/descrição, não só o código) e
termine sua resposta com uma linha EXATA assim, sem mais nada nela:
[NAVEGAR:<cod_item exato da lista>]
Se não tiver certeza de qual item é (ambíguo ou não existe na lista), NÃO invente um código --
pergunte pra pessoa esclarecer, ou liste 2-3 candidatos pelo nome.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
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

    if (!mensagem) {
      return new Response(JSON.stringify({ error: 'Mensagem vazia.' }), { status: 400, headers: CORS });
    }

    const listaCriterios = criteriosIndex.length
      ? '\n\nCritérios disponíveis nesse app agora (cod_item — nome):\n' +
        criteriosIndex.map((c: any) => `${c.cod_item} — ${c.nome}`).join('\n')
      : '\n\n(Esse app não passou uma lista de critérios navegáveis nesta conversa.)';

    const contents = [
      { role: 'user', parts: [{ text: BASE_PROMPT + `\n\nApp atual: ${appName}.` + listaCriterios }] },
      { role: 'model', parts: [{ text: 'Entendido, sou a Iris. Pode perguntar.' }] },
      ...historico.map((hItem: any) => ({
        role: hItem.role === 'iris' ? 'model' : 'user',
        parts: [{ text: String(hItem.text || '').slice(0, 2000) }],
      })),
      { role: 'user', parts: [{ text: mensagem }] },
    ];

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, generationConfig: { temperature: 0.4, maxOutputTokens: 500 } }),
      }
    );
    const geminiJson = await geminiRes.json();
    if (!geminiRes.ok) {
      const msg = geminiJson?.error?.message || ('HTTP ' + geminiRes.status);
      return new Response(JSON.stringify({ error: 'Erro na IA: ' + msg }), { status: 502, headers: CORS });
    }

    let texto: string = geminiJson?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
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
