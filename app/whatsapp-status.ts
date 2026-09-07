export type WhatsAppStatus = "connected" | "disconnected" | "connecting" | "qr_required" | "unknown";

type WhatsAppAction = "connect" | "retry" | "refresh";

type WhatsAppPresentation = {
  label: string;
  action: WhatsAppAction;
  actionLabel: string;
};

const presentations: Record<WhatsAppStatus, WhatsAppPresentation> = {
  connected: {
    label: "WhatsApp conectado",
    action: "refresh",
    actionLabel: "Atualizar estado do WhatsApp",
  },
  disconnected: {
    label: "WhatsApp desconectado",
    action: "connect",
    actionLabel: "Conectar WhatsApp",
  },
  connecting: {
    label: "Conectando WhatsApp...",
    action: "refresh",
    actionLabel: "Atualizar estado do WhatsApp",
  },
  qr_required: {
    label: "Aguardando leitura do QR Code",
    action: "refresh",
    actionLabel: "Atualizar estado do WhatsApp",
  },
  unknown: {
    label: "Não foi possível verificar a conexão",
    action: "retry",
    actionLabel: "Tentar novamente",
  },
};

export function getWhatsAppPresentation(status: WhatsAppStatus) {
  return presentations[status];
}
