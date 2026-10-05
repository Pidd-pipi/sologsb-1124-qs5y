import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { db, saveAsset } from '@/utils/db'
import type { Cover, FrankingItem } from '@/types/cover'
import type { Postmark } from '@/types/postmark'
import type { StamplessEntry } from '@/types/stampentry'
import { verifyCover } from '@/utils/verify'
import { nextSerialNo, nowIso } from '@/utils/id'
import type { ImagePayload } from './postmarkStore'

/** 更新结果：成功或冲突 */
export type UpdateResult =
  | { ok: true; cover: Cover }
  | { ok: false; reason: 'conflict'; current: Cover; baseVersion: number }
  | { ok: false; reason: 'not_found' }

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
      updatedAt: now,
      version: 1,
      verifyStatus: 'ok',
      verifyReasons: []
    }
    delete record.id

    // 新建后立即核对一次
    const route = record.routeId ? await db.routes.get(record.routeId) : null
    const pms = await Promise.all(record.cancelPmIds.map((pid) => db.postmarks.get(pid)))
    const postmarks = pms.filter((p): p is Postmark => p != null)
    const verification = verifyCover(record, route ?? null, postmarks)
    record.verifyStatus = verification.status
    record.verifyReasons = verification.reasons

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
    await load()
    return id
  }

  /**
   * 更新实寄封。若提供 baseVersion，则先做并发冲突检测：
   * DB 中当前版本与 baseVersion 不一致时返回 conflict 结果，不覆盖对方已保存的内容。
   * 更新后自动重新核对。
   */
  async function update(
    id: number,
    patch: Partial<Cover>,
    baseVersion?: number
  ): Promise<UpdateResult> {
    const current = await db.covers.get(id)
    if (!current) return { ok: false, reason: 'not_found' }

    // 并发冲突检测
    if (baseVersion != null && current.version !== baseVersion) {
      return { ok: false, reason: 'conflict', current, baseVersion }
    }

    const updated: Cover = {
      ...current,
      ...patch,
      version: current.version + 1,
      updatedAt: nowIso()
    }

    // 重新核对
    const route = updated.routeId ? await db.routes.get(updated.routeId) : null
    const pms = await Promise.all(updated.cancelPmIds.map((pid) => db.postmarks.get(pid)))
    const postmarks = pms.filter((p): p is Postmark => p != null)
    const verification = verifyCover(updated, route ?? null, postmarks)
    updated.verifyStatus = verification.status
    updated.verifyReasons = verification.reasons

    await db.covers.put(updated)
    await load()
    return { ok: true, cover: updated }
  }

  async function remove(id: number): Promise<void> {
    await db.covers.delete(id)
    const own = await db.stampEntries.where('coverId').equals(id).toArray()
    await db.stampEntries.bulkDelete(own.map((e) => e.id).filter((v): v is number => typeof v === 'number'))
    await load()
  }

  async function addEntry(input: StamplessEntry): Promise<number> {
    const id = await db.stampEntries.add({ ...input, createdAt: nowIso() })
    await load()
    return id
  }

  async function removeEntry(id: number): Promise<void> {
    await db.stampEntries.delete(id)
    await load()
  }

  /** 重新核对单封：读取其邮路与关联邮戳，更新核对状态与原因。 */
  async function reverifyCover(id: number): Promise<void> {
    const cover = await db.covers.get(id)
    if (!cover) return
    const route = cover.routeId ? await db.routes.get(cover.routeId) : null
    const pms = await Promise.all(cover.cancelPmIds.map((pid) => db.postmarks.get(pid)))
    const postmarks = pms.filter((p): p is Postmark => p != null)
    const result = verifyCover(cover, route ?? null, postmarks)
    await db.covers.update(id, {
      verifyStatus: result.status,
      verifyReasons: result.reasons
    })
  }

  /** 邮路节点变动后，重新核对挂到该邮路的所有封。 */
  async function reverifyCoversForRoute(routeId: number): Promise<void> {
    const covers = await db.covers.where('routeId').equals(routeId).toArray()
    for (const cover of covers) {
      if (cover.id != null) await reverifyCover(cover.id)
    }
    await load()
  }

  /** 邮戳年代变动后，重新核对关联了该邮戳的所有封。 */
  async function reverifyCoversForPostmark(pmId: number): Promise<void> {
    const all = await db.covers.toArray()
    const affected = all.filter((c) => c.cancelPmIds.includes(pmId))
    for (const cover of affected) {
      if (cover.id != null) await reverifyCover(cover.id)
    }
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
    remove,
    addEntry,
    removeEntry,
    reverifyCover,
    reverifyCoversForRoute,
    reverifyCoversForPostmark,
    byId,
    entriesOf,
    frankingCount,
    cancelCount
  }
})
