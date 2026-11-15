import { readLaraWebhookSecret } from "./lara-webhook-secret.js";

export class LaraWebhookConfigError extends Error {
  constructor(code) { super(code);this.name="LaraWebhookConfigError";this.code=code; }
}

export function createLaraEvolutionWebhook({
  baseUrl=process.env.EVOLUTION_API_URL,
  apiKey=process.env.EVOLUTION_API_KEY,
  instance=process.env.EVOLUTION_INSTANCE_NAME??"Cedipi",
  target=process.env.LARA_WEBHOOK_TARGET_URL,
  secret=readLaraWebhookSecret(),
  fetchImpl=fetch,
}={}) {
  if (!baseUrl||!apiKey||instance!=="Cedipi"||!target||!secret)
    throw new LaraWebhookConfigError("webhook_config_missing");
  const api=baseUrl.replace(/\/$/,"");
  const destination=new URL(target);
  if(destination.protocol!=="https:" ||
    destination.pathname!=="/api/webhooks/evolution/lara")
    throw new LaraWebhookConfigError("webhook_invalid_target");

  async function request(route,{method="GET",payload}={}) {
    let response;
    try {
      response=await fetchImpl(api+route,{
        method,
        headers:{apikey:apiKey,...(payload===undefined?{}:{"content-type":"application/json"})},
        body:payload===undefined?undefined:JSON.stringify(payload),
        signal:AbortSignal.timeout(12000),
      });
    } catch {
      throw new LaraWebhookConfigError("evolution_webhook_unreachable");
    }
    if(!response.ok)throw new LaraWebhookConfigError("evolution_webhook_http_"+response.status);
    try{return await response.json()}catch {
      throw new LaraWebhookConfigError("evolution_webhook_invalid_json");
    }
  }

  async function find() {
    const data=await request("/webhook/find/"+instance);
    return data.webhook??data;
  }

  function isNative(setting) {
    const url=setting?.url;
    const configuredHeader=Object.entries(setting?.headers??{})
      .find(([name])=>name.toLowerCase()==="x-cedipi-webhook-secret")?.[1];
    return setting?.enabled===true && url===target &&
      configuredHeader===secret &&
      Array.isArray(setting?.events) && setting.events.includes("MESSAGES_UPSERT");
  }

  async function setNative() {
    const payload={
      enabled:true,url:target,webhookByEvents:false,webhookBase64:false,
      events:["MESSAGES_UPSERT"],
      headers:{"x-cedipi-webhook-secret":secret},
    };
    try {
      await request("/webhook/set/"+instance,{method:"POST",payload});
    } catch (error) {
      // Evolution v2 installations may use /event/webhook/set with a nested
      // object; fail closed if neither documented representation is accepted.
      if(!["evolution_webhook_http_404","evolution_webhook_http_400"].includes(error.code))
        throw error;
      await request("/event/webhook/set/"+instance,{
        method:"POST",
        payload:{webhook:{enabled:true,url:target,byEvents:false,
          base64:false,events:["MESSAGES_UPSERT"],
          headers:{"x-cedipi-webhook-secret":secret}}},
      });
    }
    const current=await find();
    if(!isNative(current))throw new LaraWebhookConfigError("webhook_cutover_not_persisted");
    return true;
  }

  async function assertNative() {
    const config=await find();
    if(!isNative(config))throw new LaraWebhookConfigError("webhook_not_native");
    return true;
  }

  async function repairOnce() {
    const current=await find();
    if(isNative(current))return {healthy:true,repaired:false};
    await setNative();
    return {healthy:true,repaired:true};
  }

  return {find,isNative,setNative,assertNative,repairOnce};
}
