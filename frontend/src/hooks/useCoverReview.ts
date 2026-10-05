/**
 * 实寄封核对结果的组合式封装：目录、卡片、检索页、详情页与邮路编辑器共用，
 * 保证各处对同一封的「待核对」结论与原因完全一致。
 *
 * 结果是随三个 store 列表联动的 computed：别的标签页改了邮路节点或邮戳年代，
 * store 经跨标签页通知重新加载后，所有待核对标记会立即重算。
 */
import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import type { Cover } from '@/types/cover'
import type { CoverReview } from '@/utils/review'
import { CLEAN_REVIEW, reviewCover } from '@/utils/review'
import { useCoverStore } from '@/stores/coverStore'
import { usePostmarkStore } from '@/stores/postmarkStore'
import { useRouteStore } from '@/stores/routeStore'

export interface CoverReviewMap {
  /** 按封 id 取核对结果；未登记的封返回「无问题」 */
  of: (id: number | null | undefined) => CoverReview
  /** 直接按封对象取核对结果（详情页等只持有单封的场景） */
  forCover: (cover: Cover | null) => CoverReview
  /** 待核对封的 id 集合，供目录统计 */
  pendingIds: ComputedRef<Set<number>>
  /** 待核对封数量 */
  pendingCount: ComputedRef<number>
}

export function useCoverReviews(): CoverReviewMap {
  const coverStore = useCoverStore()
  const postmarkStore = usePostmarkStore()
  const routeStore = useRouteStore()

  /** id → 核对结果，依赖三个 store 的列表，变动后整体重算。 */
  const byId = computed<Map<number, CoverReview>>(() => {
    const map = new Map<number, CoverReview>()
    for (const cover of coverStore.list) {
      if (typeof cover.id !== 'number') continue
      const route = typeof cover.routeId === 'number' ? routeStore.byId(cover.routeId) : null
      const pms = cover.cancelPmIds
        .map((id) => postmarkStore.byId(id))
        .filter((pm): pm is NonNullable<typeof pm> => pm != null)
      map.set(cover.id, reviewCover(cover, route, pms))
    }
    return map
  })

  const pendingIds = computed<Set<number>>(
    () => new Set([...byId.value].filter(([, r]) => r.needsReview).map(([id]) => id))
  )

  const pendingCount = computed(() => pendingIds.value.size)

  function of(id: number | null | undefined): CoverReview {
    if (id == null) return CLEAN_REVIEW
    return byId.value.get(id) ?? CLEAN_REVIEW
  }

  function forCover(cover: Cover | null): CoverReview {
    if (!cover || typeof cover.id !== 'number') return CLEAN_REVIEW
    const found = byId.value.get(cover.id)
    if (found) return found
    // 详情页的封可能比 store 列表更新（刚保存尚未 reload），直接按当前数据核对
    const route = typeof cover.routeId === 'number' ? routeStore.byId(cover.routeId) : null
    const pms = cover.cancelPmIds
      .map((id) => postmarkStore.byId(id))
      .filter((pm): pm is NonNullable<typeof pm> => pm != null)
    return reviewCover(cover, route, pms)
  }

  return { of, forCover, pendingIds, pendingCount }
}
