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

## Agenda nativa CEDIPI — sem Google ou n8n (migration 010)

O codigo da agenda da Growup foi inspecionado como referencia conceitual:
a regra de horarios livres fica separada da regra de marcar/remarcar,
o fuso pertence ao negocio e a sobreposicao tem protecao transacional.
A CEDIPI NAO utiliza o Google Calendar nem o banco da Growup.

A migration 010 adiciona a exclusao PostgreSQL btree_gist para intervalos
de consultas ativas do mesmo medico, aplica revisoes e guarda o estado
de adiantamentos e aprovacao medica. A reserva da Lara valida medico,
duracao e escala, bloqueios, disponibilidade e colisao no banco.
A agenda usa America/Sao_Paulo e confirma imediatamente exames abaixo
de R$ 400; valores a partir de R$ 400 criam pre-reserva de ate 24h,
aguardando pagamento e revisao da recepcao. Biópsias/PAAF necessitam
de aprovacao medica e podem demandar confirmacao posterior de Pix.
A chave Pix oficial e consultada no DOCUMENTO PRIVADO somente depois
que a pre-reserva existe e o paciente confirmou explicitamente o horario.

O painel administrativo disponibiliza acao de aprovar procedimento,
verificar pagamento e cancelar reserva; o banco registra eventos de
auditoria e exige autorizacao administrativa nas rotas HTTP.
A fonte de verdade e a tabela appointments e a lista de bloqueios.
As consultas de horarios do painel e da Lara utilizam este banco.
O campo CEDIPI_APPOINTMENTS_BACKEND=native ativa a implementacao.
Credenciais Google Calendar nao sao exigidas.

A OPENAI_API_KEY nao deve integrar Git, SQL, logs, parametros publicos ou
frontend. Em Docker Swarm, montar um Docker secret com target
cedipi_openai_api_key, lido em /run/secrets/cedipi_openai_api_key.
O modulo openai-credentials suporta tambem OPENAI_API_KEY_FILE.
Trocar a chave apos uso inicial porque ela foi publicada em uma conversa.

## Leitura de imagens e PDFs no WhatsApp (migration 011)

O worker da Lara recebe automaticamente imagens e documentos na
conversa WhatsApp; a recepcao continua podendo abrir o arquivo original
na tela Conversas. O backend pega o arquivo da Evolution **Cedipi**,
valida o tipo real pelos bytes (JPEG, PNG, WebP e PDF) e os tamanhos
ate 8 MiB/imagem ou 12 MiB/PDF. O endpoint de analise e autenticado;
nao existe upload publico ou download externo sem autenticar o operador.

O documento e enviado por canal TLS a OpenAI Responses com
store:false. Imagens usam input_image, PDF usa input_file, incluindo
PDFs digitalizados (a depender da qualidade). A IA so classifica documentos
administrativamente e extrai nomes de exames legiveis. Ela nao confirma
pagamento, assinatura, diagnostico, autenticidade, preparos especiais
nem adiantamentos; essas decisoes permanecem com a recepcao.

Os arquivos originais ficam na Evolution; o PostgreSQL salva somente
resultado administrativo resumido, nunca base64 ou binario. O sistema
remove analises com mais de 30 dias nas novas gravacoes. A rota de
analise obedece ao telefone e ID de mensagem do usuario autenticado,
e a fila usa o JID original apenas apos validar a correspondencia
da Evolution para mensagens @lid.

No WhatsApp, em LARA_MEDIA_ANALYSIS_ENABLED=true, a Lara identifica
um pedido de exame e pergunta ao paciente se quer agendar, exigindo
confirmacao textual do nome do exame. Comprovante de pagamento e arquivo
ilegiveis recebem protocolo de atendimento humano. Audios continuam
com atendimento humano, pois nao fazem parte desta entrega.

Antes de ativar para todo o publico, conferir bases legais, transparencia
e governanca da LGPD para dados sensiveis de saude, com a clinica.
Manter o webhook global no n8n e o teste nativo restrito a um unico
numero ate o corte completo e aprovado.


## Pedido medico recebido por WhatsApp inicia agendamento automaticamente

A partir da versao de atendimento multimodal conversacional, nao existe
botao "Ler com Lara IA" na tela de Conversas e o endpoint manual POST
de analise de anexos foi desativado. A leitura acontece no worker nativo
depois de a Evolution informar a chegada de imagem/PDF no WhatsApp.

