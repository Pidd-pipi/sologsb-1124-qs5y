<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { UploadFile } from 'element-plus'
import RouteTimeline from '@/components/common/RouteTimeline.vue'
import ScarceTag from '@/components/common/ScarceTag.vue'
import StampCard from '@/components/common/StampCard.vue'
import { useCoverRoute } from '@/hooks/useCoverRoute'
import { useCoverStore } from '@/stores/coverStore'
import { usePostmarkStore } from '@/stores/postmarkStore'
import { useRouteStore } from '@/stores/routeStore'
import type { Cover } from '@/types/cover'
import type { Postmark } from '@/types/postmark'
import type { TimelineNode } from '@/types/route'
import type { StamplessEntry } from '@/types/stampentry'
import {
  COVER_POSITIONS,
  VARIETY_TYPES,
  createEmptyStampEntry
} from '@/types/stampentry'
import { CONDITION_GRADES, createEmptyCover } from '@/types/cover'
import { loadAssets, saveAsset } from '@/utils/db'
import { nowIso } from '@/utils/id'
import { clearDraft, loadDraft, saveDraft } from '@/utils/draft'

const props = defineProps<{ id: string }>()
const router = useRouter()
const coverStore = useCoverStore()
const postmarkStore = usePostmarkStore()
const routeStore = useRouteStore()

const coverId = computed<number | null>(() => {
  const n = Number(props.id)
  return Number.isFinite(n) && n > 0 ? n : null
})

const { cover, route, timeline, trustedTransitDays, review, error, load } = useCoverRoute(coverId)

const frontUrl = ref('')
const backUrl = ref('')
const entryDialog = ref(false)
const exportDialog = ref(false)
const exportText = ref('')
const pmDialog = ref(false)
const activePostmark = ref<Postmark | null>(null)
const entryForm = reactive<StamplessEntry>(createEmptyStampEntry(0))

const entries = computed<StamplessEntry[]>(() => coverStore.entriesOf(coverId.value))

onMounted(async () => {
  if (!coverStore.loaded) await coverStore.load()
  if (!postmarkStore.loaded) await postmarkStore.load()
  if (!routeStore.loaded) await routeStore.load()
  await loadAssetsForCover()
})

watch(coverId, () => void loadAssetsForCover())

watch(
  () => cover.value?.id,
  () => {
    if (cover.value) void loadAssetsForCover()
  }
)

async function loadAssetsForCover(): Promise<void> {
  const id = coverId.value
  frontUrl.value = cover.value?.frontImage ?? ''
  backUrl.value = cover.value?.backImage ?? ''
  if (id == null) return
  const assets = await loadAssets('cover', id)
  const front = assets.find((a) => a.side === 'front')
  const back = assets.find((a) => a.side === 'back')
  if (front) frontUrl.value = front.dataUrl
  if (back) backUrl.value = back.dataUrl
}

async function replaceImage(side: 'front' | 'back', file: UploadFile): Promise<void> {
  const id = coverId.value
  const raw = file.raw
  if (id == null || !raw) return
  if (raw.size > 2 * 1024 * 1024) {
    ElMessage.warning('封图请控制在 2MB 以内')
    return
  }
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(raw)
  })
  await saveAsset({
    ownerType: 'cover',
    ownerId: id,
    side,
    dataUrl,
    fileName: raw.name,
    updatedAt: nowIso()
  })
  await coverStore.update(id, side === 'front' ? { frontImage: dataUrl } : { backImage: dataUrl })
  await loadAssetsForCover()
  ElMessage.success(side === 'front' ? '已更新正面图' : '已更新背面图')
}

function onFrontChange(file: UploadFile): void {
  void replaceImage('front', file)
}

function onBackChange(file: UploadFile): void {
  void replaceImage('back', file)
}

async function setGrade(grade: string): Promise<void> {
  const id = coverId.value
  if (id == null) return
  await coverStore.update(id, { conditionGrade: grade as '上品' | '中品' | '下品' })
  await load()
  ElMessage.success(`品相已标记为${grade}`)
}

