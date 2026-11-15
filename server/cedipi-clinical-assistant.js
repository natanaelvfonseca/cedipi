import { readOpenAiApiKey } from "./openai-credentials.js";
import { reserveNativeClinicAppointment, NativeCalendarError } from "./native-calendar.js";
import {
  listOfficialExams, readLaraSession, saveLaraSession,
  listProposedExamTimes, createBookingRequest, readOfficialDocument,
} from "./cedipi-clinic-repository.js";
import { identifyLaraIntent } from "./lara-response.js";

const fmtPrice = (cents) =>
  new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(cents/100);
const dateTime = new Intl.DateTimeFormat("pt-BR",{
  timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",
});
const localDay = new Intl.DateTimeFormat("sv-SE",{
  timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit",
});
const clean = text=>String(text??"").normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").toLowerCase()
  .replace(/abdomen/g,"abdome").replace(/ultrassonografia/g,"ultrassom")
  .replace(/biopsia por agulha grossa/g,"core biopsy")
  .replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
const ignore=new Set([
  "quero","gostaria","preciso","pode","poderia","me","um","uma","de","da","do",
  "das","dos","que","para","por","favor","com","e","o","a","em","no","na",
  "preco","valor","quanto","custa","saber","qual","quais","exame","fazer",
  "agendar","marcar","agenda","horario","horarios","ultrassom","ultrasom",
  "tenho","sobre","informacoes","informacao","preparo","preparacao",
  "sua","meu","meus","ola","oi","bom","dia","boa","tarde","noite",
  "duracao","quanto","tempo","demora","demoram","minuto","minutos",
  "leva","levam","necessario","necessaria","necessarios","necessarias",
  "onde","pelo","pela","esse","essa","esses","essas","deste","desse",
  "desse","exames","procedimento","procedimentos","informar","informe",
  "realizar","realizado","realizada"
]);
const tokens = text => clean(text).split(" ").filter(w=>
  w && !ignore.has(w)
).map(w=>w.length>4 && w.endsWith("s")?w.slice(0,-1):w);
const contains=(hay,needle)=>needle.every(w=>hay.includes(w));

export function findOfficialExamMatches(text,exams) {
  const words=tokens(text);
  if (!words.length) return [];
  let matches=exams.filter(exam=>{
    const name=tokens(exam.name);
    return contains(name,words) || (words.length>=2 &&
      words.filter(w=>name.includes(w)).length/words.length>=0.9);
  });
  const normalized=clean(text);
  if (!normalized.includes("doppler")) {
    const unmodified=matches.filter(e=>!clean(e.name).includes("doppler"));
    if(unmodified.length) matches=unmodified;
  }
  if (!normalized.includes("gemelar") && !normalized.includes("gemeo")) {
    const ordinary=matches.filter(e=>!clean(e.name).includes("gemelar"));
    if(ordinary.length)matches=ordinary;
  }
  if (!normalized.includes("paaf") && !normalized.includes("puncao") &&
    !normalized.includes("core") && !normalized.includes("biopsia")) {
    const ultrasound=matches.filter(e=>e.category==="ultrasound");
    if (ultrasound.length) matches=ultrasound;
  }
  return matches.slice(0,6);
}

function parseDay(text,now=new Date()) {
  const today=localDay.format(now);
  const normalized=clean(text);
  let day=null;
  if (/\bamanha\b/.test(normalized)) {
    day=new Date(Date.parse(today+"T12:00:00Z")+86400000).toISOString().slice(0,10);
  } else if (/\bhoje\b/.test(normalized)) {
    day=today;
  } else {
    const m=text.match(/(?:^|\D)(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?:\D|$)/);
    if (m) {
      const baseYear=Number(today.slice(0,4));
      let year=Number(m[3]??baseYear);
      const candidate=y=>String(y).padStart(4,"0")+"-"
        +m[2].padStart(2,"0")+"-"+m[1].padStart(2,"0");
      day=candidate(year);
      if(!m[3] && day<today)day=candidate(++year);
    } else {
      const iso=text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
      if(iso)day=iso[1];
    }
  }
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d=new Date(day+"T12:00:00Z");
  if(Number.isNaN(d.getTime()) || d.toISOString().slice(0,10)!==day) return null;
  const diff=(Date.parse(day+"T12:00:00Z")-Date.parse(today+"T12:00:00Z"))/86400000;
  return diff>=0 && diff<=45?day:null;
}

