# Intent

> Framework Ideia, etapa 0. Números de tempo e volume são estimativas.

**O que faz:** extrai seis campos de NFS-e em PDF (CNPJ e nome do prestador, número, data de emissão, valor e descrição), valida as regras e grava na planilha, mandando para revisão humana o que tiver dúvida.

**Para quem:** analista de contas a pagar de uma empresa de serviços de médio porte, que recebe NFS-e de vários fornecedores.

**Qual problema resolve:** a digitação manual leva cerca de 10 minutos por nota (estimativa). Com 200 notas por mês, são 33 horas mensais, que crescem junto com o volume. Erros de digitação causam pagamento duplicado, pagamento ao fornecedor errado e multa por atraso.

**O que NÃO faz:** não paga boletos, não aprova pagamentos, não integra com ERP e não lê PDF escaneado.

**Como saberei que funciona:** em um conjunto de 50 NFS-e fictícias, acerta 98% dos campos; nenhum valor ou CNPJ errado é gravado sem revisão humana; o tempo médio por nota cai de 10 minutos para menos de 1 minuto.