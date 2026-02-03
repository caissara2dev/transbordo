# Transbordo — Historia do Projeto (Storytelling + Talk Track)

Este documento e um roteiro corporativo (com tom positivo) para apresentar a evolucao do Transbordo e defender impacto tecnico/operacional.

## 1) Abertura (30–45s)

"Nos ultimos meses, o Transbordo de Glicerina dependia muito de acompanhamento informal: anotacoes, planilhas e memoria. Isso gerava baixa rastreabilidade, auditoria dificil e pouca confianca para medir gargalos. A proposta do projeto foi transformar essa realidade em um sistema operacional simples para o usuario, mas consistente e seguro: historico auditavel, exportavel e com validacao de regras de turno."

## 2) Objetivo (o que significa sucesso)

- **Padronizar** a captura de dados por bomba e por turno.
- **Garantir consistencia**: validacao de horarios + regra da virada do turno NOITE (00:00–00:48).
- **Elevar governanca**: perfis, autorizacao em Firestore Rules e trilha de auditoria.
- **Viabilizar analise**: historico filtravel e exportacao CSV.

## 3) O que foi entregue (visao de produto)

Dois fluxos centrais:

1. **Lancamento (operacao)**
   - Bomba (1/2), shiftDate, turno, inicio/fim em HH:MM
   - Categoria operacional (produtivo e motivos)
   - Campos condicionais (ex.: Produtivo exige placa + container)
   - Validacao forte, impedindo salvar registros inconsistentes

2. **Historico + Exportacao**
   - Filtros (data, bomba, turno, categoria)
   - Exportacao CSV padronizada para analise

## 4) Decisoes tecnicas (por que isso e robusto)

### 4.1 Seguranca em duas camadas

- UI orienta o usuario, mas **o Firestore Rules e a fonte da verdade** para autorizacao.
- Perfis: OPERADOR / SUPERVISOR / ADMIN.
- Operador ve apenas os proprios eventos; supervisao ve tudo.
- Regras incluem whitelist de campos e validacao de schema.

### 4.2 Consistencia de turno (dor real)

O turno NOITE vai ate 00:48 e isso cria risco de "quebrar" relatorios na virada do dia.

Solucao:
- `shiftDate` representa sempre o dia de inicio do turno.
- `startAt/endAt` seguem como timestamps reais (duracao e ordenacao).
- Para 00:00–00:48 no NOITE, timestamp vai para o dia seguinte, mantendo agrupamento correto.

### 4.3 Confianca nos dados (validacao)

- Horario HH:MM (24h) com mascara para padronizar entrada.
- `endAt` precisa ser depois de `startAt`.
- Campos obrigatorios por categoria (placa/container/observacoes).

### 4.4 Auditoria e correcao sem perder governanca

Erros de digitacao acontecem (placa/container/horario). A evolucao foi permitir correcao com rastreabilidade:

- Edicao liberada apenas para SUPERVISOR/ADMIN.
- Auditoria completa:
  - `updatedBy`, `updatedByEmail`, `updatedAt`
  - `events/{eventId}/revisions` com snapshot `before/after`.

Resultado: correcao rapida + trilha completa para auditoria.

## 5) Timeline (para contar a evolucao)

### 2025-12-23 — Fundacao
- Base do app (React/Vite/TS + Firebase).
- UI inicial de lancamento + historico.
Refs: `4d09e04`, `505ae62`, `0336f7e`.

### 2025-12-24 — Pronto para operacao
- Gate de aprovacao (approved) e reforco de UX.
- Documentacao tecnica completa.
Refs: `c5a9873`, `260d5e4`, `f66f9ad`.

### 2025-12-29 — Correcao critica
- Geracao de data no fuso local (evita shiftDate errado).
Refs: `275baa6`.

### 2026-01-05 — Mobile e polimento
- Responsividade, correcoes no tema e melhorias de usabilidade.
Refs: `96b91ff`.

### 2026-01-09 — Seguranca e consistencia
- Cliente obrigatorio + rules mais fortes + i18n/UX.
Refs: `5f5b23a`, `e3df3ef`, `5fd4c52`, `5d8ff78`.

### 2026-02-02 — Evolucao do dominio
- Categoria "Em transito" + auto-switch de turno.
Refs: `f947373`.

### 2026-02-03 — Edicao auditavel + comunicacao do update
- Edicao por SUPERVISOR/ADMIN com trilha completa de revisoes.
- Modal de "Novidades" pos-login (aparece uma vez).
Refs: `17f5e7d` e tag `stable-2026-02-03`.

## 6) Pitch objetivo (para aumento)

Estrutura sugerida:

1. **Ownership ponta a ponta**
   - Produto + engenharia + seguranca + deploy em producao.
2. **Complexidade real**
   - Regras de turno/virada, validacao, rules, auditoria e revisoes.
3. **Impacto operacional**
   - Menos retrabalho, mais confianca, base para indicadores.
4. **Gestao de risco**
   - Checkpoint/tag para rollback e release com comunicacao.

## 7) Fechamento (20s)

"Hoje o Transbordo esta em uso pelo time, com seguranca e auditoria para garantir confianca nos dados. A evolucao foi incremental, entregando valor rapido sem abrir mao de uma base tecnica solida para crescer."

