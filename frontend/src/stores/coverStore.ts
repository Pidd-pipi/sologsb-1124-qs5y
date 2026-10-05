import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { db, saveAsset } from '@/utils/db'
import { emitChange } from '@/utils/catalogEvents'
import type { Cover, FrankingItem } from '@/types/cover'
import type { StamplessEntry } from '@/types/stampentry'
import { nextSerialNo, nowIso } from '@/utils/id'
import type { ImagePayload } from './postmarkStore'

/**
 * 多标签页同时编辑同一封时抛出：本标签页打开记录时拿到的 baseUpdatedAt
 * 与库中现存版本不一致，说明对方已经先保存。调用方必须提示用户，不能覆盖。
 */
export class RecordConflictError extends Error {
  /** 库中现存（对方已保存）版本的更新时间 */
  currentUpdatedAt: string
  constructor(entityName: string, currentUpdatedAt: string) {
    super(`${entityName}已被其他标签页修改`)
    this.name = 'RecordConflictError'
    this.currentUpdatedAt = currentUpdatedAt
  }
}

export const useCoverStore = defineStore('cover', () => {
  const list = ref<Cover[]>([])
  const entries = ref<StamplessEntry[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      list.value = await db.covers.orderBy('coverNo').toArray()
      entries.value = await db.stampEntries.toArray()
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  /** 生成下一个封号，如 CV-0005 */
  function nextCoverNo(): string {
    return nextSerialNo('CV-', list.value.map((c) => c.coverNo))
  }

  async function create(
    input: Cover,
    images?: Partial<Record<'front' | 'back', ImagePayload>>
  ): Promise<number> {
    const now = nowIso()
    const record: Cover = {
      ...input,
      coverNo: input.coverNo || nextCoverNo(),
      franking: input.franking.map((f) => ({ ...f })),
      cancelPmIds: [...input.cancelPmIds],
      viaPoints: [...input.viaPoints],
      createdAt: now,
      updatedAt: now
    }
    delete record.id
    const id = await db.covers.add(record)
    for (const side of ['front', 'back'] as const) {
      const payload = images?.[side]
      if (payload && payload.dataUrl) {
        await saveAsset({
          ownerType: 'cover',
          ownerId: id,
          side,
          dataUrl: payload.dataUrl,
          fileName: payload.fileName,
          updatedAt: now
        })
      }
    }
    emitChange('cover', id)
    await load()
    return id
  }

  /**
   * 普通更新（品相标记、换图、挂/摘邮路等单字段快速操作）。
   * 完整表单的保存请走 checkedUpdate 做并发校验。
   */
  async function update(id: number, patch: Partial<Cover>): Promise<void> {
    await db.covers.update(id, { ...patch, updatedAt: nowIso() })
    emitChange('cover', id)
    await load()
  }

  /**
   * 带并发校验的整表保存：仅当库中版本的 updatedAt 仍等于 baseUpdatedAt
   * （即本标签页打开/上次保存后无人改过）时才写入。对方先保存则返回
   * conflict 并带回现存版本供界面提示，绝不覆盖；记录已被删除时 current 为 null。
   */
  async function checkedUpdate(
    id: number,
    record: Cover,
    baseUpdatedAt: string
  ): Promise<
    { savedAt: string } | { conflict: RecordConflictError; current: Cover | null }
  > {
    return db.transaction('rw', db.covers, async () => {
      const current = await db.covers.get(id)
      if (!current) {
        return { conflict: new RecordConflictError('该实寄封', ''), current: null }
      }
      if (current.updatedAt !== baseUpdatedAt) {
        return { conflict: new RecordConflictError('该实寄封', current.updatedAt), current }
      }
      const savedAt = nowIso()
      const next: Cover = {
        ...record,
        id,
        coverNo: current.coverNo,
        createdAt: current.createdAt,
        updatedAt: savedAt
      }
      await db.covers.put(next)
      emitChange('cover', id)
      return { savedAt }
    })
  }

  async function remove(id: number): Promise<void> {
    await db.covers.delete(id)
    const own = await db.stampEntries.where('coverId').equals(id).toArray()
    await db.stampEntries.bulkDelete(own.map((e) => e.id).filter((v): v is number => typeof v === 'number'))
    emitChange('cover', id)
    emitChange('stampEntry', id)
    await load()
  }

  async function addEntry(input: StamplessEntry): Promise<number> {
    const id = await db.stampEntries.add({ ...input, createdAt: nowIso() })
    emitChange('stampEntry', id)
    emitChange('cover', input.coverId)
    await load()
    return id
  }

  async function removeEntry(id: number): Promise<void> {
    await db.stampEntries.delete(id)
    emitChange('stampEntry', id)
    await load()
  }

  function byId(id: number | null | undefined): Cover | null {
    if (id == null) return null
    return list.value.find((c) => c.id === id) ?? null
  }

  /** 某个封下的票戳组合明细 */
  function entriesOf(coverId: number | null | undefined): StamplessEntry[] {
    if (coverId == null) return []
    return entries.value.filter((e) => e.coverId === coverId)
  }

  /** 贴票枚数（行内展示用） */
  function frankingCount(cover: Cover | null): number {
    if (!cover) return 0
    return cover.franking.reduce((sum, f: FrankingItem) => sum + (Number(f.count) || 0), 0)
  }

  /** 关联邮戳数（行内展示用） */
  function cancelCount(cover: Cover | null): number {
    return cover ? cover.cancelPmIds.length : 0
  }

  const coversOfRoute = computed(() => {
    return (routeId: number): Cover[] => list.value.filter((c) => c.routeId === routeId)
  })

  const total = computed(() => list.value.length)
  const registeredCount = computed(() => list.value.filter((c) => c.registered).length)

  return {
    list,
    entries,
    loading,
    loaded,
    total,
    registeredCount,
    coversOfRoute,
    load,
    nextCoverNo,
    create,
    update,
    checkedUpdate,
    remove,
    addEntry,
    removeEntry,
    byId,
    entriesOf,
    frankingCount,
    cancelCount
  }
})
