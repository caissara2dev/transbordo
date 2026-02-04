# Changelog (Transbordo)

Este arquivo registra as principais mudancas do projeto (aplicativo + regras do Firestore) em ordem cronologica, com base no historico de commits deste repositorio.

## 2026-02-03

- feat: Edicao de lancamentos por SUPERVISOR/ADMIN (UI + validacao + persistencia).
- feat: Auditoria completa de alteracoes via subcolecao `events/{eventId}/revisions` com snapshot `before/after`.
- feat: Campos de auditoria de update: `updatedAt`, `updatedBy`, `updatedByEmail`.
- ux: Horario em formato 24h (HH:MM) tambem no painel de edicao (mesma mascara do lancamento).
- ux: Modal corporativo de "Novidades" apos login (aparece uma vez ao clicar em "Entendi").
- security: Firestore Rules liberam `update` de `events` apenas para SUPERVISOR/ADMIN, com validacao rigida e campos imutaveis preservados.

Refs: commit `17f5e7d`. Checkpoint/tag: `stable-2026-02-03`.

## 2026-02-02

- feat: Nova categoria "Em transito" (cliente + placa obrigatorios; sem container).
- ux: Auto-switch de turno para NOITE apos 15:00 (quando usuario nao alterou manualmente o turno).
- ux: Ajustes no formulario e no historico para exibir corretamente a categoria "Em transito".
- security: Rules atualizadas para incluir a nova categoria e validar campos obrigatorios conforme regra.

Refs: commit `f947373`.

## 2026-01-09

- feat: Cliente passa a ser obrigatorio em todas as categorias.
- security: Validacao de schema no `create` de eventos (whitelist de chaves + regras de obrigatoriedade).
- security: Bloqueio de `update` em `events` (para evitar alteracoes sem UI/auditoria).
- ux: Forms com submit por Enter (login e novo lancamento).
- i18n: `lang=pt-BR` no `index.html` e runtime.

Refs: commits `5f5b23a`, `e3df3ef`, `5fd4c52`, `5d8ff78`.

## 2026-01-05

- ux/ui: Melhorias grandes de layout mobile, responsividade e correcoes no dark mode toggle.
- ux: Ajustes gerais de estilos e comportamento para telas pequenas.
- infra: Merges de PRs e sincronizacao de branch.

Refs: commits `96b91ff`, `129906b`, `24482ef`, `7bcbeb4`, `5025304`.

## 2025-12-29

- fix: Correcao de data "local" para evitar bug de timezone ao gerar `YYYY-MM-DD` com `toISOString()`.

Refs: commit `275baa6`.

## 2025-12-24

- feat: Gate de aprovacao (`approved`) antes do usuario conseguir operar (UI + rules).
- docs: Documentacao tecnica do projeto (visao, arquitetura, fluxos e regras).
- ui: Melhorias no seletor de bomba (tap targets e estado selecionado).
- ux: Ajustes menores de textos e mensagens do UI.
- infra: Merge PR #1 (fix/mobile-layout).

Refs: commits `c5a9873`, `260d5e4`, `f66f9ad`, `3dbc739`, `c37e16c`.

## 2025-12-23

- repo: Checkpoint inicial do produto com base do app (React/Vite/TS + Firebase Hosting/Firestore/Auth).
- ui: Estrutura inicial do App e CSS base.
- style: Inclusao de classes responsivas utilitarias.
- fix: Ajustes iniciais de responsividade e query/historico para OPERADOR.

Refs: commits `4d09e04`, `505ae62`, `0336f7e`.