Para pedidos medicos legiveis: o modelo extrai os nomes dos exames, a
Lara verifica os nomes no catalogo OFICIAL da clinica, guarda o estado da
conversa na tabela lara_conversation_state e pergunta a data, sem exigir
que o paciente repita "quero agendar". Se houver varios exames, a Lara
oferece uma selecao e consulta a agenda do medico apos a escolha.
A reserva efetiva ocorre apenas ao final, depois de confirmacao explicita
do horario e nome do paciente, pela transacao nativa do PostgreSQL.

Se o paciente envia multiplas fotos no mesmo lote, a Lara analisa
as paginas em paralelo e considera os exames encontrados em todas elas.
Fotos de comprovantes entram em revisao manual de pagamento; documento
ilegivel nao origina exame ficticio. Sem audio transcrito nesta etapa.

ATENCAO: LARA_TEST_MODE=true segue estritamente limitado ao numero de
teste autorizado. O webhook global continua com o fluxo legado n8n.
Nao ativar o cutover para todos os pacientes sem homologar o recebimento
real de anexos Evolution -> Lara -> WhatsApp e definir a rota exclusiva
de entrada, para evitar respostas duplicadas e conflitos na agenda.


## Operação real da Lara — ativação e observabilidade

A produção possui **dois modos mutuamente exclusivos**:
- LARA_TEST_MODE=true: apenas uma conversa autorizada, sem alterar webhook antigo.
- LARA_PRODUCTION_MODE=true: workers contínuos para várias conversas, fila persistente, monitoramento de entregas e webhook de instância autenticado. Não pode coexistir com modo de teste.

Antes do corte, o sistema exige LARA_INGEST_ENABLED=true,
LARA_OUTBOUND_ENABLED=true, LARA_CUTOVER_CONFIRMED=true,
CEDIPI_AI_CONTROL_BACKEND=database, CEDIPI_APPOINTMENTS_BACKEND=native,
LARA_MEDIA_ANALYSIS_ENABLED=true e segredo separado de autenticação do webhook.
A chave OpenAI e o segredo do webhook ficam como Docker Secrets.
A configuração do webhook deve apontar EXCLUSIVAMENTE para
https://cedipi-agenda.hb8ldj.easypanel.host/api/webhooks/evolution/lara,
com header x-cedipi-webhook-secret. Headers precisam constar no retorno
de /webhook/find/Cedipi para o corte ser considerado concluído.

O serviço de produção monitora o webhook e, somente quando
LARA_WEBHOOK_AUTO_REPAIR=true, repara configurações perdidas pela Evolution
após reinicialização. Mensagens anteriores ao corte podem ser filtradas por
LARA_CUTOVER_UNIX_SECONDS para evitar respostas tardias duplicadas.
Uma fila no PostgreSQL protege contra duplicação e separa trabalho por
conversa. A entrega incerta nunca é reenviada automaticamente: necessita
verificação humana.

**Transição sem respostas duplicadas:** salvar a configuração anterior,
aplicar a nova imagem e habilitar o endpoint de ingestão com workers ainda
desligados; alterar o webhook da instância; conferir a rota e autenticação;
desligar o fluxo n8n para esta instância; confirmar agenda e meios de
atendimento da equipe; habilitar a IA global e os workers; observar a fila,
entregas incertas, encaminhamentos e agendamentos. Na reversão, primeiro
parar workers e auto-reparo, restaurar webhook anterior e depois liberar
fluxo legado. Não deixar n8n e Lara respondendo ao mesmo paciente.

**Bloqueador de agenda:** os horários semanais dos médicos não provam
que a agenda está livre de compromissos feitos fora do PostgreSQL.
Não habilitar confirmação automática indiscriminadamente enquanto a
agenda atual de cada médico não estiver reconciliada com a agenda
nativa. A exclusão transacional evita duas reservas *do próprio sistema*,
mas não identifica compromissos externos desconhecidos.

O painel Lara IA (admin) mostra o status da IA global, processadores,
fila pendente, entregas incertas, solicitações e encaminhamentos. No
tratamento de imagens/PDF, a OpenAI extrai apenas nomes de exames;
comprovantes nunca são confirmados sem conferência financeira e biópsias
continuam exigindo aprovação médica. Dados clínicos exigem governança
de privacidade da clínica, conforme LGPD.
