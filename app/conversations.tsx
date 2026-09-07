import {
  AlertTriangle,
  ArrowLeft,
  CheckCheck,
  FileText,
  Image as ImageIcon,
  MessageCircle,
  Mic,
  RefreshCw,
  Search,
  Send,
} from "lucide-react";
import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  getConversationAiControl,
  getWhatsAppConversations,
  getWhatsAppMessages,
  patchConversationAiControl,
  sendWhatsAppMessage,
  type WhatsAppConversation,
  type WhatsAppMessage,
} from "./whatsapp-api";
import {
  acquireConversationSendLock,
  conversationInitial,
  conversationsPollingMs,
  filterConversations,
  formatConversationTime,
  formatMessageTime,
  mergeMessages,
  messagePresentation,
  messageSide,
  messagesPollingMs,
  isSendableMessage,
  sortMessages,
  startControlledPolling,
} from "./whatsapp-model";
import {
  aiControlReducer,
  initialAiControlState,
  isAiControlSwitchDisabled,
} from "./ai-control-model";
import { LaraControl } from "./lara-control";

type ConversationsProps = {
  notify: (message: string, kind: "success" | "error") => void;
  openMobileMenu: () => void;
};

function ContactAvatar({ conversation, size = "regular" }: {
  conversation: WhatsAppConversation;
  size?: "regular" | "large";
}) {
  const [failed, setFailed] = useState(false);
  const className = `conversation-avatar ${size === "large" ? "large" : ""}`;
  if (conversation.profilePictureUrl && !failed) {
    return <img className={className} src={conversation.profilePictureUrl} alt="" onError={() => setFailed(true)} />;
  }
  return <span className={className}>{conversationInitial(conversation.name, conversation.phone)}</span>;
}

function MessageContent({ message }: { message: WhatsAppMessage }) {
  const presentation = messagePresentation(message);
  const Icon = message.type === "audio" ? Mic : message.type === "image" ? ImageIcon : FileText;
  return (
    <>
      {message.type !== "text" ? <span className="message-media-label"><Icon size={15} />{presentation.label}</span> : null}
      {presentation.detail ? <p>{presentation.detail}</p> : null}
    </>
  );
}

function deliveryLabel(status: string | null) {
  if (status === "READ" || status === "PLAYED") return "Lida";
  if (status === "DELIVERY_ACK") return "Entregue";
  if (status === "SERVER_ACK" || status === "PENDING") return "Enviada";
  return "";
}

