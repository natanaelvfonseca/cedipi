import { createWhatsAppConversationsService, WhatsAppConversationError } from "./whatsapp-conversations-service.js";
import { createMediaAnalyzer, detectSafeAttachment, LaraMediaError } from "./lara-media-analysis.js";
import * as repository from "./lara-media-repository.js";

const validInstance = "Cedipi";
const validMessageId=/^[A-Za-z0-9._:-]{1,200}$/;
const validPhone=/^55\d{10,11}$/;
const validSourceJid=/^\d{8,30}@(s\.whatsapp\.net|c\.us|lid)$/;

export function createLaraMediaService({
  mediaClient=createWhatsAppConversationsService(),
  analyzer=createMediaAnalyzer(),
  repo=repository,
}={}){
 return {
   async read({messageId,phone,instance=validInstance}){
     if(!validPhone.test(phone)||!validMessageId.test(messageId)||instance!==validInstance)
       throw new LaraMediaError("invalid_media_identity",400);
     return repo.getMediaAnalysis(instance,messageId,phone);
   },
   async process({messageId,phone,sourceJid,instance=validInstance}){
     if(!validPhone.test(phone)||!validMessageId.test(messageId)
       ||!validSourceJid.test(sourceJid)||instance!==validInstance)
       throw new LaraMediaError("invalid_media_identity",400);
     // Never allow a source JID for a different phone. @lid can only be
     // supplied via the verified Evolution LID-to-phone mapping in the queue.
     if(!sourceJid.endsWith("@lid") && ![
       phone+"@s.whatsapp.net",phone+"@c.us",
     ].includes(sourceJid))throw new LaraMediaError("media_wrong_conversation",403);
     const cached=await repo.getMediaAnalysis(instance,messageId,phone);
     if(cached?.status==="done")return cached;
     if(cached?.status==="processing")throw new LaraMediaError("media_processing",409);
     let media,kind;
     try{
       media=await mediaClient.getMedia(sourceJid,messageId);
       kind=detectSafeAttachment(media);
     }catch(error){
       if(error instanceof LaraMediaError)throw error;
       if(error instanceof WhatsAppConversationError){
         throw new LaraMediaError(
           error.code==="unsupported_media"?"media_unsupported":"media_not_available",
           error.status===415?415:502,
         );
       }
       throw new LaraMediaError("media_not_available",502);
     }
     const acquired=await repo.claimMediaAnalysis({
       instance,messageId,phone,mediaType:kind.type,
     });
     if(!acquired)throw new LaraMediaError("media_processing",409);
     try{
       const analysis=await analyzer.analyze(media);
       const stored=await repo.saveMediaAnalysis({instance,messageId,phone,analysis});
       if(!stored)throw new LaraMediaError("media_save_failed",503);
       // Retain only minimized administrative analysis for 30 days;
       // the attachment bytes stay on Evolution, never on CEDIPI disk/DB.
       await repo.purgeOldMediaAnalyses().catch(()=>{});
       return stored;
     }catch(error){
       await repo.failMediaAnalysis({
         instance,messageId,phone,
         code:error instanceof LaraMediaError?error.code:"media_analysis_failed",
       }).catch(()=>{});
       if(error instanceof LaraMediaError)throw error;
       throw new LaraMediaError("media_analysis_failed",503);
     }
   },
 };
}

export function replyForMediaAnalysis(result){
  if(!result||result.status!=="done")return {
    text:"Recebi o arquivo, mas não consegui analisá-lo com segurança. Vou encaminhar à recepção para conferência.",
    handoffReason:"media_review",
  };
  if(result.category==="medical_order"&&result.readable&&
    result.exam_names.length>0){
    const names=result.exam_names.map(n=>String(n).slice(0,120)).slice(0,4);
    return {
      text:"Recebi o pedido de exame. Consegui identificar: *"+
        names.join("; ")+"*. Para solicitar um horário, confirme digitando"+
        " *Quero agendar "+names[0]+"*. A recepção poderá conferir o documento original.",
      handoffReason:null,
    };
  }
  if(result.category==="payment_proof")return {
    text:"Recebi o comprovante. A recepção irá conferir o pagamento e "+
      "confirmar a pré-reserva. O pagamento ainda não foi validado.",
    handoffReason:"payment_proof_review",
  };
  return {
    text:"Recebi o arquivo. Vou encaminhar à recepção para "+
      "conferir o documento e continuar seu atendimento.",
    handoffReason:"document_review",
  };
}