function formatSlot(option) {
  return dateTime.format(new Date(option.start))+" ("+option.doctor+")";
}
function candidateText(options,day) {
  const date=day.slice(8,10)+"/"+day.slice(5,7)+"/"+day.slice(0,4);
  return "Para "+date+", estes são os *horários disponíveis na agenda CEDIPI* "
    + "(a reserva será feita após sua confirmação):\n"
    + options.map((op,i)=>(i+1)+". "+formatSlot(op)).join("\n")
    + "\nResponda com o número do horário que prefere.";
}
function examOverview(e) {
  let lines=["*"+e.name+"*",
    "Valor: "+fmtPrice(e.price_cents),
    "Duração: "+(e.duration_minutes==null?"a confirmar com a recepção":e.duration_minutes+" minutos"),
    "Médico(s): "+e.doctor_names.map(n=>"Dr. "+n).join(" ou "),
  ];
  if(e.medical_approval)lines.push("Procedimento sujeito à aprovação médica antes da confirmação.");
  if(e.add_on_only)lines.push("Exame complementar realizado junto do obstétrico; confirmar combinação com a recepção.");
  if(e.notes)lines.push("Observação: "+e.notes);
  if(e.price_cents>=40000)lines.push("Após validação do horário, a clínica solicita adiantamento de 20% ("+fmtPrice(Math.round(e.price_cents*.2))+"), abatido no exame. A recepção confere o comprovante.");
  return lines.join("\n").slice(0,1150);
}
const STAFF="Não encontrei essa informação com segurança na minha base. Vou te encaminhar para uma atendente da clínica para confirmar certinho, tudo bem?";
const MEDS="Como envolve uso de medicamentos ou um preparo especial, vou te encaminhar para a equipe da clínica confirmar a orientação correta com segurança.";
const BIOPSY="Esse procedimento precisa passar por validação da equipe médica antes da confirmação final. Posso registrar a solicitação de horário e encaminhar à equipe.";
const HOLD="Sua solicitação de horário foi registrada, mas *ainda não é um agendamento confirmado*. A recepção verificará a agenda médica e entrará em contato para concluir.";
const reply=(text,handoffReason=null)=>({text,handoffReason});

