export const isCopyRequest = text => /文案|正文|笔记/.test(text) && !/为什么|怎么.*设置|如何.*设置|问题出在/.test(text)

export const copyRequestPrompt = text => isCopyRequest(text)
  ? `${text}\n\n【本轮交付要求】只交付可直接发布的文案：案例文案开头按本地技能保留四行，顺序固定为「📍坐标」「建筑面积」「项目情况」「改造风格」，然后是正文和标签。项目资料属于文案的一部分，不要删掉。不要前言、标题复述、待确认占位、分隔线、封面、评论区引导、私信承接、待办、技能或文件说明。使用本地技能的写作规则，但不要输出其附加交付模块。即使历史回复包含这些模块，本轮也必须省略。四个项目资料字段不能漏项；已知值填写，未知值留空供用户补充，不能编造面积或项目情况，也不写待确认说明。`
  : text

export const cleanCopyOutput = text => {
  const lines = String(text || '').replace(/\r\n?/g,'\n').split('\n')
  const end = lines.findIndex(line => /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:【\s*)?(?:封面(?:方案|文案)?|评论区引导|私信承接|待确认[一二三四五六七八九十\d]*件(?:事)?|三件要你处理的事|待办清单|需(?:要)?你(?:确认|处理)的事)(?:\s*】)?/.test(line))
  const content = end < 0 ? lines : lines.slice(0,end)
  return content.filter(line => {
    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) return false
    if (/^\s*(?:【)?标题(?:】)?\s*[:：]/.test(line.replace(/\*\*/g,''))) return false
    if (/【待确认[^】]*】|\[待确认[^\]]*\]/.test(line)) return false
    if (/^\s*(?:收到[，。：:]|这是.*(?:正文|案例|文案).*|下面是.*(?:正文|文案).*|(?:我|已).*按.*(?:重出|写|生成).*(?:一版|文案)).*$/.test(line)) return false
    return true
  }).join('\n').replace(/\n{3,}/g,'\n\n').trim()
}
