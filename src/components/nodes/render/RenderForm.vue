<template>
  <!-- 室内渲染的参数表单 | Render parameter form

       原型：public/prototypes/interior-render/index.html
       字段顺序、分组、文案都照原型，只有一处刻意不同：

       **原生 <select>**。`.flow-stage` 是 overflow:hidden，手写的浮层菜单会被裁掉；
       原生下拉的弹出层在浏览器合成层里，不受影响。

       **一套参数作用于全部视角** —— 没有「只改某一个视角」这回事。同一套房子的光线、
       天气、人物应当是统一的一套；逐视角分别调会让「我现在改的是全局还是这一个」变成
       每次操作都要先确认的问题。视角之间的差异只体现在各自送进模型的底图上。
       要单独重跑某个视角，用缩略图上的重生成按钮，而不是换一套参数。

       所有控件都走 set() 往上抛，**没有一个 v-model 绑 props.data** ——
       直接改 store 对象会绕过 updateNode 的存档与撤销栈。 -->
  <div class="flow-render-form">
    <label class="flow-render-field">
      <span class="flow-render-field-head">
        <span class="flow-render-field-icon" v-html="TEXT_ICON"></span>
        <span class="flow-render-label-text">补充提示词</span>
      </span>
      <textarea
        class="flow-render-textarea nodrag"
        :value="params.extra"
        placeholder="输入文本"
        @input="set('extra', $event.target.value)"
      ></textarea>
    </label>

    <div class="flow-render-row">
      <span class="flow-render-row-label"><span>保持空间结构</span></span>
      <label class="flow-render-switch">
        <input type="checkbox" :checked="params.structure" @change="set('structure', $event.target.checked)">
        <span></span>
      </label>
    </div>

    <div class="flow-render-row">
      <span class="flow-render-row-label"><span>封闭空间</span></span>
      <label class="flow-render-switch">
        <input type="checkbox" :checked="params.closed" @change="set('closed', $event.target.checked)">
        <span></span>
      </label>
    </div>

    <div class="flow-render-rule"></div>

    <!-- ---------------------------------------------------------- 场景人物 -->
    <div class="flow-render-row">
      <span class="flow-render-row-label">
        <span class="flow-render-row-title">场景人物</span>
        <small class="flow-render-row-hint">整组共用</small>
      </span>
      <label class="flow-render-switch">
        <input type="checkbox" :checked="params.person" @change="set('person', $event.target.checked)">
        <span></span>
      </label>
    </div>

    <template v-if="params.person">
      <button type="button" class="flow-render-upload nodrag" @click="personInput?.click()">
        <span class="flow-render-upload-thumb">
          <img v-if="params.personImage" :src="params.personImage" alt="人物参考图">
          <svg v-else viewBox="0 0 24 40" fill="none" stroke="currentColor" stroke-width="1.2">
            <circle cx="12" cy="6" r="4" /><path d="M8 12h8l4 13M8 12 4 25M9 14v12l-2 12M15 14v12l2 12M9 25h6" />
          </svg>
        </span>
        <span class="flow-render-upload-text">
          <strong>{{ params.personImage ? '人物参考图已添加 · 点击更换' : '添加全身人物参考图' }}</strong>
          <small>上传图片，让每个视角使用同一人物</small>
        </span>
      </button>
      <input ref="personInput" hidden type="file" accept="image/*" @change="onPersonFile">
      <p class="flow-render-shared-note">整组共用 · 外貌、发型与穿着</p>

      <div class="flow-render-grid">
        <FieldShell label="人物位置">
          <select class="flow-render-select nodrag" :value="params.personLocation" @change="set('personLocation', $event.target.value)">
            <option v-for="option in RENDER_OPTIONS.personLocation" :key="option" :value="option">{{ option }}</option>
          </select>
        </FieldShell>
        <FieldShell label="人物动作">
          <select class="flow-render-select nodrag" :value="params.personAction" @change="set('personAction', $event.target.value)">
            <option v-for="option in RENDER_OPTIONS.personAction" :key="option" :value="option">{{ option }}</option>
          </select>
        </FieldShell>
      </div>

      <FieldShell v-if="params.personLocation === '自定义位置'" label="自定义人物位置">
        <input
          class="flow-render-input nodrag"
          :value="params.personLocationCustom"
          placeholder="例如：餐桌靠厨房一侧"
          @input="set('personLocationCustom', $event.target.value)"
        >
      </FieldShell>

      <div class="flow-render-row">
        <span class="flow-render-row-label"><span>人物动态模糊</span></span>
        <label class="flow-render-switch">
          <input type="checkbox" :checked="params.personBlur" @change="set('personBlur', $event.target.checked)">
          <span></span>
        </label>
      </div>
    </template>

    <div class="flow-render-rule"></div>

    <!-- ---------------------------------------------------------- 室内灯光 -->
    <div class="flow-render-row">
      <span class="flow-render-row-label"><span class="flow-render-row-title">室内灯光</span></span>
      <label class="flow-render-switch">
        <input type="checkbox" :checked="params.lights" @change="set('lights', $event.target.checked)">
        <span></span>
      </label>
    </div>

    <template v-if="params.lights">
      <div class="flow-render-grid">
        <FieldShell label="灯光色温">
          <select class="flow-render-select nodrag" :value="params.temperature" @change="set('temperature', $event.target.value)">
            <option v-for="option in RENDER_OPTIONS.temperature" :key="option" :value="option">{{ option }}</option>
          </select>
        </FieldShell>
        <FieldShell label="开启范围">
          <select class="flow-render-select nodrag" :value="params.lightType" @change="set('lightType', $event.target.value)">
            <option v-for="option in RENDER_OPTIONS.lightType" :key="option" :value="option">{{ option }}</option>
          </select>
        </FieldShell>
      </div>

      <FieldShell v-if="showsCustomField(params, 'temperature')" label="自定义色温 · K">
        <input
          class="flow-render-input nodrag"
          type="number"
          min="1000"
          max="20000"
          step="100"
          :value="params.temperatureCustom"
          placeholder="例如：3500"
          @input="set('temperatureCustom', $event.target.value)"
        >
      </FieldShell>
    </template>

    <div class="flow-render-rule"></div>

    <!-- ---------------------------------------------------------- 室外环境 -->
    <div class="flow-render-section-head">
      <span class="flow-render-row-title">室外环境</span>
      <small>所有视角统一</small>
    </div>

    <div class="flow-render-grid is-three">
      <FieldShell label="地点">
        <select class="flow-render-select nodrag" :value="params.city" @change="set('city', $event.target.value)">
          <option v-for="option in RENDER_OPTIONS.city" :key="option" :value="option">{{ option }}</option>
        </select>
      </FieldShell>
      <FieldShell label="时间">
        <select class="flow-render-select nodrag" :value="params.time" @change="set('time', $event.target.value)">
          <option v-for="option in RENDER_OPTIONS.time" :key="option" :value="option">{{ option }}</option>
        </select>
      </FieldShell>
      <FieldShell label="天气">
        <select class="flow-render-select nodrag" :value="params.weather" @change="set('weather', $event.target.value)">
          <option v-for="option in RENDER_OPTIONS.weather" :key="option" :value="option">{{ option }}</option>
        </select>
      </FieldShell>
    </div>

    <FieldShell v-if="showsCustomField(params, 'city')" label="自定义地点">
      <input class="flow-render-input nodrag" :value="params.cityCustom" placeholder="输入城市或地区，例如：香港" @input="set('cityCustom', $event.target.value)">
    </FieldShell>

    <FieldShell v-if="showsCustomField(params, 'time')" label="自定义时间">
      <input class="flow-render-input nodrag" :value="params.timeCustom" placeholder="例如：下午 4 点，日落前一小时" @input="set('timeCustom', $event.target.value)">
    </FieldShell>

    <div class="flow-render-grid">
      <FieldShell label="窗外外景">
        <!-- 封闭空间下外景整组失效，原型 index.html:53 就是这么联动的 -->
        <select
          class="flow-render-select nodrag"
          :value="params.outside"
          :disabled="params.closed"
          @change="set('outside', $event.target.value)"
        >
          <option v-for="option in RENDER_OPTIONS.outside" :key="option" :value="option">{{ option }}</option>
        </select>
      </FieldShell>
      <FieldShell label="太阳光影">
        <select class="flow-render-select nodrag" :value="params.sun" @change="set('sun', $event.target.value)">
          <option v-for="option in RENDER_OPTIONS.sun" :key="option" :value="option">{{ option }}</option>
        </select>
      </FieldShell>
    </div>

    <FieldShell v-if="showOutsideReference" label="外景参考">
      <button type="button" class="flow-render-upload is-wide nodrag" @click="outsideInput?.click()">
        <span class="flow-render-upload-thumb is-wide">
          <img v-if="params.outsideImage" :src="params.outsideImage" alt="外景参考图">
          <span v-else>＋</span>
        </span>
        <span class="flow-render-upload-text">
          <strong>{{ params.outsideImage ? '外景图片已添加 · 点击更换' : (params.outside === '卫星图' ? '上传卫星图' : '上传外景参考图') }}</strong>
          <small>{{ params.outside === '卫星图' ? '用于周边环境参考，不直接贴入窗户' : '仅用于窗外环境，不改变室内结构' }}</small>
        </span>
      </button>
      <input ref="outsideInput" hidden type="file" accept="image/*" @change="onOutsideFile">
    </FieldShell>

    <FieldShell v-else-if="showsCustomField(params, 'outside')" label="自定义窗外外景">
      <input class="flow-render-input nodrag" :value="params.outsideCustom" placeholder="例如：远处海湾，近处有热带绿植" @input="set('outsideCustom', $event.target.value)">
    </FieldShell>

    <div class="flow-render-rule"></div>

    <!-- ---------------------------------------------------------- 输出 -->
    <div class="flow-render-grid is-model">
      <FieldShell label="渲染模型" hint="整组共用">
        <select class="flow-render-select nodrag" :value="modelValue" @change="emit('update:model', $event.target.value)">
          <optgroup v-for="group in modelGroups" :key="group.label" :label="group.label">
            <option v-for="option in group.options" :key="option.optionId" :value="option.optionId">{{ option.label }}</option>
          </optgroup>
        </select>
      </FieldShell>
      <FieldShell label="输出清晰度" :hint="resolutionHint">
        <select class="flow-render-select nodrag" :value="params.resolution" @change="set('resolution', $event.target.value)">
          <option v-for="option in resolutionOptions" :key="option" :value="option">{{ option }}</option>
        </select>
      </FieldShell>
    </div>

  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import FieldShell from './FieldShell.vue'