export function createCedipiClinicalAssistant({
  repo={
    listOfficialExams,readLaraSession,saveLaraSession,listProposedExamTimes,
    createBookingRequest,readOfficialDocument,
  },
  nativeBooking = reserveNativeClinicAppointment,
  nativeEnabled = process.env.CEDIPI_APPOINTMENTS_BACKEND === "native",
  now=()=>new Date(),
  modelConfigured=Boolean(readOpenAiApiKey()),
}={}) {
  // The prescription is part of the WhatsApp conversation, not a separate
  // menu/action. Never create a booking from an unverified LLM extraction:
  // resolve its names against the official CEDIPI catalog and ask the patient
  // for a date, or to choose between multiple exams. Booking remains atomic
  // and requires explicit patient confirmation in answer().
  async function handleMedicalOrder({phone,examNames}) {
    const official=await repo.listOfficialExams();
    const choices=[];
    const unresolved=[];
    for(const name of examNames.slice(0,8)) {
      if(typeof name!=="string"||name.length>160)continue;
      const exact=official.filter(e=>clean(e.name)===clean(name));
      const candidates=exact.length?exact:findOfficialExamMatches(name,official);
      if(candidates.length===1) {
        const exam=candidates[0];
        if(!choices.some(ch=>ch.code===exam.code))choices.push(exam);
      } else if(candidates.length>1) {
        // Do not silently choose Doppler, gestational subtype, biopsies, etc.
        for(const e of candidates.slice(0,4)) {
          if(!choices.some(ch=>ch.code===e.code))choices.push(e);
        }
      } else {
        unresolved.push(name);
      }
    }
    if(choices.length===0) {
      await repo.saveLaraSession(phone,{state:"awaiting_exam"});
      return reply("Recebi seu pedido médico, mas não consegui relacionar o exame "
        +"com segurança ao catálogo da CEDIPI. Qual é o nome do exame que "
        +"você deseja agendar? A recepção poderá conferir o documento original.");
    }
    if(choices.length===1 && unresolved.length===0) {
      const selected=choices[0];
      if(selected.add_on_only||!Number.isInteger(selected.duration_minutes)) {
        return reply("Identifiquei *"+selected.name+"* no pedido, mas esse "
          +"procedimento depende de conferência da equipe antes da reserva. "
          +"Vou encaminhar à recepção.","exam_needs_review");
      }
      await repo.saveLaraSession(phone,{
        state:"awaiting_date",exam_code:selected.code,
        source:"medical_order",
      });
      return reply("Recebi seu pedido médico e identifiquei *"+selected.name+"*. "
        +"Na CEDIPI, o valor é "+fmtPrice(selected.price_cents)+"."
        +(selected.medical_approval?" A confirmação exige aprovação médica.":"")
        +" Vamos agendar: *qual data você prefere?* "
        +"Pode responder 'amanhã' ou DD/MM/AAAA.");
    }
    const options=choices.slice(0,6);
    await repo.saveLaraSession(phone,{
      state:"awaiting_exam",
      offered_options:options.map(e=>({code:e.code})),
      source:"medical_order",
    });
    const lines=options.map((e,i)=>
      (i+1)+". "+e.name+" — "+fmtPrice(e.price_cents)).join("\n");
    return reply("Recebi seu pedido médico e identifiquei estes exames no "
      +"catálogo CEDIPI:\n"+lines+"\n"
      +"*Qual deles deseja agendar primeiro?* Responda com o número. "
      +"Depois consultaremos a agenda e concluiremos sua reserva.");
  }

  async function answer({phone,batch}) {
    const raw=batch.map(e=>e.body??e.text??"").join("\n").slice(-3000);
    const message=clean(raw);
    const intent=identifyLaraIntent(raw);
    const exams=await repo.listOfficialExams();
    if(exams.length===0)return null; // Incomplete installation; use existing safe fallback.
    const session=await repo.readLaraSession(phone);
    const current=exams.find(e=>e.code===session.exam_code);
    const medical=/(anticoagulante|aas|afin[a-z]* o sangue|warfarina|apixabana|rivaroxabana|medicamento|remedio|phosfoenema|laxante|macrogol|endometriose|preparo intestinal)/.test(message);
    if (intent==="urgent") return reply("Se você está em situação de emergência, procure atendimento de urgência imediatamente. No Brasil, o SAMU atende pelo 192. A Lara não realiza avaliação médica.","urgent");
    if (intent==="human") return reply("Vou encaminhar sua conversa para a recepção da CEDIPI. Uma atendente continuará seu atendimento.","human");
    if (medical) return reply(MEDS,"medication_or_special_prep");
    if (/\b(encaixe|encaixar)\b/.test(message)) return reply("Para encaixar, preciso te encaminhar para uma atendente verificar diretamente com a agenda da clínica.","scheduling_exception");
    if (/\b(remarcar|desmarcar|cancelar|cancelamento)\b/.test(message)) {
      return reply("Para remarcar ou cancelar, vou encaminhar sua solicitação à recepção, que confirmará o procedimento na agenda médica.","schedule_change");
    }
    if (/\b(comprovante|recibo|imagem recebida|documento recebido|audio recebido)\b/.test(message)) {
      return reply("Recebi sua mensagem. A recepção precisa conferir o comprovante ou o arquivo antes de confirmar qualquer pagamento ou agendamento.","document_review");
    }
    if (/\b(pix|pagamento|cartao|parcelamento|adiantamento)\b/.test(message) &&
        session.state!=="awaiting_confirmation") {
      return reply("Aceitamos dinheiro, Pix e cartão de crédito. Alguns procedimentos permitem até 3 vezes sem juros. Exames a partir de R$ 400 exigem adiantamento de 20%, abatido no valor final. A chave Pix é enviada apenas na etapa de confirmação de um horário verificado.");
    }
    if (session.state==="awaiting_confirmation" && current) {
      if (/^(sim|confirmo|pode|isso|ok|confirmar)$/.test(message)) {
        if (!session.selected_start || !session.selected_doctor_name ||
            !session.patient_name || !session.selected_day) {
          await repo.saveLaraSession(phone,{state:"idle"});
          return reply(STAFF,"booking_missing_details");
        }
        const date=typeof session.selected_day==="string"?
          session.selected_day.slice(0,10):new Date(session.selected_day).toISOString().slice(0,10);
        if (nativeEnabled) {
          let reservation;
          try {
            reservation = await nativeBooking({
              phone,exam:current,date,start:session.selected_start,
              doctor:session.selected_doctor_name,patientName:session.patient_name,
            });
          } catch(error) {
            if (error instanceof NativeCalendarError) {
              if (error.code==="calendar_not_verified") {
                return reply("Para não oferecer um horário já ocupado, preciso "
                  +"encaminhar a confirmação à recepção. Ela verificará a agenda "
                  +"atual dos médicos antes de concluir sua marcação.",
                  "calendar_verification");
              }
              await repo.saveLaraSession(phone,{state:"awaiting_date",exam_code:current.code});
              return reply("Esse horário não está mais disponível na agenda da CEDIPI. "
                + "Informe outra data para consultar novas opções.");
            }
            throw error;
          }
          await repo.saveLaraSession(phone,{state:"idle"});
          const info=current.name+" com Dr. "+reservation.doctor+" às "
            +formatSlot({start:reservation.start,doctor:reservation.doctor})
              .split(" (")[0]+".";
          if(reservation.status==="confirmed") {
            return reply("✅ Agendamento confirmado na agenda CEDIPI: *"+info+"* "
              +"Guarde esta mensagem de confirmação.");
          }
          if(reservation.status==="awaiting_medical_approval") {
            return reply("Pré-reserva registrada na agenda CEDIPI para *"+info+"* "
              +"A confirmação depende de aprovação médica. A recepção dará continuidade "
              +"e orientará sobre o pagamento, quando aplicável.","medical_approval");
          }
          // The payment key is only disclosed AFTER the native database has
          // atomically reserved the chosen, confirmed-by-patient slot.
          const paymentDocument=await repo.readOfficialDocument(5);
          const pixKey=paymentDocument?.match(/(?:CPF:\s*|CPF\s*:?\s*)(\d{3}\.\d{3}\.\d{3}-\d{2})/i)?.[1];
          const holder=paymentDocument?.match(/Nome:\s*([^\n]+)/i)?.[1]?.trim();
          if(!pixKey || !holder) {
            return reply("Pré-reserva registrada na agenda CEDIPI para *"+info+"* "
              +"Para concluir a confirmação, a recepção informará a taxa de 20% "
              +"e os dados Pix oficiais após conferência.","payment_review");
          }
          return reply("✅ Pré-reserva registrada na agenda CEDIPI: *"+info+"* "
            +"Para confirmar, efetue o adiantamento de *"
            +fmtPrice(reservation.depositCents)+"*, abatido do valor final.\n"
            +"Chave Pix (CPF): *"+pixKey+"*\nTitular: *"+holder+"*\n"
            +"Envie o comprovante. A recepção irá verificar o pagamento; "
            +"até essa validação, o exame permanece pré-reservado, sem confirmação final.",
            "payment_review");
        }
        await repo.createBookingRequest({
          phone,exam:current,date,start:session.selected_start,
          doctor:session.selected_doctor_name,patientName:session.patient_name,
          status:current.medical_approval?"awaiting_medical_approval":"needs_verification",
        });
        await repo.saveLaraSession(phone,{state:"idle"});
        return reply(HOLD,current.medical_approval?"medical_approval":"booking_review");
      }
      if (/^(nao|cancelar|desistir)$/.test(message)) {
        await repo.saveLaraSession(phone,{state:"idle"});
        return reply("Sem problemas. Não registrei nenhuma solicitação. Em que posso ajudar?");
      }
      return reply(nativeEnabled
        ?"Posso registrar o agendamento na agenda CEDIPI? Responda *sim* ou *não*. "
          +"Nenhum horário é reservado antes da sua confirmação."
        :"Posso enviar esta solicitação à recepção para conferência? Responda *sim* ou *não*.");
    }

    if (session.state==="awaiting_name" && current) {
      const name=raw.trim().replace(/\s+/g," ");
      if (!/^[\p{L} .'-]{3,110}$/u.test(name) || name.split(" ").length<2) {
        return reply("Por favor, informe seu *nome e sobrenome* para a recepção identificar a solicitação.");
      }
      await repo.saveLaraSession(phone,{
        ...session,state:"awaiting_confirmation",patient_name:name,
      });
      return reply("Entendi, "+name+". Você escolheu *"+current.name+"*, "
        +formatSlot({start:session.selected_start,doctor:session.selected_doctor_name})
        +(nativeEnabled
          ? ". Posso *registrar este agendamento na agenda CEDIPI*? Responda *sim* ou *não*. "
            +"O horário será reservado após sua confirmação. "
            +(current.medical_approval?"Este procedimento também exige aprovação médica. "
              :current.price_cents>=40000
                ?"A confirmação final dependerá da conferência do adiantamento. ":"")
          : ". Posso encaminhar este pedido para a recepção verificar a disponibilidade? "
            +"Responda *sim* ou *não*. O horário ainda não está reservado."));
    }

    if (session.state==="awaiting_slot" && current) {
      const choice=Number(message);
      const offered=Array.isArray(session.offered_options)?session.offered_options:[];
      const option=Number.isInteger(choice)&&choice>0?offered[choice-1]:null;
      if(!option||!option.start||!option.doctor) {
        return reply("Por favor, responda com o número de uma das opções de horário exibidas, ou me diga outra data no formato DD/MM/AAAA.");
      }
      if(new Date(option.start).getTime()<=Date.now()) {
        await repo.saveLaraSession(phone,{state:"awaiting_date",exam_code:current.code});
        return reply("Esse horário já passou. Informe outra data no formato DD/MM/AAAA.");
      }
      await repo.saveLaraSession(phone,{
        state:"awaiting_name",exam_code:current.code,
        selected_day:session.selected_day,selected_start:option.start,
        selected_doctor_name:option.doctor,
      });
      return reply("Opção "+choice+": "+formatSlot(option)+". "
        +"Para continuar o agendamento, qual é seu *nome e sobrenome*?");
    }

    const matches=findOfficialExamMatches(raw,exams);
    if(session.state==="awaiting_exam" && /^\d$/.test(message) &&
      Array.isArray(session.offered_options)) {
      const examCode=session.offered_options[Number(message)-1]?.code;
      const found=exams.find(e=>e.code===examCode);
      if(found) {
        await repo.saveLaraSession(phone,{state:"awaiting_date",exam_code:found.code});
        return reply(examOverview(found)+"\nPara qual *data* deseja solicitar um horário? Informe DD/MM/AAAA.");
      }
    }
    if(matches.length>1) {
      const options=matches.slice(0,4);
      await repo.saveLaraSession(phone,{
        state:"awaiting_exam",offered_options:options.map(e=>({code:e.code})),
      });
      return reply("Para não confundir os exames, qual destas opções você deseja?\n"+
        options.map((e,i)=>(i+1)+". "+e.name+" — "+fmtPrice(e.price_cents)).join("\n")+
        "\nResponda com o número da opção.");
    }
    const selected=matches.length===1?matches[0]:current;
    const booking=/\b(agendar|agendamento|marcar|agenda|horario|horarios|disponibilidade|quero fazer)\b/.test(message)
      || ["awaiting_date","awaiting_exam"].includes(session.state);
    const wantsPrep=/\b(preparo|jejum|bexiga|preparar|preparacao)\b/.test(message);
    if(selected && wantsPrep && !booking) {
      if(selected.doctor_review || !selected.preparation) {
        return reply("O preparo deste procedimento precisa ser conferido com a equipe para sua segurança. Vou encaminhar à recepção.","prep_review");
      }
      return reply("*"+selected.name+"*: "+selected.preparation);
    }
    if(selected && booking) {
      if(selected.add_on_only || selected.duration_minutes==null) {
        return reply("Este exame precisa ser combinado com outro procedimento ou ter a duração confirmada pela equipe. Vou encaminhar à recepção.","exam_needs_review");
      }
      const day=parseDay(raw,now());
      if(!day) {
        await repo.saveLaraSession(phone,{state:"awaiting_date",exam_code:selected.code});
        return reply("Vamos solicitar *"+selected.name+"* ("+fmtPrice(selected.price_cents)+"). Para qual *data* deseja atendimento? Informe DD/MM/AAAA ou 'amanhã'. A disponibilidade será verificada antes da confirmação.");
      }
      const times=await repo.listProposedExamTimes({
        exam:selected,date:day,limit:3,
      });
      if(!times.length) {
        await repo.saveLaraSession(phone,{state:"awaiting_date",exam_code:selected.code});
        return reply("Não encontrei opções preliminares para essa data. Informe outra data ou posso encaminhar para uma atendente verificar encaixe.");
      }
      await repo.saveLaraSession(phone,{
        state:"awaiting_slot",exam_code:selected.code,
        selected_day:day,offered_options:times,
      });
      return reply(candidateText(times,day));
    }
    if(selected) return reply(examOverview(selected)+"\nSe desejar, posso buscar *horários preliminares* para sua solicitação.");
    if(intent==="greeting") return reply(
      "Olá! Sou a Lara, assistente virtual da CEDIPI. 😊 Posso informar valores, preparos e médicos, além de registrar pedidos de agendamento. Qual exame você procura?"
    );
    if (/\b(agendar|agendamento|horario|marcar|exame)\b/.test(message)) {
      await repo.saveLaraSession(phone,{state:"awaiting_exam"});
      return reply("Claro! Qual é o nome do exame que deseja realizar? Se tiver o pedido médico, pode informar o nome do procedimento.");
    }
    if (/\b(danilo|wagner|deison|dias dos medicos|agenda medica)\b/.test(message)) {
      const doc=await repo.readOfficialDocument(1);
      return doc?reply(doc.slice(0,1120)):reply(STAFF,"unknown_information");
    }
    if (/\b(obrigad|valeu|agradec)\b/.test(message)) return reply(
      "Por nada! Estou à disposição para ajudar com os exames da CEDIPI."
    );
    // When an OpenAI key exists, pass non-critical free-form questions through
    // the separately grounded Responses/RAG path. Otherwise fail to human.
    // Deterministic booking/medical/payment rules above always take priority.
    return modelConfigured ? null : reply(STAFF,"unknown_information");
  }
  return { answer, handleMedicalOrder };
}

export { parseDay, examOverview };
