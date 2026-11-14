# CEDIPI — migracao controlada do n8n

## Inventario tecnico (14/11/2026)
- Repositorio: natanaelvfonseca/cedipi; baseline main 437b9a5.
- Deploy publicado: https://cedipi-agenda.hb8ldj.easypanel.host.
- O health check publico devolveu OK e PostgreSQL conectado (consulta sem acesso aos dados).
- Painel: React/Vite; API: Express; banco: PostgreSQL cedipi_core.
- WhatsApp: Evolution API; inbox e controle de IA individual vinculados ao webhook n8n.
- Agenda: horarios, medicos, bloqueios e reservas em PostgreSQL; confirmacao usa n8n / Google Calendar.
- Webhook da Lara, memoria, RAG, Google Calendar e autenticação do Google ainda exigem auditoria na instalacao real.
- Nao houve acesso autenticado a configuracao EasyPanel, nem leitura dos dados de pacientes.

## Funcionalidades criadas nesta branch
1. Migracao 007: tabela de controle individual de IA no PostgreSQL.
2. Seletor CEDIPI_AI_CONTROL_BACKEND=n8n|database (padrao n8n).
3. Gate canLaraReply: verifica controle global e individual, sem resposta em falha de banco.
4. Seletor CEDIPI_APPOINTMENTS_BACKEND=n8n|google (padrao n8n).
5. Cliente Google OAuth refresh token e Calendar API: consulta evento pelo ID, verifica FreeBusy,
   cria evento com ID deterministico e sem dados pessoais no titulo ou descricao.
6. Testes automatizados com APIs simuladas.

## Gate de ativacao / proxima etapa
- [ ] Backup verificado do banco e das configuracoes de workflows.
- [ ] Verificar o schema e filas reais do EasyPanel; mapear a origem de webhooks da Evolution.
- [ ] Concluir receptor nativo de mensagens, buffer e worker da Lara, com retentativas e deduplicacao.
- [ ] Migrar prompt/acoes/RAG (fonte n8n) e memoria conversacional.
- [ ] Criar interface de configuracao das credenciais Google da clinica ou provisiona-las por segredo seguro.
- [ ] Testar leitura FreeBusy e escrita de evento em agenda de homologacao, nao em agenda de medico real.
- [ ] Conciliar agendamentos antigos com eventos atuais do Google Calendar.
- [ ] Implementar sincronizacao de eventos externos e recuperacao de falha entre Google e PostgreSQL.
- [ ] Checar que mensagens humanas, pausa individual e controle global funcionam no worker nativo.
- [ ] Validar recepcao QR Code e dados do cadastro de pacientes.
- [ ] Testar ponta a ponta com equipe da CEDIPI, com cenarios de falha, horarios ocupados e concorrencia.
- [ ] Fazer cutover do webhook Evolution, verificar ausencia de respostas duplicadas e so depois desligar n8n.
- [ ] Rotacionar segredos que estavam exportados em workflows antigos.
- [ ] Auditar tratamento de dados sensiveis, logs, permissões e retencao conforme LGPD.

## Regras para operacao
Enquanto o n8n ainda responder aos pacientes, mantenha as duas flags como n8n.
A chave database no controle de IA pode exibir um estado diferente daquele lido pelo
workflow antigo; e a chave google pode adicionar eventos sem a reconciliacao completa.
As duas alternativas estao implementadas para testes e nao devem ser habilitadas em
producao nesta etapa. Nenhuma migration de producao foi executada nesta branch.

## Diagnosticos
npm ci
npm test
npm run build
git diff --check

Ao ativar em homologacao, execute npm run db:migrate apos backup e verifique o
rollback. Nao armazenar segredos OAuth ou dados de pacientes no repositorio.
