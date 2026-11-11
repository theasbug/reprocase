import type { AgentTool, AgentToolOutput, ChatMessage, ProviderProfile, TokenUsage } from '@reprocase/core';
import type { ProviderRegistry } from './providers.ts';
import { sse } from './chat.ts';
export interface AgentCall { id:string;name:string;arguments:string; }
export interface AgentRound { text:string;reasoning:string;calls:AgentCall[];wire:any[];usage?:TokenUsage;generationMs:number; }
export function agentHistory(profile:ProviderProfile,messages:ChatMessage[],system:string):any[]{
  const rawTurns=messages.filter(m=>m.status==='complete'&&(m.content.trim()||m.attachments?.length||m.activities?.length)).map(m=>({role:m.role,content:m.content+(m.attachments?.length?'\n\nAttached context:\n'+m.attachments.map(f=>`--- ${f.name} ---\n${f.content}`).join('\n\n'):'')+(m.activities?.length?'\n\nRecorded actions:\n'+m.activities.map(t=>`${t.name}: ${t.status}\n${t.output??''}`).join('\n'): '')}));
  const turns:any[]=[];
  for(const turn of rawTurns){
    const prev=turns.at(-1);
    if(prev&&prev.role===turn.role&&typeof prev.content==='string'&&typeof turn.content==='string'){
      prev.content+='\n\n'+turn.content;
    }else{
      turns.push(turn);
    }
  }
  return profile.protocol==='anthropic'?turns:[{role:'system',content:system},...turns];
}
function usage(value:any,current?:TokenUsage):TokenUsage|undefined{if(!value)return current;const finite=(...items:any[])=>items.find(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0);const input=finite(value.input_tokens,value.prompt_tokens,current?.input),output=finite(value.output_tokens,value.completion_tokens,current?.output),reasoning=finite(value.output_tokens_details?.reasoning_tokens,value.completion_tokens_details?.reasoning_tokens,current?.reasoning);return {source:'provider',...(input===undefined?{}:{input}),...(output===undefined?{}:{output}),...(reasoning===undefined?{}:{reasoning}),...(input!==undefined&&output!==undefined?{total:input+output}:{})};}
export function providerError(error:unknown){const e=error as any;if(e?.name==='AbortError')return new Error('Request cancelled');if(e?.name==='TimeoutError')return new Error('The provider request timed out. No request was retried.');const code=e?.cause?.code??e?.code;if(e?.message==='fetch failed'||e?.message==='Failed to fetch')return new Error(`Provider connection failed${code?' ('+code+')':''}. Check connectivity, proxy and certificate settings. No generation request was retried.`);return error instanceof Error?error:new Error(String(error));}
export async function agentRound(registry:ProviderRegistry,profile:ProviderProfile,model:string,reasoning:string,sessionId:string,system:string,history:any[],tools:AgentTool[],signal:AbortSignal,onDelta:(text:string,reasoning:string)=>void,fetcher:typeof fetch=fetch):Promise<AgentRound>{
  const started=Date.now();let path:string,body:any;
  if(profile.protocol==='anthropic'){path='/messages';body={model,system,messages:history,max_tokens:16384,stream:true,...(tools.length?{tools:tools.map(t=>({name:t.name,description:t.description,input_schema:t.inputSchema})),tool_choice:{type:'auto'}}:{}),...(reasoning==='auto'?{}:{output_config:{effort:reasoning}})};}
  else if(profile.protocol==='responses'){path='/responses';body={model,input:history,stream:true,store:false,max_output_tokens:16384,...(tools.length?{tools:tools.map(t=>({type:'function',name:t.name,description:t.description,parameters:t.inputSchema,strict:false})),parallel_tool_calls:false}:{}),...(reasoning!=='auto'?{reasoning:{effort:reasoning,summary:'auto'}}:profile.models.find(m=>m.id===model)?.efforts.length?{reasoning:{summary:'auto'}}:{})};}
  else{path='/chat/completions';body={model,messages:history,stream:true,...(tools.length?{tools:tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}})),parallel_tool_calls:false}:{}),...(['opencode-go','opencode-zen','deepseek','openrouter','groq','gemini'].includes(profile.providerId)?{stream_options:{include_usage:true}}:{}),...(reasoning==='auto'?{}:profile.providerId==='openrouter'?{reasoning:{effort:reasoning}}:{reasoning_effort:reasoning})};}
  let response:Response;try{response=await fetcher(profile.baseURL+path,{method:'POST',headers:registry.headers(profile,sessionId),body:JSON.stringify(body),redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(240000)])});}catch(e){throw providerError(e);}
  if(!response.ok)throw new Error(`Provider request failed (${response.status}): ${(await response.text()).slice(0,2000)}`);
  if(!(response.headers.get('content-type')??'').includes('text/event-stream'))throw new Error('The provider did not return an SSE stream. Check the selected API protocol.');
  let text='',thinking='',completed=false,reported:TokenUsage|undefined;const calls=new Map<number,AgentCall>(),wire:any[]=[],blocks=new Map<number,any>();
  for await(const event of sse(response)){
    if(signal.aborted)throw new Error('Request cancelled');
    if(event.error||event.type==='error'||event.type==='response.failed')throw new Error(event.error?.message??event.response?.error?.message??'Provider stream error');
    reported=usage(event.usage??event.response?.usage??event.message?.usage,reported);
    if(profile.protocol==='responses'){
      if(event.type==='response.output_text.delta'||event.type==='response.refusal.delta')text+=event.delta??'';
      if(event.type==='response.reasoning_summary_text.delta'||event.type==='response.reasoning_text.delta')thinking+=event.delta??'';
      if(event.type==='response.output_item.done'){wire.push(event.item);if(event.item.type==='function_call')calls.set(event.output_index??calls.size,{id:event.item.call_id,name:event.item.name,arguments:event.item.arguments});}
      if(event.type==='response.completed')completed=true;
      if(event.type==='response.incomplete')throw new Error('The provider reached an output limit before completing its response');
    }else if(profile.protocol==='anthropic'){
      if(event.type==='content_block_start'){blocks.set(event.index,structuredClone(event.content_block));if(event.content_block.type==='text')text+=event.content_block.text??'';}
      if(event.type==='content_block_delta'){const block=blocks.get(event.index),delta=event.delta;if(delta.type==='text_delta'){text+=delta.text;block.text=(block.text??'')+delta.text;}if(delta.type==='thinking_delta'){thinking+=delta.thinking;block.thinking=(block.thinking??'')+delta.thinking;}if(delta.type==='signature_delta')block.signature=(block.signature??'')+delta.signature;if(delta.type==='input_json_delta')block._json=(block._json??'')+delta.partial_json;}
      if(event.type==='message_stop')completed=true;
      if(event.type==='message_delta'&&event.delta?.stop_reason==='max_tokens')throw new Error('The provider reached its output token limit');
    }else{
      const choice=event.choices?.[0],delta=choice?.delta;
      if(typeof delta?.content==='string')text+=delta.content;
      if(typeof delta?.reasoning_content==='string')thinking+=delta.reasoning_content;else if(typeof delta?.reasoning==='string')thinking+=delta.reasoning;
      if(Array.isArray(delta?.reasoning_details))for(const item of delta.reasoning_details)if(item.type==='reasoning.text'&&typeof item.text==='string')thinking+=item.text;
      for(const item of delta?.tool_calls??[]){
        const at=item.index??0,call=calls.get(at)??{id:'',name:'',arguments:''};
        if(item.id&&!call.id)call.id=item.id;
        if(item.function?.name){
          if(!call.name)call.name=item.function.name;
          else if(!call.name.endsWith(item.function.name))call.name+=item.function.name;
        }
        call.arguments+=item.function?.arguments??'';
        calls.set(at,call);
      }
      if(choice?.finish_reason)completed=true;if(choice?.finish_reason==='length')throw new Error('The provider reached its output token limit');
    }
    if(text.length+thinking.length>700000)throw new Error('The provider response exceeded this session’s limit');
    onDelta(text,thinking);
  }
  if(!completed)throw new Error('The provider connection ended before its completion event. Partial output was kept; no request was retried.');
  if(profile.protocol==='anthropic'){for(const block of blocks.values()){if(block.type==='tool_use'){calls.set(calls.size,{id:block.id,name:block.name,arguments:block._json??JSON.stringify(block.input??{})});if(block._json)block.input=JSON.parse(block._json);delete block._json;}wire.push(block);}}
  if(!text.trim()&&!calls.size&&thinking.trim())text=thinking;
  if(!text.trim()&&!calls.size)throw new Error('The model completed without visible text or a tool call');
  return {text,reasoning:thinking,calls:[...calls.values()],wire,usage:reported,generationMs:Date.now()-started};
}
export function appendAgentRound(profile:ProviderProfile,history:any[],round:AgentRound){
  if(profile.protocol==='responses')history.push(...round.wire);
  else if(profile.protocol==='anthropic')history.push({role:'assistant',content:round.wire});
  else history.push({role:'assistant',content:round.text||(round.calls.length?null:''),...(round.reasoning&&profile.providerId==='deepseek'?{reasoning_content:round.reasoning}:{}),...(round.calls.length?{tool_calls:round.calls.map(c=>({id:c.id,type:'function',function:{name:c.name,arguments:c.arguments}}))}:{})});
}
export function appendAgentResult(profile:ProviderProfile,history:any[],call:AgentCall,result:AgentToolOutput,vision:boolean){
  const images=vision?result.images??[]:[];const text=result.text+(!vision&&result.images?.length?'\nAn image was captured; this model does not advertise image input. Its evidence is available in the UI.':'');
  if(profile.protocol==='responses'){history.push({type:'function_call_output',call_id:call.id,output:text});if(images.length)history.push({role:'user',content:[{type:'input_text',text:'Screenshot returned by '+call.name},...images.map(i=>({type:'input_image',image_url:`data:${i.mimeType};base64,${i.data}`,detail:'auto'}))]});}
  else if(profile.protocol==='anthropic'){
    const block={type:'tool_result',tool_use_id:call.id,content:[{type:'text',text},...images.map(i=>({type:'image',source:{type:'base64',media_type:i.mimeType,data:i.data}}))]};
    const prev=history.at(-1);
    if(prev&&prev.role==='user'&&Array.isArray(prev.content))prev.content.push(block);
    else history.push({role:'user',content:[block]});
  }
  else{history.push({role:'tool',tool_call_id:call.id,content:text});if(images.length)history.push({role:'user',content:[{type:'text',text:'Screenshot returned by '+call.name},...images.map(i=>({type:'image_url',image_url:{url:`data:${i.mimeType};base64,${i.data}`}}))]});}
}