export function Conversations({ notify, openMobileMenu }: ConversationsProps) {
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [conversationsError, setConversationsError] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [individualControl, dispatchIndividualControl] = useReducer(aiControlReducer, initialAiControlState);
  const listRequestActive = useRef(false);
  const messagesRequestId = useRef<string | null>(null);
  const messagesRequestVersion = useRef(0);
  const aiRequestId = useRef<string | null>(null);
  const aiRequestVersion = useRef(0);
  const sendLock = useRef(false);
  const aiSaveLock = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  const messagesPane = useRef<HTMLDivElement | null>(null);
  const shouldAutoScroll = useRef(true);

  selectedIdRef.current = selectedId;
  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId],
  );
  const selectedConversationId = selectedConversation?.id ?? null;
  const selectedConversationPhone = selectedConversation?.phone ?? null;
  const visibleConversations = useMemo(
    () => filterConversations(conversations, query),
    [conversations, query],
  );

  const loadConversations = useCallback(async (signal?: AbortSignal, initial = false) => {
    if (listRequestActive.current) return;
    listRequestActive.current = true;
    if (initial) setConversationsLoading(true);
    try {
      const items = await getWhatsAppConversations(signal);
      if (signal?.aborted) return;
      setConversations(items);
      setConversationsError(false);
      setSelectedId((current) => current && items.some((item) => item.id === current) ? current : null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setConversationsError(true);
    } finally {
      listRequestActive.current = false;
      if (!signal?.aborted) setConversationsLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (
    conversation: WhatsAppConversation,
    signal?: AbortSignal,
    initial = false,
    force = false,
    preserveCurrent = false,
  ) => {
    if (!force && messagesRequestId.current === conversation.id) return;
    const version = messagesRequestVersion.current + 1;
    messagesRequestVersion.current = version;
    messagesRequestId.current = conversation.id;
    if (initial) setMessagesLoading(true);
    try {
      const items = await getWhatsAppMessages(conversation.id, signal);
      if (signal?.aborted || selectedIdRef.current !== conversation.id || messagesRequestVersion.current !== version) return;
      setMessages((current) => preserveCurrent ? mergeMessages(current, items) : sortMessages(items));
      setMessagesError(false);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (selectedIdRef.current === conversation.id && messagesRequestVersion.current === version) setMessagesError(true);
    } finally {
      if (messagesRequestVersion.current === version) messagesRequestId.current = null;
      if (!signal?.aborted && selectedIdRef.current === conversation.id && messagesRequestVersion.current === version) setMessagesLoading(false);
    }
  }, []);

  const loadIndividualControl = useCallback(async (
    conversation: WhatsAppConversation,
    signal?: AbortSignal,
    force = false,
  ) => {
    if (!force && aiRequestId.current === conversation.id) return;
    const version = aiRequestVersion.current + 1;
    aiRequestVersion.current = version;
    aiRequestId.current = conversation.id;
    dispatchIndividualControl({ type: "load_started" });
    try {
      const enabled = await getConversationAiControl(conversation.phone, signal);
      if (signal?.aborted || selectedIdRef.current !== conversation.id || aiRequestVersion.current !== version) return;
      dispatchIndividualControl({ type: "load_succeeded", enabled });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (selectedIdRef.current === conversation.id && aiRequestVersion.current === version) dispatchIndividualControl({ type: "load_failed" });
    } finally {
      if (aiRequestVersion.current === version) aiRequestId.current = null;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadConversations(controller.signal, true);
    const polling = startControlledPolling({
      task: () => loadConversations(controller.signal),
      intervalMs: conversationsPollingMs,
    });
    return () => {
      controller.abort();
      polling.stop();
      listRequestActive.current = false;
    };
  }, [loadConversations]);

  useEffect(() => {
    dispatchIndividualControl({ type: "reset" });
    setMessages([]);
    setMessagesError(false);
    setSendError(false);
    shouldAutoScroll.current = true;
    if (!selectedConversation) return undefined;

    const controller = new AbortController();
    void loadMessages(selectedConversation, controller.signal, true);
    void loadIndividualControl(selectedConversation, controller.signal);
    const polling = startControlledPolling({
      task: () => loadMessages(selectedConversation, controller.signal),
      intervalMs: messagesPollingMs,
    });
    return () => {
      controller.abort();
      polling.stop();
      if (messagesRequestId.current === selectedConversation.id) messagesRequestId.current = null;
      if (aiRequestId.current === selectedConversation.id) aiRequestId.current = null;
    };
  }, [loadIndividualControl, loadMessages, selectedConversationId, selectedConversationPhone]);

  useEffect(() => {
    if (!shouldAutoScroll.current || !messagesPane.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (messagesPane.current) messagesPane.current.scrollTop = messagesPane.current.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

  function trackScroll() {
    const pane = messagesPane.current;
    if (!pane) return;
    shouldAutoScroll.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 100;
  }

  async function toggleIndividualControl() {
    if (!selectedConversation || aiSaveLock.current || isAiControlSwitchDisabled(individualControl) || individualControl.globalEnabled === null) return;
    const previousEnabled = individualControl.globalEnabled;
    aiSaveLock.current = true;
    dispatchIndividualControl({ type: "save_started" });
    try {
      const enabled = await patchConversationAiControl(selectedConversation.phone, !previousEnabled);
      dispatchIndividualControl({ type: "save_succeeded", enabled });
    } catch {
      dispatchIndividualControl({ type: "save_failed", previousEnabled });
      notify("Não foi possível alterar a IA desta conversa.", "error");
    } finally {
      aiSaveLock.current = false;
    }
  }

  async function submitMessage(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!selectedConversation || !isSendableMessage(draft) || !acquireConversationSendLock(sendLock)) return;
    setSending(true);
    setSendError(false);
    try {
      const sent = await sendWhatsAppMessage(selectedConversation.id, text);
      shouldAutoScroll.current = true;
      setMessages((current) => mergeMessages(current, [sent]));
      setDraft("");
      await Promise.allSettled([
        loadMessages(selectedConversation, undefined, false, true, true),
        loadIndividualControl(selectedConversation, undefined, true),
        loadConversations(),
      ]);
    } catch {
      setSendError(true);
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  }

  const individualEnabled = individualControl.globalEnabled === true;
  const individualUnavailable = individualControl.globalEnabled === null;

  return (
    <>
      <header className="topbar conversations-topbar">
        <div className="title-wrap">
          <button className="mobile-menu" onClick={openMobileMenu} aria-label="Abrir menu"><MessageCircle size={21} /></button>
          <div><h1>Conversas</h1><p>Atendimento pelo WhatsApp da CEDIPI</p></div>
        </div>
        <LaraControl compact notify={notify} />
      </header>

      <section className={`inbox-shell ${selectedConversation ? "has-selection" : ""}`}>
        <aside className="conversations-list" aria-label="Lista de conversas">
          <div className="conversations-list-head">
            <div><h2>Conversas</h2><span>{conversations.length}</span></div>
            <label className="conversation-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome ou telefone" aria-label="Buscar conversas" /></label>
          </div>
          <div className="conversation-items">
            {conversationsLoading ? <div className="inbox-state"><RefreshCw className="spin" size={18} />Carregando conversas...</div> : null}
            {!conversationsLoading && conversationsError && conversations.length === 0 ? <div className="inbox-state error-state"><AlertTriangle size={18} />Não foi possível carregar as conversas.<button onClick={() => void loadConversations(undefined, true)}>Tentar novamente</button></div> : null}
            {!conversationsLoading && !conversationsError && conversations.length === 0 ? <div className="inbox-state"><MessageCircle size={20} />Nenhuma conversa encontrada.</div> : null}
            {!conversationsLoading && conversations.length > 0 && visibleConversations.length === 0 ? <div className="inbox-state">Nenhuma conversa corresponde à busca.</div> : null}
            {visibleConversations.map((conversation) => (
              <button className={`conversation-item ${conversation.id === selectedId ? "selected" : ""}`} key={conversation.id} onClick={() => setSelectedId(conversation.id)}>
                <ContactAvatar conversation={conversation} />
                <span className="conversation-item-copy"><span><strong>{conversation.name || conversation.phone}</strong><time>{formatConversationTime(conversation.lastMessageAt)}</time></span><span><small>{conversation.lastMessage || "Sem mensagens"}</small>{conversation.unreadCount > 0 ? <b>{conversation.unreadCount}</b> : null}</span></span>
              </button>
            ))}
          </div>
        </aside>

        <section className="conversation-chat" aria-label="Conversa selecionada">
          {!selectedConversation ? <div className="conversation-placeholder"><span><MessageCircle size={26} /></span><h2>Selecione uma conversa</h2><p>Escolha um contato para visualizar o histórico e responder pelo WhatsApp.</p></div> : (
            <>
              <header className="conversation-header">
                <button className="conversation-back" onClick={() => setSelectedId(null)} aria-label="Voltar para conversas"><ArrowLeft size={20} /></button>
                <ContactAvatar conversation={selectedConversation} size="large" />
                <div className="conversation-contact"><strong>{selectedConversation.name || selectedConversation.phone}</strong><span>{selectedConversation.phone}</span></div>
                <div className="individual-ai-control">
                  <span><small>IA nesta conversa</small><strong>{individualControl.loading ? "Consultando..." : individualUnavailable ? "Indisponível" : individualEnabled ? "Ativa" : "Pausada"}</strong></span>
                  <button type="button" className={`lara-switch ${individualEnabled ? "on" : "off"} ${individualUnavailable ? "unknown" : ""}`} role="switch" aria-checked={individualEnabled} aria-label={individualEnabled ? "Pausar IA nesta conversa" : "Ativar IA nesta conversa"} disabled={isAiControlSwitchDisabled(individualControl)} onClick={() => void toggleIndividualControl()}><span /></button>
                </div>
              </header>

              <div className="messages-pane" ref={messagesPane} onScroll={trackScroll}>
                {messagesLoading ? <div className="inbox-state"><RefreshCw className="spin" size={18} />Carregando mensagens...</div> : null}
                {!messagesLoading && messagesError && messages.length === 0 ? <div className="inbox-state error-state"><AlertTriangle size={18} />Não foi possível carregar as mensagens.<button onClick={() => void loadMessages(selectedConversation, undefined, true)}>Tentar novamente</button></div> : null}
                {!messagesLoading && !messagesError && messages.length === 0 ? <div className="inbox-state"><MessageCircle size={20} />Esta conversa ainda não possui mensagens.</div> : null}
                {messages.map((message, index) => (
                  <div className={`message-row ${messageSide(message) === "cedipi" ? "outgoing" : "incoming"}`} key={message.id ?? `${message.timestamp}-${index}`}>
                    <div className="message-bubble">
                      <MessageContent message={message} />
                      <span className="message-meta"><time>{formatMessageTime(message.timestamp)}</time>{message.fromMe && deliveryLabel(message.status) ? <span><CheckCheck size={12} />{deliveryLabel(message.status)}</span> : null}</span>
                    </div>
                  </div>
                ))}
              </div>

              <form className="message-composer" onSubmit={submitMessage}>
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleComposerKeyDown} placeholder="Digite uma mensagem..." rows={1} disabled={sending} aria-label="Mensagem" />
                <button type="submit" className="button button-primary" disabled={sending || !isSendableMessage(draft)}>{sending ? <RefreshCw className="spin" size={17} /> : <Send size={17} />}{sending ? "Enviando..." : "Enviar"}</button>
                {sendError ? <p role="alert">Não foi possível enviar a mensagem. Tente novamente.</p> : null}
              </form>
            </>
          )}
        </section>
      </section>
    </>
  );
}
