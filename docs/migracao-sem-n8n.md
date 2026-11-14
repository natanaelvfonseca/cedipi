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

## Homologacao isolada reproduzivel (terceira etapa)

Os arquivos homologation/docker-compose.yml e scripts/homologation/* oferecem
uma pilha de teste com banco proprio, API e worker nativos e dois endpoints
falsos (WhatsApp Evolution e OpenAI), sem acesso a dados ou numeros reais.
A API publica apenas localhost:18083 no host que executar Compose.
O segredo da homologacao reside em arquivo chmod 600 NAO versionado.

O teste scripts/homologation/smoke.mjs verifica do HTTP ate o banco e
o retorno fake WhatsApp: autenticacao, mensagem duplicada, agrupamento,
historico, consulta textual, pedido de agendamento encaminhado, pausa
da Lara e quarentena de falhas incertas.

O script recusa execucao se NODE_ENV, URL do banco ou servicos externos
nao identificarem o ambiente isolado explicitamente.

NUNCA usar chaves ou numeros de pacientes reais na homologacao com mocks.
O ambiente ainda NAO prova conectividade real de OpenAI/Evolution da clinica.
A execucao de testes do CI cria e elimina os containers, sem retencao de dados.

## Modo seguro de teste WhatsApp em producao (LID / Evolution)

- LARA_TEST_MODE=true ativa a verificacao periodica **somente** da
  conversa conhecida em LARA_TEST_REMOTE_JID, associada ao numero
  autorizado LARA_TEST_PHONE e apenas a mensagens com timestamp
  >= LARA_TEST_MIN_TIMESTAMP (Unix em segundos).
- A conexao Evolution permanece com o webhook antigo do n8n, sem
  trocar o webhook global e sem enviar mensagens a outros pacientes.
- O modo de teste falha no inicio se faltar identificador, numero,
  instante de inicio ou instancia correta. O worker tem **allowlist**
  adicional, checa pausa global/individual e nao tenta reenviar
  mensagens com status incerto.
- Se uma resposta humana ou do n8n for mais recente que a mensagem
  recebida, o teste ignora o recebimento para nao duplicar respostas.
- Uma saudacao simples tem resposta deterministica e acolhedora sem
  necessitar da API OpenAI. Perguntas clinicas, agendamentos ou outros
  assuntos sem conhecimento homologado seguem para a recepcao e pausam
  o bot naquele contato. Nenhum agendamento autonomo e confirmado.
- LARA_INGEST_ENABLED, LARA_OUTBOUND_ENABLED e
  LARA_CUTOVER_CONFIRMED continuam false neste modo; a ativacao
  completa e um processo distinto que exige validacao da OpenAI, RAG,
  agenda e do roteamento de webhooks.
- Para encerrar instantaneamente, alterar LARA_TEST_MODE=false e
  atualizar o servico; conservar o registro do teste para auditoria.

## Clinica CEDIPI: seis documentos oficiais e triagem clinica

A fonte **privada e verificada por SHA-256** e composta pelos arquivos
01 Agenda Médicos, 02 Biópsias/PAAF/Core, 03 Ultrassons, 04 Preparos
Especiais, 05 Pagamentos/PIX e 06 Mensagens de Confirmação. O importador
scripts/import-official-catalog.js exige exatamente 6 documentos e
47 exames. Um arquivo JSON privado gerado dos DOCX originais deve ser
montado no container (por exemplo, /run/secrets/official.json). **Nunca
versionar os DOCX, os dados completos do Pix, o arquivo JSON ou credenciais
no GitHub: o repositorio CEDIPI e publico.**

A migração 009 cria o catalogo com 39 ultrassons e 8 PAAFs/Core-Biopsies,
fontes integrais apenas no banco, solicitacoes e estado da conversa.
O importador e idempotente e conserva informacoes oficiais existentes fora
das fontes por ele gerenciadas.

A Lara nativa obedece obrigatoriamente a estas etapas:
1. Identificar procedimento sem inventar sinonimos, duracao ou medico.
2. Informar preco, duracao, medicos e preparo **somente** do catalogo;
   quando houver medicacao, anticoagulantes, endometriose ou descricao
   incompleta, encaminhar a recepcao.
3. Identificar data desejada; consultar escala semanal, bloqueios, pedidos
   existentes e agendamentos locais, considerando a duracao integral.
4. Mostrar horarios **preliminares e sujeitos a confirmacao**, nunca uma
   disponibilidade final do Google sem autorizacao OAuth da clinica.
5. Permitir opcao, nome/sobrenome e consentimento explicito para criar
   pedido com status needs_verification ou awaiting_medical_approval.
6. Marcar o pedido como encaminhado e pausar a IA nesse contato, de modo
   que um atendente verifique agenda externa, aprovacao, comprovante,
   adiantamento, remarcacao/cancelamento e confirmacao final.
7. Taxa de 20% para exames com preco igual ou maior a R$ 400; taxa
   abatida do valor final. A chave PIX so pode ser fornecida no momento
   correto da confirmacao de um horario JA verificado. Comprovante nao
   equivale a pagamento validado.
8. Para descricao sem fonte ou situacao de emergencia, pedir recepcao/
   atendimento de urgencia, sem orientacao medica nem diagnostico.
9. Fotos, documentos e audios nao sao interpretados como comprovante
   validado; vao para conferência humana.

As escalas dos Drs. Danilo, Wagner e Deison ja constam na migration 006.
A duracao do Core-Biopsy de partes moles nao consta no material oficial
e NAO deve ser inferida. O documento 04 tem medicamentos e enemas,
exigindo revisao profissional antes de qualquer instrucao personalizada.

## Dependencias para uma ativacao 100% autonoma

1. OPENAI_API_KEY valida da conta API (gpt-5.4-mini testado em Responses,
   configurado com store:false, sem tools de escrita). A chave nao foi
   fornecida; a regra deterministica trabalha sem ela.
2. CEDIPI_GOOGLE_CLIENT_ID, CEDIPI_GOOGLE_CLIENT_SECRET,
   CEDIPI_GOOGLE_REFRESH_TOKEN, autorizados para as tres agendas da
   CEDIPI, escopos adequados de consulta a disponibilidade e eventos.
   Os IDs de calendario existem, mas token OAuth **nao** esta configurado.
3. Validacao real de freeBusy, escrita, cancelamento/remarcacao,
   pagamentos, comprovantes e processos de aprovacao medica. Enquanto
   isso NAO se afirma que um agendamento ficou confirmado.
4. Homologacao de producao com o numero autorizado e revisao LGPD
   pela equipe clinica, antes do corte global da Evolution/n8n.

Os endpoints administrativos autenticados:
GET /api/lara/catalog, GET /api/lara/booking-requests,
GET /api/lara/readiness, GET /api/lara/official-documents/1..6.
Nenhum deles deve ser disponibilizado sem verificacao da sessao admin.

Em modo de teste, manter o webhook global apontado para n8n,
LARA_TEST_MODE=true apenas para um contato, e LARA_INGEST_ENABLED=false,
LARA_OUTBOUND_ENABLED=false e LARA_CUTOVER_CONFIRMED=false.
