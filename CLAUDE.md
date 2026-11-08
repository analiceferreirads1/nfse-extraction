# CLAUDE.md — nfse-extraction

## 1. Visão geral
- Objetivo: extrair 6 campos de NFS-e em PDF (CNPJ e nome do prestador, número, data de emissão, valor, descrição) e gravar numa planilha.
- Usuário: analista de contas a pagar que recebe NFS-e de vários fornecedores.
- Fora do escopo: pagar ou aprovar pagamentos, integrar com ERP, ler PDF escaneado. Recuse e avise se pedirem.
- Meta: 98% de acerto por campo em 50 NFS-e fictícias.
- Princípio: na dúvida, mande para revisão humana. Nunca grave valor ou CNPJ incerto.
- Dados: sempre fictícios. Nunca use CNPJ ou nome real de empresa.
- Detalhes e justificativa: docs/intent.md

## 3. Stack
- TypeScript 7 (ES Modules, strict) e Vitest 5, em Node 24.
- Sem novas dependências sem justificar antes.

## 7. Testes e segurança
- Antes de dizer que terminou: `npm test` e `npm run typecheck` devem passar. Mostre a saída real.
- Testes em `tests/`, espelhando `src/` (ex.: `src/validators/cnpj.ts` → `tests/validators/cnpj.test.ts`).
- Testes verificam códigos de erro, nunca o texto da mensagem.
- Segredos só em `.env`. Nunca commitar `.env` nem notas reais.