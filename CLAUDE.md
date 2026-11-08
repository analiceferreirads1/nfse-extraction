# CLAUDE.md — nfse-extraction

## 1. Visão geral
- Objetivo: extrair 6 campos de NFS-e em PDF (CNPJ e nome do prestador, número, data de emissão, valor, descrição) e gravar numa planilha.
- Usuário: analista de contas a pagar que recebe NFS-e de vários fornecedores.
- Fora do escopo: pagar ou aprovar pagamentos, integrar com ERP, ler PDF escaneado. Recuse e avise se pedirem.
- Meta: 98% de acerto por campo em 50 NFS-e fictícias.
- Princípio: na dúvida, mande para revisão humana. Nunca grave valor ou CNPJ incerto.
- Dados: sempre fictícios. Nunca use CNPJ ou nome real de empresa.
- Detalhes e justificativa: docs/intent.md