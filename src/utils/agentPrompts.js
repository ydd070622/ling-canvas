const ratios=new Set(['1:1','3:4','4:3','2:3','3:2','4:5','5:4','9:16','16:9','1:2','2:1','9:21','21:9'])
export function agentPromptRatio(item) {
  for(const text of [item?.ratio,item?.title,item?.prompt]) {
    for(const match of String(text || '').matchAll(/\b(\d{1,2})\s*[:：/]\s*(\d{1,2})\b/g)) {
      const ratio=`${Number(match[1])}:${Number(match[2])}`
      if(ratios.has(ratio)) return ratio
    }
  }
  return null
}
export function parseAgentPrompts(text) {
  const prompts=[]
  const cleaned=String(text || '').replace(/```canvas-prompts\s*\n([\s\S]*?)```/g,(block,json)=>{
    try {
      const items=JSON.parse(json)
      if(!Array.isArray(items) || items.length>32) return block
      const valid=items.filter(item=>typeof item?.prompt==='string' && item.prompt.trim() && item.prompt.length<=100000)
      if(valid.length!==items.length) return block
      prompts.push(...valid.map(item=>({title:String(item.title || '图片生成').slice(0,100),group:String(item.group || '').slice(0,50),prompt:item.prompt.trim(),...(agentPromptRatio(item)?{ratio:agentPromptRatio(item)}:{})})))
      return ''
    } catch {return block}
  })
  return {text:cleaned.trim(),prompts}
}
