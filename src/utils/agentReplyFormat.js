// Escape model output before adding a small, safe subset of formatting.
const escape = text => String(text || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char])
const inline = text => escape(text).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
export function formatAgentReply(text) {
  return String(text || '').split(/(```[\s\S]*?(?:```|$))/g).map(part => {
    if (part.startsWith('```')) return `<pre><code>${escape(part.replace(/^```[^\n]*\n?/, '').replace(/```$/, ''))}</code></pre>`
    return part.split(/\n\s*\n/).filter(Boolean).map(block => `<p>${inline(block).replace(/\n/g, '<br>')}</p>`).join('')
  }).join('')
}
