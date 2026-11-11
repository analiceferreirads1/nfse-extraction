# Lições aprendidas

## 2026-11-10 — Saída do `npm run process`

- **Contexto:** plano do comando que grava `aprovadas.csv` e `revisao.csv` em `output/`.
- **Erro:** o plano assumia sobrescrever os CSVs a cada execução.
- **Correção da usuária:** criar uma subpasta por execução (`output/AAAA-MM-DD_HHMMSS/`) e nunca apagar pastas anteriores.
- **Causa raiz:** tratei a saída como descartável sem perguntar; para contas a pagar, o histórico de cada execução tem valor de auditoria.
- **Regra preventiva:** saídas de processamento em lote preservam o histórico: pasta nova por execução, sem sobrescrever nem apagar, salvo pedido explícito.
- **Aplicar em:** qualquer comando que grave relatórios, planilhas ou arquivos de resultado.