function openEntryDialog(): void {
  const id = coverId.value
  if (id == null) return
  Object.assign(entryForm, createEmptyStampEntry(id))
  entryDialog.value = true
}

async function submitEntry(): Promise<void> {
  const id = coverId.value
  if (id == null) return
  if (!entryForm.stampName.trim()) {
    ElMessage.warning('请填写邮票名称')
    return
  }
  await coverStore.addEntry({ ...entryForm, coverId: id })
  entryDialog.value = false
  ElMessage.success('已加入票戳组合')
}

async function removeEntry(entry: StamplessEntry): Promise<void> {
  if (typeof entry.id !== 'number') return
  await coverStore.removeEntry(entry.id)
  ElMessage.success('已移除该组合')
}

function buildExportText(): string {
  const c = cover.value
  if (!c) return ''
  const lines = [
    `票戳明细导出 · ${c.coverNo}`,
    `收寄：${c.sentFrom} → ${c.sentTo}`,
    `寄出/到达：${c.postDate || '待考'} / ${c.arriveDate || '待考'}`,
    `品相：${c.conditionGrade}　给据：${c.registered ? '是' : '否'}`,
    '序号,邮票名称,面值,发行年份,齿度,变体,封上位置'
  ]
  entries.value.forEach((e, i) => {
    lines.push(
      [i + 1, e.stampName, e.denomination, e.issueYear, e.perforation, e.variety, e.positionOnCover].join(
        ','
      )
    )
  })
  if (!entries.value.length) lines.push('（暂无票戳组合，请先录入）')
  return lines.join('\n')
}

async function exportEntries(): Promise<void> {
  exportText.value = buildExportText()
  exportDialog.value = true
}

async function copyExport(): Promise<void> {
  try {
    await navigator.clipboard.writeText(exportText.value)
    ElMessage.success('票戳明细已复制')
  } catch {
    ElMessage.info('浏览器未授权剪贴板，请手动选择文本')
  }
}

function showPostmark(pm: Postmark): void {
  activePostmark.value = pm
  pmDialog.value = true
}

const cancelPostmarks = computed<Postmark[]>(() =>
  (cover.value?.cancelPmIds ?? [])
    .map((id) => postmarkStore.byId(id))
    .filter((pm): pm is Postmark => pm != null)
)

function onTimelineSelect(node: TimelineNode): void {
  if (node.kind === 'transit') ElMessage.info(`中转节点：${node.office}（${node.mark}）`)
}

function backToList(): void {
  void router.push('/covers')
}

function openRoute(): void {
  if (route.value?.id != null) void router.push(`/routes/${route.value.id}`)
}

/* ------------------------- 编辑寄递事实（带并发校验） ------------------------- */

const editDialog = ref(false)
const editForm = reactive<Cover>(createEmptyCover())
/** 打开对话框/上次成功保存时该封的版本时间戳，作为乐观锁令牌 */
const baseUpdatedAt = ref('')
const saving = ref(false)
/** 冲突时对方已保存的现存版本 */
const conflictCurrent = ref<Cover | null>(null)
const conflictTime = ref('')
/** 本标签页改动与对方版本的字段差异 */
const conflictDiffs = ref<{ label: string; mine: string; theirs: string }[]>([])
const hasEditDraft = ref(false)

const EDIT_FIELDS: { key: keyof Cover; label: string }[] = [
  { key: 'sentFrom', label: '寄出地' },
  { key: 'sentTo', label: '收件地' },
  { key: 'postDate', label: '寄出日期' },
  { key: 'arriveDate', label: '到达日期' },
  { key: 'routeId', label: '所属邮路' },
  { key: 'viaPoints', label: '中转地' },
  { key: 'cancelPmIds', label: '关联邮戳' },
  { key: 'registered', label: '给据邮件' },
  { key: 'conditionGrade', label: '品相' },
  { key: 'acquireFrom', label: '来源' },
  { key: 'price', label: '购入价' },
  { key: 'storageAlbum', label: '藏册页位' },
  { key: 'note', label: '备注' }
]

