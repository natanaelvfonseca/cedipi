import { listAvailability } from "./scheduling-repository.js";
import { parseLiveAvailabilityQuery } from "./n8n-agenda-handlers.js";

export function createNativeLiveAvailabilityHandler(find = listAvailability) {
  return async function handler(request,response) {
    const input=parseLiveAvailabilityQuery(request.query);
    if(!input) {
      response.status(400).json({ok:false,error:"invalid_request"});
      return;
    }
    try {
      const slots=await find({date:input.date,doctor:input.doctorId||input.doctor});
      const available=slots.filter(s=>s.status==="available")
        .filter(s=>!input.after || s.startsAtLocal.slice(11,16)>input.after)
        .filter(s=>!input.period ||
          (input.period==="manha"?Number(s.startsAtLocal.slice(11,13))<12
          :input.period==="tarde"?Number(s.startsAtLocal.slice(11,13))>=12:true))
        .map(s=>({
          doctor:s.doctor.name,date:input.date,time:s.startsAtLocal.slice(11,16),
          start:s.startsAt,end:s.endsAt,slotId:s.id,
        }));
      response.status(200).json({ok:true,availability:{
        available:available.length>0,slots:available.slice(0,60),
        message:available.length?"Horários da agenda nativa CEDIPI":"Sem horários livres",
      }});
    }catch{
      response.status(503).json({ok:false,error:"native_availability_unavailable"});
    }
  };
}
