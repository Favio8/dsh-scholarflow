// Opt-in diagnostics in an isolated verification process. Never records tokens,
// header values, request/response bodies, URL queries or full exception messages.
import {appendFile} from 'node:fs/promises'
const original=globalThis.fetch,path=process.env.SF_NETWORK_DIAGNOSTICS
if(path)globalThis.fetch=async function(...args){
  const url=new URL(typeof args[0]==='string'||args[0] instanceof URL?args[0]:args[0].url)
  if(!['api.deepseek.com','platform.deepseek.com'].includes(url.hostname))return Reflect.apply(original,this,args)
  const facts={host:url.hostname,path:url.pathname,method:args[1]?.method??'GET',at:new Date().toISOString()}
  try{const response=await Reflect.apply(original,this,args);await appendFile(path,JSON.stringify({...facts,status:response.status})+'\n');return response}
  catch(error){await appendFile(path,JSON.stringify({...facts,name:error.name,code:error.cause?.code,nestedCodes:error.cause?.errors?.map(row=>row.code)})+'\n');throw error}
}
