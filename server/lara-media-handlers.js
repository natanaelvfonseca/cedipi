import { createLaraMediaService } from "./lara-media-service.js";
import { LaraMediaError } from "./lara-media-analysis.js";
import { normalizeIndividualConversationId } from "./whatsapp-phone.js";

const validMessageId=/^[A-Za-z0-9._:-]{1,200}$/;

function identity(req){
 let id;
 try{id=normalizeIndividualConversationId(
   decodeURIComponent(req.params.conversationId??""),
 )}catch{return null}
 if(!id||!validMessageId.test(req.params.messageId??""))return null;
 return {phone:id.phone,messageId:req.params.messageId,sourceJid:id.remoteJid};
}

function statusCode(error){
 return error instanceof LaraMediaError?error.status:503;
}
function errorCode(error){
 return error instanceof LaraMediaError?error.code:"media_unavailable";
}
export function createGetMediaAnalysisHandler(service=createLaraMediaService()){
 return async(req,res)=>{
   const params=identity(req);
   if(!params){res.status(400).json({ok:false,error:"invalid_media_identity"});return;}
   try{
     const analysis=await service.read(params);
     res.set("Cache-Control","no-store");
     res.status(200).json({ok:true,analysis});
   }catch(e){res.status(statusCode(e)).json({ok:false,error:errorCode(e)})}
 };
}
export function createAnalyzeMediaHandler(service=createLaraMediaService()){
 return async(req,res)=>{
   const params=identity(req);
   if(!params){res.status(400).json({ok:false,error:"invalid_media_identity"});return;}
   try{
     const analysis=await service.process(params);
     res.set("Cache-Control","no-store");
     res.status(200).json({ok:true,analysis});
   }catch(e){res.status(statusCode(e)).json({ok:false,error:errorCode(e)})}
 };
}
