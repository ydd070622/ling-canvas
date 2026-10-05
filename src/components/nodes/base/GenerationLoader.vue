<template>
  <div class="generation-loader" role="status" aria-live="polite">
    <div class="loader"><svg class="mark" viewBox="0 0 100 100" aria-label="Ling Canvas 节点生成动画"><path class="bridge" d="M36 59C47 59 50 51 50 47S53 37 62 36"/><path class="flow" pathLength="100" d="M36 59C47 59 50 51 50 47S53 37 62 36"/><path class="stem" d="M25 34v8"/><path class="stem s2" d="M74 51v7"/><rect class="block b1" x="18" y="15" width="15" height="15" rx="5" fill="currentColor"/><rect class="block b2" x="11" y="49" width="27" height="28" rx="9" fill="currentColor"/><rect class="block b3" x="60" y="17" width="28" height="28" rx="8" fill="currentColor"/><rect class="block b4" x="67" y="63" width="15" height="15" rx="5" fill="currentColor"/></svg><div class="status">{{ label }}<span v-if="label === '图片生成中'" class="ellipsis" aria-hidden="true">...</span></div></div>
    <div class="caption">正在等待模型返回图片</div>
  </div>
</template>
<script setup>
defineProps({ label: { type: String, default: '图片生成中' } })
</script>
<style scoped>
.generation-loader { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:#1c1e20; color:#e1e7e4; pointer-events:none; container-type:size; }
.loader { position:relative; display:flex; flex-direction:column; align-items:center; gap:22px; }
.mark { width:clamp(42px,23cqw,80px); height:clamp(42px,23cqw,80px); overflow:visible; }
.block { transform-box:fill-box; transform-origin:center; animation:nodeBeat 3.2s ease-in-out infinite; }
.b1{animation-delay:0s}.b2{animation-delay:.25s}.b3{animation-delay:.75s}.b4{animation-delay:1s}
.bridge{fill:none;stroke:currentColor;stroke-width:8;stroke-linecap:round;opacity:.42}
.flow{fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-dasharray:9 95;animation:flow 3.2s ease-in-out infinite;opacity:0}
.stem{stroke:currentColor;stroke-width:4;stroke-linecap:round;animation:stem 3.2s ease-in-out infinite}.s2{animation-delay:.8s}
.loader:before{content:'';position:absolute;top:0;width:115px;height:90px;background:radial-gradient(ellipse,#ffffff08,transparent 70%);filter:blur(12px);animation:halo 3.2s ease-in-out infinite;pointer-events:none}
.status{font-size:14px;font-weight:500;color:#d0d4d7;letter-spacing:.7px}
.ellipsis{display:inline-block;width:17px;text-align:left;animation:dots 1.5s steps(4,end) infinite;overflow:hidden;vertical-align:bottom}
.caption{position:absolute;bottom:24px;color:#727a80;font-size:11px}
@keyframes nodeBeat{0%,100%{opacity:.4;transform:scale(.91)}20%,40%{opacity:1;transform:scale(1.04)}65%{opacity:.65;transform:scale(1)}}
@keyframes stem{0%,100%{opacity:.3}25%,55%{opacity:.9}}
@keyframes flow{0%,20%{stroke-dashoffset:100;opacity:0}30%{opacity:.85}65%{stroke-dashoffset:0;opacity:.85}80%,100%{stroke-dashoffset:-10;opacity:0}}
@keyframes halo{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes dots{0%{width:0}100%{width:17px}}
@container(max-height:180px){.caption{display:none}.loader{gap:12px}.mark{width:42px;height:42px}.status{font-size:12px}}
@media(prefers-reduced-motion:reduce){*,:before{animation:none!important}.block,.bridge,.stem{opacity:.9}.flow{display:none}}
</style>
