import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { db, saveAsset } from '@/utils/db'
import { emitChange } from '@/utils/catalogEvents'
import type { Postmark } from '@/types/postmark'
import { nextSerialNo, nowIso } from '@/utils/id'

export interface ImagePayload {
  dataUrl: string
  fileName: string
}

export const usePostmarkStore = defineStore('postmark', () => {
  const list = ref<Postmark[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      list.value = await db.postmarks.orderBy('pmNo').toArray()
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  /** 生成下一个编目号，如 PM-0007 */
  function nextPmNo(): string {
    return nextSerialNo('PM-', list.value.map((p) => p.pmNo))
  }

  async function create(input: Postmark, image?: ImagePayload | null): Promise<number> {
    const now = nowIso()
    const record: Postmark = {
      ...input,
      pmNo: input.pmNo || nextPmNo(),
      lettering: { ...input.lettering },
      createdAt: now,
      updatedAt: now
    }
    delete record.id
    const id = await db.postmarks.add(record)
    if (image && image.dataUrl) {
      await saveAsset({
        ownerType: 'postmark',
        ownerId: id,
        side: 'sample',
        dataUrl: image.dataUrl,
        fileName: image.fileName,
        updatedAt: now
      })
    }
    emitChange('postmark', id)
    await load()
    return id
  }

  async function update(id: number, patch: Partial<Postmark>): Promise<void> {
    await db.postmarks.update(id, { ...patch, updatedAt: nowIso() })
    emitChange('postmark', id)
    await load()
  }

  /**
   * 带并发校验的邮戳整表保存：库中 updatedAt 与本标签页所持版本不一致时，
   * 返回 conflict 并带回对方版本，不覆盖。
   */
  async function checkedUpdate(
    id: number,
    record: Postmark,
    baseUpdatedAt: string
  ): Promise<{ savedAt: string } | { conflict: boolean; current: Postmark | null }> {
    return db.transaction('rw', db.postmarks, async () => {
      const current = await db.postmarks.get(id)
      if (!current) return { conflict: true, current: null }
      if (current.updatedAt !== baseUpdatedAt) return { conflict: true, current }
      const savedAt = nowIso()
      const next: Postmark = {
        ...record,
        id,
        pmNo: current.pmNo,
        createdAt: current.createdAt,
        updatedAt: savedAt
      }
      await db.postmarks.put(next)
      emitChange('postmark', id)
      return { savedAt }
    })
  }

  async function remove(id: number): Promise<void> {
    await db.postmarks.delete(id)
    emitChange('postmark', id)
    await load()
  }

  function byId(id: number | null | undefined): Postmark | null {
    if (id == null) return null
    return list.value.find((p) => p.id === id) ?? null
  }

  /** 「编目号 + 局所」短标签，供关联列表与详情页复用 */
  const labelOf = computed(() => {
    return (id: number): string => {
      const pm = byId(id)
      return pm ? `${pm.pmNo} ${pm.office}` : `未登记邮戳 #${id}`
    }
  })

  const total = computed(() => list.value.length)
  const scarceCount = computed(
    () => list.value.filter((p) => p.scarceLevel === '罕见' || p.scarceLevel === '孤品').length
  )

  return {
    list,
    loading,
    loaded,
    total,
    scarceCount,
    load,
    nextPmNo,
    create,
    update,
    checkedUpdate,
    remove,
    byId,
    labelOf
  }
})
