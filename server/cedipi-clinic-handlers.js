import {
  listClinicCatalogOverview, listPendingBookingRequests,
} from "./cedipi-clinic-repository.js";

export function createListOfficialCatalogHandler(list = listClinicCatalogOverview) {
  return async (_req,res)=>{
    try {
      res.status(200).json({ok:true,...await list()});
    } catch {
      res.status(503).json({ok:false,error:"official_catalog_unavailable"});
    }
  };
}

export function createListBookingRequestsHandler(list = listPendingBookingRequests) {
  return async (_req,res)=>{
    try {
      res.status(200).json({ok:true,requests:await list()});
    } catch {
      res.status(503).json({ok:false,error:"booking_requests_unavailable"});
    }
  };
}

export function createLaraReadinessHandler(overview = listClinicCatalogOverview) {
  return async (_req,res)=>{
    try {
      const summary=await overview();
      const googleCreds=Boolean(process.env.CEDIPI_GOOGLE_CLIENT_ID &&
        process.env.CEDIPI_GOOGLE_CLIENT_SECRET &&
        process.env.CEDIPI_GOOGLE_REFRESH_TOKEN);
      const openaiConfigured=Boolean(process.env.OPENAI_API_KEY);
      const officialCount=summary.exams.length;
      res.status(200).json({ok:true,readiness:{
        officialDocuments:summary.documents.length,
        officialExams:officialCount,
        schedulesConfigured:summary.doctors.filter(x=>x.active).length,
        openaiConfigured,googleCalendarConfigured:googleCreds,
        bookingAutoConfirmationAvailable:false,
        whatsappTestMode:process.env.LARA_TEST_MODE==="true",
        nativeCutover:process.env.LARA_OUTBOUND_ENABLED==="true"
          &&process.env.LARA_CUTOVER_CONFIRMED==="true"
          &&process.env.CEDIPI_AI_CONTROL_BACKEND==="database",
        status:officialCount===47?"catalog_loaded":"catalog_incomplete",
      }});
    } catch {
      res.status(503).json({ok:false,error:"lara_readiness_unavailable"});
    }
  };
}
