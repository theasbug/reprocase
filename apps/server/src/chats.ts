import { randomUUID } from 'node:crypto';
import { chatInputSchema,createRedactor,type ChatSession,type ChatMessage,type AgentRuntime,type AgentToolOutput,type ToolActivity,type TokenUsage } from '@reprocase/core';
import { agentHistory,agentRound,appendAgentResult,appendAgentRound,providerError } from '../../../packages/ai/src/agent.ts';
import type { ProviderRegistry } from '../../../packages/ai/src/providers.ts';
import type { Store } from './store.ts';
type Active={chat:ChatSession;controller:AbortController;task:Promise<void>;queue:ChatMessage[];profileId:string;modelId:string};
export class ChatService {
  private pending=new Map<string,Active>();
  constructor(private store:Store,private providers:ProviderRegistry,private secrets:()=>string[],private caseContext:(id:string)=>unknown,private fetcher?:typeof fetch,private agent?:{runtime:AgentRuntime;prompt:()=>string}){}
  recover(){for(const chat of this.store.chats()){let changed=false;for(const m of chat.messages)if(m.status==='streaming'||m.status==='queued'){m.status='error';m.error='The app closed before this step finished. It was not sent again automatically.';for(const a of m.activities??[])if(a.status==='running'||a.status==='approval'){a.status='cancelled';a.finishedAt=new Date().toISOString();}changed=true;}if(changed)this.store.saveChat(chat);}}
  list(){return this.store.chats().map(({messages,...chat})=>{const live=this.pending.get(chat.id)?.chat;const msgs=live?.messages??messages;return {...chat,title:live?.title??chat.title,updatedAt:live?.updatedAt??chat.updatedAt,messageCount:msgs.length,pending:this.pending.has(chat.id),queued:msgs.filter(m=>m.status==='queued').length};});}
  get(id:string){const active=this.pending.get(id);if(active)return active.chat;const chat=this.store.getChat(id);if(!chat)throw Object.assign(new Error('Chat session not found'),{statusCode:404});return chat;}
  create(){const now=new Date().toISOString();const chat:ChatSession={id:`chat-${randomUUID()}`,title:'New session',createdAt:now,updatedAt:now,reasoning:'auto',messages:[]};this.store.saveChat(chat);return chat;}
  remove(id:string){this.get(id);if(this.pending.has(id))throw new Error('Stop this session before deleting it');this.agent?.runtime.steer?.(id);this.store.deleteChat(id);}
  rename(id:string,title:string){const chat=this.get(id);if(this.pending.has(id))throw new Error('Wait for the current action before renaming');chat.title=createRedactor([...this.secrets(),...this.providers.knownSecrets()]).text(title.trim()).slice(0,100)||'New session';this.store.saveChat(chat);return chat;}
  cancel(id:string){this.get(id);const active=this.pending.get(id);if(active){for(const m of active.queue)m.status='cancelled';active.queue=[];active.controller.abort();this.agent?.runtime.steer?.(id);}return this.get(id);}
  cancelAll(){for(const id of this.pending.keys())this.cancel(id);}
  send(id:string,input:unknown){
    const value=chatInputSchema.parse(input),active=this.pending.get(id),chat=active?.chat??this.get(id);
    const effectiveProfileId=active?.profileId??value.profileId,effectiveModelId=active?.modelId??value.modelId;
    const profile=this.providers.get(effectiveProfileId),model=profile.models.find(m=>m.id===effectiveModelId);
    if(!model)throw new Error('Select a discovered model');if(value.reasoning!=='auto'&&!model.efforts.includes(value.reasoning))throw new Error('This model does not advertise the selected reasoning effort');if(!profile.hasKey&&profile.providerId!=='custom')throw new Error('Reconnect this provider with its API key');
    const redactor=createRedactor([...this.secrets(),...this.providers.knownSecrets()]);
    const attachments=value.attachments.map(f=>({name:redactor.text(f.name),content:redactor.text(f.content)}));if(value.caseId)attachments.push({name:`case-${value.caseId}.json`,content:redactor.text(JSON.stringify(this.caseContext(value.caseId),null,2))});
    if(chat.messages.length>=200||attachments.reduce((n,f)=>n+f.content.length,0)+chat.messages.reduce((n,m)=>n+m.content.length+(m.attachments?.reduce((n,f)=>n+f.content.length,0)??0),0)>800000)throw new Error('This conversation is too large. Start a new session or use a smaller attachment.');
    const now=new Date().toISOString(),user:ChatMessage={id:`message-${randomUUID()}`,role:'user',content:redactor.text(value.content),createdAt:now,status:active?'queued':'complete',...(attachments.length?{attachments}:{})};
    if(active){
      if(active.queue.length>=10)throw new Error('Ten follow-up messages are already queued');
      active.queue.push(user);chat.messages.push(user);chat.updatedAt=now;this.store.saveChat(chat);this.agent?.runtime.steer?.(id);return chat;
    }
    if(!chat.messages.length)chat.title=user.content.slice(0,65)||attachments[0]?.name||'New session';chat.messages.push(user);chat.profileId=profile.id;chat.modelId=model.id;chat.reasoning=value.reasoning;chat.updatedAt=now;
    const controller=new AbortController(),run:Active={chat,controller,task:Promise.resolve(),queue:[],profileId:profile.id,modelId:model.id};this.pending.set(id,run);
    let reply=this.reply(model.id,profile.id,value.reasoning);chat.messages.push(reply);this.store.saveChat(chat);
    const task=(async()=>{
      const system=(this.agent?.prompt()??'You are ReproCase AI Assistant, a helpful desktop research partner.')+'\n\nActual environment:\n'+JSON.stringify(this.agent?.runtime.environment()??{desktop:false,tools:[]},null,2);
      const history=agentHistory(profile,chat.messages.slice(0,-1),system);let lastSaved=0;
      const save=()=>{chat.updatedAt=new Date().toISOString();this.store.saveChat(chat);lastSaved=Date.now();};
      const finish=()=>{reply.elapsedMs=Date.now()-Date.parse(reply.createdAt);if(reply.usage?.output!==undefined&&reply.generationMs)reply.tokensPerSecond=reply.usage.output/(reply.generationMs/1000);};
      const safe=(text:string,final=false)=>{const r=createRedactor([...this.secrets(),...this.providers.knownSecrets()]).text(text);const hold=Math.max(0,...[...this.secrets(),...this.providers.knownSecrets()].map(k=>k.length));return final?r:r.slice(0,Math.max(0,r.length-hold));};
      const pushUserToHistory=(m:ChatMessage)=>{
        const item=agentHistory(profile,[m],'');
        const userTurn=profile.protocol==='anthropic'?item[0]:item[1];
        if(!userTurn)return;
        if(profile.protocol==='anthropic'){
          const prev=history.at(-1);
          if(prev&&prev.role==='user'){
            if(Array.isArray(prev.content))prev.content.push({type:'text',text:String(userTurn.content)});
            else prev.content=String(prev.content)+'\n\n'+String(userTurn.content);
            return;
          }
        }else if(profile.protocol==='chat'){
          const prev=history.at(-1);
          if(prev&&prev.role==='tool'){
            history.push({role:'assistant',content:'Tool step concluded. Incorporating the new user message.'});
          }else if(prev&&prev.role==='user'&&typeof prev.content==='string'){
            prev.content+='\n\n'+String(userTurn.content);
            return;
          }
        }
        history.push(userTurn);
      };
      const consume=()=>{
        if(!run.queue.length)return false;
        const isEmpty=!reply.content.trim()&&!reply.reasoningText?.trim()&&!(reply.activities?.length);
        if(isEmpty){
          const idx=chat.messages.indexOf(reply);
          if(idx!==-1)chat.messages.splice(idx,1);
        }else{
          reply.status='complete';
          finish();
        }
        const queued=run.queue.splice(0);
        for(const m of queued){
          m.status='complete';
          pushUserToHistory(m);
        }
        reply=this.reply(model.id,profile.id,value.reasoning);
        chat.messages.push(reply);
        save();
        return true;
      };
      for(let step=0;step<40;step++){
        if(controller.signal.aborted)throw new Error('Action cancelled');consume();const prefix=reply.content,thoughtPrefix=reply.reasoningText??'';
        const round=await agentRound(this.providers,profile,model.id,value.reasoning,id,system,history,this.agent?.runtime.tools()??[],controller.signal,(text,thought)=>{reply.content=prefix+safe(text);reply.reasoningText=thoughtPrefix+safe(thought);if(Date.now()-lastSaved>100)save();},this.fetcher);
        reply.content=prefix+safe(round.text,true)+(round.text?'\n\n':'');reply.reasoningText=thoughtPrefix+safe(round.reasoning,true)+(round.reasoning?'\n\n':'');reply.generationMs=(reply.generationMs??0)+round.generationMs;
        if(round.usage){reply.usage??={source:'provider'};for(const key of ['input','output','reasoning','total'] as const)if(round.usage[key]!==undefined)reply.usage[key]=(reply.usage[key]??0)+round.usage[key]!;}
        finish();appendAgentRound(profile,history,round);save();
        for(const call of round.calls){
          if(run.queue.length){appendAgentResult(profile,history,call,{text:'Skipped: a new user instruction arrived. Replan using the latest message.'},!!model.supportsVision);continue;}
          if(controller.signal.aborted)throw new Error('Action cancelled');
          let input:unknown;try{input=JSON.parse(call.arguments);}catch{appendAgentResult(profile,history,call,{text:'Invalid tool arguments: provide valid JSON.'},!!model.supportsVision);continue;}
          const activity:ToolActivity={id:call.id||`tool-${randomUUID()}`,name:call.name,input:JSON.parse(safe(JSON.stringify(input),true)),status:'running',startedAt:new Date().toISOString()};reply.activities??=[];reply.activities.push(activity);save();
          let result:AgentToolOutput;
          try{if(!this.agent)throw new Error('No tools are attached to this runtime');const executed=await this.agent.runtime.execute(call.name,input,id,controller.signal,a=>{activity.status='approval';activity.approvalId=a.id;save();});result=typeof executed==='string'?{text:executed}:executed;result.text=safe(result.text,true);activity.status='completed';activity.output=result.text.slice(0,50000);activity.evidenceIds=result.images?.map(i=>i.evidenceId).filter((id):id is string=>!!id);}catch(e){result={text:safe(e instanceof Error?e.message:String(e),true)};activity.status=(e as any)?.steered||controller.signal.aborted?'cancelled':'error';activity.output=result.text;}activity.finishedAt=new Date().toISOString();activity.approvalId=undefined;appendAgentResult(profile,history,call,result,!!model.supportsVision);save();
        }
        if(consume())continue;
        if(!round.calls.length){
          if(consume())continue;
          reply.status='complete';reply.content=reply.content.trimEnd();finish();this.pending.delete(id);save();return;
        }
      }
      throw new Error('This run reached 40 agent steps. Its observations are saved; send a follow-up to continue.');
    })().catch(error=>{reply.status=controller.signal.aborted?'cancelled':'error';reply.error=createRedactor([...this.secrets(),...this.providers.knownSecrets()]).text(controller.signal.aborted?'Stopped. No request was retried.':providerError(error).message);reply.elapsedMs=Date.now()-Date.parse(reply.createdAt);for(const m of run.queue){m.status=controller.signal.aborted?'cancelled':'error';m.error='The preceding task ended before this message was delivered. Send it again to continue.';}run.queue=[];}).finally(()=>{chat.updatedAt=new Date().toISOString();this.store.saveChat(chat);this.pending.delete(id);});
    run.task=task;return chat;
  }
  private reply(modelId:string,providerId:string,reasoning:string):ChatMessage{return {id:`message-${randomUUID()}`,role:'assistant',content:'',createdAt:new Date().toISOString(),status:'streaming',modelId,providerId,reasoning,activities:[]};}
  async close(){this.cancelAll();await Promise.allSettled([...this.pending.values()].map(a=>a.task));}
}
