---
marp: true
title: "Transbordo — Evolucao do Projeto (Timeline)"
paginate: true
---

# Transbordo
## Evolucao do Projeto (Timeline)

**Objetivo:** registro operacional auditavel e exportavel do Transbordo de Glicerina  
**Stack:** React + Vite + Firebase (Auth, Firestore, Hosting)

---

# O problema (antes)

- Operacao registrada "de cabeca" ou em planilhas soltas
- Baixa rastreabilidade e auditoria dificil
- Pouca padronizacao de turnos, horarios e motivos
- Dificuldade de medir gargalos e justificar paradas com dados confiaveis

---

# A solucao (hoje)

- Web app para lancamentos por **bomba (1/2)** e **turno (MANHA/NOITE)**
- Validacao forte de horarios (HH:MM) e regra de virada do turno NOITE (00:00–00:48)
- Historico filtravel + exportacao CSV
- Seguranca por perfis (OPERADOR / SUPERVISOR / ADMIN) com Rules no Firestore

---

# Arquitetura (visao rapida)

- SPA (React) servida via Firebase Hosting
- Auth: email/senha (Firebase Auth)
- Banco: Firestore (`users`, `events`, `clients`)
- Autorizacao: Firestore Rules (camada determinante)

---

# Linha do tempo (macro)

1. **Base do produto** (dez/2025)
2. **Pronto para operacao** (aprovacao + docs) (dez/2025)
3. **Qualidade e mobile** (jan/2026)
4. **Seguranca e consistencia** (jan/2026)
5. **Evolucao operacional** (fev/2026)
6. **Edicao auditavel** (fev/2026)

---

# 2025-12-23 — Base do produto

- Bootstrap do app (React/Vite/TS + Firebase)
- Modelagem inicial (`users`, `events`)
- Primeira versao do formulario + historico
- Fundacao para evolucao rapida com seguranca

Refs: `4d09e04`, `505ae62`, `0336f7e`

---

# 2025-12-24 — Pronto para operacao

- Gate de aprovacao: usuario precisa de `approved=true` para operar
- UX: seletor de bomba mais claro e "mobile friendly"
- Documentacao tecnica completa (base para treinamento e manutencao)

Refs: `c5a9873`, `f66f9ad`, `260d5e4`

---

# 2025-12-29 — Correcao critica (timezone)

- Correcao de geracao de `YYYY-MM-DD` no fuso local
- Resultado: `shiftDate` confiavel (sem "dia errado" na virada)

Refs: `275baa6`

---

# 2026-01-05 — Mobile e polimento (salto)

- Layout responsivo em telas pequenas
- Correcoes no tema/dark mode e ajustes finos de usabilidade
- Melhor experiencia para operacao no patio (celular/tablet)

Refs: `96b91ff` (+ merges)

---

# 2026-01-09 — Seguranca e consistencia

- Cliente obrigatorio em todas as categorias
- Rules com validacao de schema no create + whitelist de campos
- Bloqueio de update em `events` (na epoca, sem UI/auditoria)
- UX: Enter para enviar forms + `lang=pt-BR`

Refs: `5f5b23a`, `e3df3ef`, `5fd4c52`, `5d8ff78`

---

# 2026-02-02 — Evolucao do dominio

- Nova categoria "Em transito" (cliente + placa; sem container)
- Auto-switch para turno NOITE apos 15:00 (sem atrapalhar o usuario)
- Ajustes de validacao e historico

Refs: `f947373`

---

# 2026-02-03 — Edicao auditavel (feature-chave)

- SUPERVISOR/ADMIN podem editar lancamentos (correcao de digitos/horarios)
- Auditoria completa: `revisions` com before/after
- Rules liberam update apenas com validacao rigida e campos imutaveis preservados
- UX: HH:MM 24h na edicao + modal corporativo de "Novidades" (aparece uma vez)

Refs: `17f5e7d` e tag `stable-2026-02-03`

---

# Resultado (impacto)

- Padronizacao e confianca no historico operacional
- Auditoria real (quem criou, quem editou, quando e o que mudou)
- Base para indicadores (tempo produtivo x paradas por motivo)
- Exportacao rapida para analise (CSV)

---

# Proximos passos (sugestoes)

- Tela de consulta de revisoes (timeline de alteracoes por evento)
- Paginacao/relatorios para periodos longos
- Melhorias de acessibilidade e atalhos para operacao

---

# Obrigado

Perguntas?