import { RENDER_OPTIONS, showsCustomField } from '../../../utils/renderPrompt'

/** 「补充提示词」那一行的文字图标，照 33.png 的 T 标 */
const TEXT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M5 5h14M12 5v14"/></svg>'

const props = defineProps({
  /** 全部参数（已过 readParams 补默认），对每个视角都一样 */
  params: { type: Object, required: true },
  modelValue: { type: String, default: '' },
  modelOptions: { type: Array, default: () => [] },
  resolutionOptions: { type: Array, default: () => ['1K', '2K', '4K'] },
  /** 档位被渠道锁死时的说明（空串 = 可自由切换） */
  resolutionHint: { type: String, default: '' }
})

const emit = defineEmits(['set', 'update:model', 'upload'])
const modelGroups = computed(() => {
  const groups = new Map()
  props.modelOptions.forEach(option => {
    const label = option.group || '其他供应商'
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push(option)
  })
  return [...groups].map(([label, options]) => ({ label, options }))
})

const set = (key, next) => emit('set', key, next)

const showOutsideReference = computed(() => (
  !props.params.closed && ['参考图', '卫星图'].includes(props.params.outside)
))

const personInput = ref(null)
const outsideInput = ref(null)

const onPersonFile = (event) => {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (file) emit('upload', { kind: 'person', file })
}

const onOutsideFile = (event) => {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (file) emit('upload', { kind: 'outside', file })
}
</script>