function draftKey(): string {
  return `cover-edit:${coverId.value ?? ''}`
}

function fieldText(key: keyof Cover, value: unknown): string {
  if (key === 'routeId') {
    const id = typeof value === 'number' ? value : null
    if (id == null) return '未挂邮路'
    const rt = routeStore.byId(id)
    return rt ? `${rt.routeNo} ${rt.name}` : `邮路 #${id}`
  }
  if (key === 'cancelPmIds') {
    const ids = Array.isArray(value) ? (value as number[]) : []
    return ids.length ? ids.map((id) => postmarkStore.labelOf(id)).join('、') : '无'
  }
  if (key === 'viaPoints') {
    const pts = Array.isArray(value) ? (value as string[]) : []
    return pts.length ? pts.join('、') : '直封'
  }
  if (key === 'registered') return value ? '是' : '否'
  if (key === 'price') return `${Number(value) || 0} 元`
  if (key === 'postDate' || key === 'arriveDate') return value ? String(value) : '待考'
  return value === '' || value == null ? '未填' : String(value)
}

function buildDiffs(mine: Cover, theirs: Cover) {
  return EDIT_FIELDS.map(({ key, label }) => {
    const a = fieldText(key, mine[key])
    const b = fieldText(key, theirs[key])
    return a === b ? null : { label, mine: a, theirs: b }
  }).filter((d): d is { label: string; mine: string; theirs: string } => d != null)
}

function assignEditForm(source: Cover): void {
  Object.assign(editForm, {
    ...createEmptyCover(),
    ...source,
    franking: source.franking.map((f) => ({ ...f })),
    cancelPmIds: [...source.cancelPmIds],
    viaPoints: [...source.viaPoints]
  })
}

function resetConflict(): void {
  conflictCurrent.value = null
  conflictTime.value = ''
  conflictDiffs.value = []
}

function openEditDialog(): void {
  const c = cover.value
  if (!c) return
  assignEditForm(c)
  baseUpdatedAt.value = c.updatedAt
  resetConflict()
  hasEditDraft.value = !!loadDraft<Cover>(draftKey())
  editDialog.value = true
}

function restoreEditDraft(): void {
  const draft = loadDraft<Cover>(draftKey())
  if (!draft) {
    ElMessage.info('没有可恢复的本地草稿')
    return
  }
  assignEditForm(draft)
  resetConflict()
  hasEditDraft.value = false
  ElMessage.success('已载入本地草稿，核对后可重新保存')
}

function formatTime(iso: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : iso
}

async function submitEdit(): Promise<void> {
  const id = coverId.value
  if (id == null) return
  if (!editForm.sentFrom.trim() || !editForm.sentTo.trim()) {
    ElMessage.warning('请填写寄出地与收件地')
    return
  }
  // 冲突未处理前不允许再保存，避免覆盖对方版本
  if (conflictCurrent.value) {
    ElMessage.warning('对方已修改该封，请先载入对方版本或把本地内容存为草稿')
    return
  }
  saving.value = true
  try {
    const record: Cover = {
      ...editForm,
      franking: editForm.franking.map((f) => ({ ...f })),
      cancelPmIds: [...editForm.cancelPmIds],
      viaPoints: [...editForm.viaPoints]
    }
    const result = await coverStore.checkedUpdate(id, record, baseUpdatedAt.value)
    if ('conflict' in result) {
      if (!result.current) {
        ElMessage.error('该实寄封已被另一个标签页删除，无法保存')
        editDialog.value = false
        return
      }
      // 对方先保存：保住对方版本，本标签页的内容保留在表单中，绝不覆盖
      conflictCurrent.value = result.current
      conflictTime.value = result.conflict.currentUpdatedAt
      conflictDiffs.value = buildDiffs(record, result.current)
      saveDraft(draftKey(), record)
      hasEditDraft.value = true
      ElMessage.error('该封已被另一个标签页修改，已为你保留对方版本，本地改动已存为草稿')
      return
    }
    baseUpdatedAt.value = result.savedAt
    clearDraft(draftKey())
    hasEditDraft.value = false
    editDialog.value = false
    ElMessage.success('寄递事实已保存，关联核对已重新计算')
    await Promise.all([coverStore.load(), load()])
  } finally {
    saving.value = false
  }
}

