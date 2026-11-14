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

## Etapa 2 — Lara nativa, webhook Evolution e base de conhecimento (14/11/2026)

Implementado em codigo: migration 008, webhook, inbox persistente e deduplicada,
jobs por telefone com lease, worker separado, respostas via OpenAI Responses API,
memoria recente, busca textual PostgreSQL, transferencias e tela de administracao.
O banco de producao NAO foi modificado nesta etapa.

### O que esta operacional no codigo

- Recepcao de messages.upsert para a instancia EXATA Cedipi, apenas mensagens de
  texto individuais e recebidas (nao grupos, broadcasts, midias ou fromMe).
- Segredo com no minimo 32 caracteres em x-cedipi-webhook-secret.
- Dados de cada mensagem persistidos com id unico (instancia+messageId).
- Debounce por conversa (5 segundos, limitado a 1-20 segundos), lease e
  processamento sequencial por telefone, com recuperacao de workers travados.
- Se houver mensagem nova durante geracao, recomecar com o lote atualizado.
- Controle global e individual consultados ANTES de cada envio. Quando pausado,
  nao ha resposta da IA.
- Resposta curta, somente para perguntas administrativas com fonte indexada.
  Agenda, cancelamento, remarcacao, disponibilidade, atendente humano, urgencia
  ou conhecimento insuficiente geram encaminhamento humano.
- OpenAI Responses API com store:false; modelo configuravel; texto de paciente
  e fontes tratados como dados, nao instrucoes. Sem diagnostico medico.
- Confirmacao de agendamento inferida pelo modelo e bloqueada.
- Limite de 20 respostas por conversa em 24 horas.
- Se o envio do WhatsApp tiver resultado incerto ou nao retornar ID,
  registrar revisao humana, SEM reenvio automatico.
- A pagina Lara IA (administradores) cadastra fontes e gerencia encaminhamentos.

### Estado seguro (padrao)

Mantenha:
CEDIPI_AI_CONTROL_BACKEND=n8n
CEDIPI_APPOINTMENTS_BACKEND=n8n
LARA_INGEST_ENABLED=false
LARA_OUTBOUND_ENABLED=false
LARA_CUTOVER_CONFIRMED=false

Nada desta etapa envia mensagens automaticamente com essas configuracoes.

### Plano de implantacao controlada no EasyPanel

1. Criar uma COPIA do banco e validacao de restore; nunca testar em dados reais.
2. Implantar branch numa URL de homologacao e executar npm run db:migrate
   sobre o banco de homologacao. Inspecionar migration 008 e backup.
3. Criar servico WORKER em EasyPanel com a MESMA imagem da API CEDIPI
   e comando: node server/lara-worker-entrypoint.js. Iniciar com saida
   desativada para certificar conectividade com banco.
4. Configurar variaveis no EasyPanel por gerenciador de segredos:
   DATABASE_URL, EVOLUTION_API_URL, EVOLUTION_API_KEY,
   EVOLUTION_INSTANCE_NAME=Cedipi, OPENAI_API_KEY, LARA_OPENAI_MODEL.
   Configurar segredo aleatorio de pelo menos 32 caracteres em
   LARA_WEBHOOK_SECRET. NAO colocar valores no GitHub.
5. Ainda em ambiente de homologacao, configurar endpoint de teste da Evolution
   para POST /api/webhooks/evolution/lara com header customizado
   x-cedipi-webhook-secret. O suporte a "headers" deve ser confirmado na
   versao da Evolution instalada. Evento MESSAGES_UPSERT, sem byEvents.
6. Ativar LARA_INGEST_ENABLED=true apenas na homologacao. Repetir callbacks,
   confirmar que fromMe, grupos e midias sao ignorados. Verificar status na
   tabela lara_inbound_messages, sem enviar mensagem.
7. Cadastrar documentos oficiais da CEDIPI na tela Lara IA (sem prontuarios
   ou documentos de pacientes), confirmar que as buscas retornam fontes.
8. Testar respostas reais com um NUMERO DE TESTE isolado, sem contato com
   pacientes. Somente no ambiente de teste e com workflow n8n sem responder,
   usar CEDIPI_AI_CONTROL_BACKEND=database,
   LARA_CUTOVER_CONFIRMED=true, LARA_OUTBOUND_ENABLED=true.
9. Validar conteudo, horario de atendimento, custos do modelo, duplicidades,
   concorrencia, encaminhamentos, retorno humano, bloqueio global e individual.
10. Fazer mudanca de destino do webhook da instancia Cedipi em janela definida
    pela clinica, confirmando que o workflow antigo NAO responde. Confirmar
    unica rota ativa, e so depois habilitar as flags de envio da producao.
11. Monitorar logs de codigo de erro (sem conversas em logs) e filas
    manual_review; para rollback desabilitar a saida, reconciliar pausas
    individuais e RESTAURAR destino anterior da Evolution.

### Endpoints
POST /api/webhooks/evolution/lara           — token secreto, sem sessao
GET  /api/lara/knowledge                    — administrador
POST /api/lara/knowledge                    — administrador
PATCH /api/lara/knowledge/:sourceId         — administrador
GET  /api/lara/handoffs                     — administrador
POST /api/lara/handoffs/:id/close           — administrador

### Lacunas antes da operacao de verdade
- Nao foram importados documentos/prompt da clinica; fontes devem ser validadas.
- RAG atual e busca textual PostgreSQL, NAO embeddings/pgvector ainda.
- Webhook de audio, imagem e PDF ainda NAO processa midias.
- A Lara ainda NAO agenda/cancela/remarca diretamente: faltam catalogo de
  procedimentos, politicas de preco/preparo, confirmacao e acoplamento seguro
  ao motor de agenda ja implementado.
- Concluir alerta/rotina da recepcao para novos encaminhamentos no fluxo diario.
- Definir base legal, controle de acesso, politica de retencao e descarte de
  mensagens, e acordos de tratamento de dados em saude antes da ativacao.
- Validar assinatura/configuracao do webhook na versao efetiva da Evolution.
- Homologar OAuth/Google Calendar do passo anterior; nao usar agenda produtiva.
- Implementar reconciliacao de envio incerto com historico da Evolution.
- Nao habilitar envio para numeros reais sem consentimento e aprovacao da clinica.

### Verificacao
npm ci
npm test
npm run build
# Em Postgres de homologacao, apos backup:
npm run db:migrate
node --test test/lara-postgres.test.js
