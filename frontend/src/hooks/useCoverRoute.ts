/**
 * 由实寄封与邮路节点拼出寄递时间轴，并计算在途天数。
 * 被封详情页与邮路编辑器复用。
 *
 * 跨标签页：本标签页打开详情期间，若另一个标签页改动了该封、其所属邮路或
 * 关联邮戳（节点日期、戳年代等），会收到广播并自动重新读取、重算核对结论，
 * 不会继续停在旧数字上。
 */
import { computed, onUnmounted, ref, watch, type ComputedRef, type Ref } from 'vue'
import { db } from '@/utils/db'
import { onCatalogChange } from '@/utils/catalogEvents'
import { reviewCover, type CoverReview } from '@/utils/review'
import { buildTimeline } from '@/utils/timeline'
import type { Cover } from '@/types/cover'
import type { PostalRoute, TimelineNode } from '@/types/route'
import type { Postmark } from '@/types/postmark'
import { daysBetween, isValidDate } from '@/utils/dateRange'

export { buildTimeline }

export function useCoverRoute(coverId: Ref<number | null> | ComputedRef<number | null>) {
  const cover = ref<Cover | null>(null)
  const route = ref<PostalRoute | null>(null)
  const postmarks = ref<Postmark[]>([])
  const loading = ref(false)
  const error = ref('')

  async function load(): Promise<void> {
    const id = coverId.value
    if (id == null || Number.isNaN(id)) {
      cover.value = null
      route.value = null
      postmarks.value = []
      error.value = id == null ? '' : '封号无效'
      return
    }
    loading.value = true
    try {
      const found = await db.covers.get(id)
      cover.value = found ?? null
      error.value = found ? '' : `未找到编号为 ${id} 的实寄封`
      if (found && typeof found.routeId === 'number') {
        route.value = (await db.routes.get(found.routeId)) ?? null
      } else {
        route.value = null
      }
      if (found) {
        const pms = await Promise.all(found.cancelPmIds.map((pmId) => db.postmarks.get(pmId)))
        postmarks.value = pms.filter((pm): pm is Postmark => pm != null)
      } else {
        postmarks.value = []
      }
    } finally {
      loading.value = false
    }
  }

  watch(coverId, () => void load(), { immediate: true })

  // 其他标签页改动了该封本身 / 任意邮路（含其所属邮路节点）/ 任意邮戳（含戳年代）
  // 时，按当前库中数据重新读取并重算。邮戳、邮路无法在本地预先判断是否被本封引用，
  // 收到相关广播直接重读本封即可（单条主键查询，开销可忽略）。
  const offChange = onCatalogChange((message) => {
    const id = coverId.value
    if (id == null) return
    if (message.entity === 'cover' && message.id != null && message.id !== id) return
    void load()
  })

  onUnmounted(offChange)

  const timeline = computed<TimelineNode[]>(() => buildTimeline(cover.value, route.value))

  /**
   * 在途天数（寄出 → 到达）。注意：待核对时不应展示旧数字，
   * 页面应改用 transitDaysDisplay / review 判断是否展示。
   */
  const transitDays = computed<number | null>(() => {
    if (!cover.value) return null
    return daysBetween(cover.value.postDate, cover.value.arriveDate)
  })

  /** 核对结论：日期倒挂、缺到达日、超出戳年代、缺节点日期等。 */
  const review = computed<CoverReview>(() =>
    reviewCover(cover.value, route.value, postmarks.value)
  )

  /**
   * 仅在核对无误时给出在途天数；待核对一律为 null，
   * 详情/目录据此显示「待核对」而不是旧的在途天数。
   */
  const trustedTransitDays = computed<number | null>(() =>
    review.value.needsReview ? null : transitDays.value
  )

  /** 缺少日期的节点，供缺日警示使用 */
  const missingDateNodes = computed<TimelineNode[]>(() =>
    timeline.value.filter((n) => !isValidDate(n.date))
  )

  /** 节点日期是否单调不减 */
  const chronological = computed<boolean>(() => {
    const dated = timeline.value.filter((n) => isValidDate(n.date))
    for (let i = 1; i < dated.length; i += 1) {
      if (dated[i - 1].date > dated[i].date) return false
    }
    return true
  })

  return {
    cover,
    route,
    postmarks,
    timeline,
    transitDays,
    trustedTransitDays,
    review,
    missingDateNodes,
    chronological,
    loading,
    error,
    load
  }
}