/** 放弃本地改动，载入对方已保存的版本，令牌随之更新，可在此基础上继续编辑 */
function adoptRemote(): void {
  const remote = conflictCurrent.value
  if (!remote) return
  assignEditForm(remote)
  baseUpdatedAt.value = remote.updatedAt
  resetConflict()
  ElMessage.success('已载入对方版本，可在其基础上继续编辑')
}

/** 把本地改动留作草稿并关闭，对方版本保持不动 */
function keepMineAsDraft(): void {
  saveDraft(draftKey(), { ...editForm })
  resetConflict()
  editDialog.value = false
  ElMessage.info('本地改动已存为草稿，未覆盖对方版本')
}

const editPostmarkOptions = computed(() =>
  postmarkStore.list.flatMap((pm) =>
    typeof pm.id === 'number' ? [{ label: `${pm.pmNo} ${pm.office}`, value: pm.id }] : []
  )
)

const editRouteOptions = computed(() =>
  routeStore.list.flatMap((rt) =>
    typeof rt.id === 'number' ? [{ label: `${rt.routeNo} ${rt.name}`, value: rt.id }] : []
  )
)
</script>

<template>
  <div class="gb-page cover-detail">
    <header class="gb-page__head">
      <div>
        <h1 class="gb-page__title">
          实寄封详情
          <span v-if="cover" class="cover-detail__no">{{ cover.coverNo }}</span>
          <el-tag v-if="review.needsReview" type="danger" effect="dark" size="default">待核对</el-tag>
          <el-tag v-else type="success" effect="plain" size="default">已核对</el-tag>
        </h1>
        <p class="gb-page__subtitle">
          <template v-if="cover">
            {{ cover.sentFrom }} → {{ cover.sentTo }} · 寄出 {{ cover.postDate || '待考' }} · 到达
            {{ cover.arriveDate || '待考' }}
          </template>
          <template v-else>按封号读取寄递事实、票戳组合与邮路时间轴。</template>
        </p>
      </div>
      <div class="cover-detail__actions">
        <el-button @click="backToList">返回目录</el-button>
        <el-button v-if="cover" type="primary" @click="openEditDialog">编辑寄递事实</el-button>
        <el-button v-if="route" type="primary" plain @click="openRoute">打开邮路编辑器</el-button>
      </div>
    </header>

    <p v-if="error" class="gb-empty">{{ error }}</p>

    <template v-else-if="cover">
      <el-alert
        v-if="review.needsReview"
        class="cover-detail__review"
        type="error"
        :closable="false"
        show-icon
        title="该封待核对：关联信息变动后重新核对发现以下问题，旧的在途天数已停止展示"
      >
        <ul class="cover-detail__review-list">
          <li v-for="(item, i) in review.issues" :key="i">{{ item.message }}</li>
        </ul>
      </el-alert>

      <section class="gb-panel">
        <h2 class="gb-panel__title">寄递事实</h2>
        <dl class="gb-facts">
          <div><dt>封号</dt><dd>{{ cover.coverNo }}</dd></div>
          <div><dt>寄出地</dt><dd>{{ cover.sentFrom }}</dd></div>
          <div><dt>收件地</dt><dd>{{ cover.sentTo }}</dd></div>
          <div><dt>寄出日期</dt><dd>{{ cover.postDate || '待考' }}</dd></div>
          <div><dt>到达日期</dt><dd>{{ cover.arriveDate || '待考' }}</dd></div>
          <div>
            <dt>在途天数</dt>
            <dd>
              <el-tag v-if="review.needsReview" size="small" type="danger" effect="plain">
                待核对
              </el-tag>
              <template v-else-if="trustedTransitDays == null">待考</template>
              <template v-else>{{ trustedTransitDays }} 天</template>
            </dd>
          </div>
          <div><dt>中转地</dt><dd>{{ cover.viaPoints.length ? cover.viaPoints.join('、') : '直封' }}</dd></div>
          <div><dt>给据邮件</dt><dd>{{ cover.registered ? '是' : '否' }}</dd></div>
          <div><dt>来源</dt><dd>{{ cover.acquireFrom || '未记' }}</dd></div>
          <div><dt>购入价</dt><dd>{{ cover.price }} 元</dd></div>
          <div><dt>藏册页位</dt><dd>{{ cover.storageAlbum || '未入册' }}</dd></div>
          <div><dt>所属邮路</dt><dd>{{ route ? `${route.routeNo} ${route.name}` : '未挂邮路' }}</dd></div>
        </dl>
        <div class="cover-detail__grade">
          <span class="cover-detail__grade-label">标记品相：</span>
          <el-radio-group
            :model-value="cover.conditionGrade"
            size="small"
            @update:model-value="setGrade(String($event))"
          >
            <el-radio-button v-for="g in CONDITION_GRADES" :key="g" :value="g">{{ g }}</el-radio-button>
          </el-radio-group>
          <ScarceTag :level="cover.conditionGrade" kind="grade" prefix="当前：" />
        </div>
      </section>

      <section class="cover-detail__figures">
        <div class="gb-figure">
          <img v-if="frontUrl" :src="frontUrl" :alt="`${cover.coverNo} 正面`" />
          <span v-else class="cover-detail__no-image">尚未上传正面图</span>
          <el-upload
            :auto-upload="false"
            :show-file-list="false"
            accept="image/*"
            :on-change="onFrontChange"
          >
            <el-button size="small">上传/替换正面图</el-button>
          </el-upload>
        </div>
        <div class="gb-figure">
          <img v-if="backUrl" :src="backUrl" :alt="`${cover.coverNo} 背面`" />
          <span v-else class="cover-detail__no-image">尚未上传背面图</span>
          <el-upload
            :auto-upload="false"
            :show-file-list="false"
            accept="image/*"
            :on-change="onBackChange"
          >
            <el-button size="small">上传/替换背面图</el-button>
          </el-upload>
        </div>
      </section>

      <section class="gb-panel">
        <h2 class="gb-panel__title">寄递事实时间轴</h2>
        <p v-if="review.needsReview" class="cover-detail__warn">
          时间轴存在待核对项（共 {{ review.issues.length }} 条），具体原因见页面顶部，在途天数暂不展示。
        </p>
        <RouteTimeline :nodes="timeline" @select="onTimelineSelect" />
      </section>

      <section class="gb-panel">
        <div class="cover-detail__section-head">
          <h2 class="gb-panel__title">票戳组合表（{{ entries.length }} 条）</h2>
          <span>
            <el-button size="small" @click="exportEntries">导出票戳明细</el-button>
            <el-button size="small" type="primary" @click="openEntryDialog">录入组合</el-button>
          </span>
        </div>
        <el-table :data="entries" border stripe>
          <el-table-column label="序号" width="70">
            <template #default="{ $index }">{{ $index + 1 }}</template>
          </el-table-column>
          <el-table-column prop="stampName" label="邮票名称" min-width="150" />
          <el-table-column prop="denomination" label="面值" width="90" />
          <el-table-column prop="issueYear" label="发行年份" width="100" />
          <el-table-column prop="perforation" label="齿度" width="90" />
          <el-table-column prop="variety" label="变体" width="100" />
          <el-table-column prop="positionOnCover" label="封上位置" width="110" />
          <el-table-column label="操作" width="90">
            <template #default="{ row }">
              <el-button size="small" link type="danger" @click="removeEntry(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <section class="gb-panel">
        <h2 class="gb-panel__title">关联邮戳（{{ cancelPostmarks.length }} 枚）</h2>
        <p v-if="!cancelPostmarks.length" class="gb-empty">该封尚未关联销票邮戳。</p>
        <div v-else class="gb-grid">
          <StampCard
            v-for="pm in cancelPostmarks"
            :key="pm.id"
            :postmark="pm"
            @select="showPostmark"
          />
        </div>
      </section>
    </template>

    <el-dialog v-model="entryDialog" title="录入票戳组合" width="560px">
      <el-form label-width="96px">
        <el-form-item label="邮票名称">
          <el-input v-model="entryForm.stampName" placeholder="如 蟠龙邮票" />
        </el-form-item>
        <el-form-item label="面值">
          <el-input-number v-model="entryForm.denomination" :min="0" :precision="1" />
        </el-form-item>
        <el-form-item label="发行年份">
          <el-input-number v-model="entryForm.issueYear" :min="1800" :max="2100" />
        </el-form-item>
        <el-form-item label="齿度">
          <el-input v-model="entryForm.perforation" placeholder="如 P11 / P12.5" />
        </el-form-item>
        <el-form-item label="变体">
          <el-select v-model="entryForm.variety" style="width: 100%">
            <el-option v-for="v in VARIETY_TYPES" :key="v" :label="v" :value="v" />
          </el-select>
        </el-form-item>
        <el-form-item label="封上位置">
          <el-select v-model="entryForm.positionOnCover" style="width: 100%">
            <el-option v-for="p in COVER_POSITIONS" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="entryDialog = false">取消</el-button>
        <el-button type="primary" @click="submitEntry">保存组合</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="exportDialog" title="票戳明细导出" width="620px">
      <el-input v-model="exportText" type="textarea" :rows="12" readonly />
      <template #footer>
        <el-button @click="exportDialog = false">关闭</el-button>
        <el-button type="primary" @click="copyExport">复制明细</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="pmDialog" title="邮戳档案" width="520px">
      <div v-if="activePostmark" class="cover-detail__pm">
        <img
          v-if="activePostmark.imageDataUrl"
          :src="activePostmark.imageDataUrl"
          :alt="`${activePostmark.pmNo} 戳样`"
        />
        <dl class="gb-facts">
          <div><dt>编目号</dt><dd>{{ activePostmark.pmNo }}</dd></div>
          <div><dt>戳型</dt><dd>{{ activePostmark.type }}</dd></div>
          <div><dt>局所</dt><dd>{{ activePostmark.office }}</dd></div>
          <div><dt>使用年代</dt><dd>{{ activePostmark.yearFrom }}-{{ activePostmark.yearTo }}</dd></div>
          <div><dt>戳面日期</dt><dd>{{ activePostmark.dateOnStamp || '未注' }}</dd></div>
          <div><dt>戳径/墨色</dt><dd>{{ activePostmark.diameter }}mm / {{ activePostmark.inkColor }}</dd></div>
        </dl>
        <ScarceTag :level="activePostmark.scarceLevel" />
      </div>
    </el-dialog>

    <el-dialog v-model="editDialog" title="编辑寄递事实" width="760px">
      <el-alert
        v-if="conflictCurrent"
        class="cover-detail__conflict"
        type="error"
        :closable="false"
        show-icon
        :title="`另一个标签页已在 ${formatTime(conflictTime) || '刚才'} 保存了该封，对方版本已保留，本次改动尚未写入`"
      >
        <p class="cover-detail__conflict-tip">
          为避免覆盖对方的修改，请选择「载入对方版本」在最新数据上继续编辑，或「把我的改动存为草稿」稍后再合并。
        </p>
        <el-table v-if="conflictDiffs.length" :data="conflictDiffs" size="small" border>
          <el-table-column prop="label" label="字段" width="110" />
          <el-table-column prop="mine" label="本标签页" min-width="150" />
          <el-table-column prop="theirs" label="对方已保存" min-width="150" />
        </el-table>
        <div class="cover-detail__conflict-actions">
          <el-button size="small" type="primary" @click="adoptRemote">载入对方版本继续编辑</el-button>
          <el-button size="small" @click="keepMineAsDraft">把我的改动存为草稿</el-button>
        </div>
      </el-alert>

      <el-alert
        v-else-if="hasEditDraft"
        class="cover-detail__conflict"
        type="warning"
        :closable="false"
        show-icon
        title="存在上次冲突时保留的本地草稿"
      >
        <div class="cover-detail__conflict-actions">
          <el-button size="small" @click="restoreEditDraft">载入草稿</el-button>
        </div>
      </el-alert>

      <el-form label-width="104px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="寄出地">
              <el-input v-model="editForm.sentFrom" placeholder="如 上海" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="收件地">
              <el-input v-model="editForm.sentTo" placeholder="如 南京" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="寄出日期">
              <el-date-picker
                v-model="editForm.postDate"
                type="date"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="到达日期">
              <el-date-picker
                v-model="editForm.arriveDate"
                type="date"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="关联邮戳">
              <el-select
                v-model="editForm.cancelPmIds"
                multiple
                placeholder="选择销票邮戳"
                style="width: 100%"
              >
                <el-option
                  v-for="opt in editPostmarkOptions"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="所属邮路">
              <el-select v-model="editForm.routeId" placeholder="可不挂" clearable style="width: 100%">
                <el-option
                  v-for="opt in editRouteOptions"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="中转地">
              <el-select
                v-model="editForm.viaPoints"
                multiple
                filterable
                allow-create
                default-first-option
                :reserve-keyword="false"
                placeholder="输入后回车添加"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="给据邮件">
              <el-switch v-model="editForm.registered" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="品相">
              <el-select v-model="editForm.conditionGrade" style="width: 100%">
                <el-option v-for="g in CONDITION_GRADES" :key="g" :label="g" :value="g" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="购入价(元)">
              <el-input-number v-model="editForm.price" :min="0" :precision="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="来源">
              <el-input v-model="editForm.acquireFrom" placeholder="如 邮品交流 / 家族旧藏" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="藏册页位">
              <el-input v-model="editForm.storageAlbum" placeholder="如 甲册 3 页" />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="备注">
              <el-input v-model="editForm.note" type="textarea" :rows="2" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="editDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitEdit">保存并重新核对</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.cover-detail__no {
  color: #5d3325;
  font-size: 18px;
  margin-left: 8px;
}
.cover-detail__review {
  margin-bottom: 16px;
}
.cover-detail__review-list {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.7;
}
.cover-detail__conflict {
  margin-bottom: 14px;
}
.cover-detail__conflict-tip {
  margin: 4px 0 8px;
  font-size: 13px;
  line-height: 1.6;
}
.cover-detail__conflict-actions {
  display: flex;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.cover-detail__actions {
  display: flex;
  gap: 10px;
}
.cover-detail__grade {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.cover-detail__grade-label {
  font-size: 13px;
  color: var(--gb-muted);
}
.cover-detail__figures {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}
.cover-detail__no-image {
  display: block;
  font-size: 12px;
  color: var(--gb-muted);
  margin-bottom: 8px;
}
.cover-detail__warn {
  margin: 0 0 10px;
  font-size: 13px;
  color: #b06f16;
  background: #fdf5e6;
  border: 1px solid #ecd3a5;
  border-radius: 8px;
  padding: 6px 10px;
}
.cover-detail__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.cover-detail__pm img {
  max-width: 100%;
  border-radius: 8px;
  margin-bottom: 10px;
}
</style>
