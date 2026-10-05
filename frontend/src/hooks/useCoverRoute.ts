/**
 * 由实寄封与邮路节点拼出寄递时间轴，并计算在途天数。
 * 被封详情页与邮路编辑器复用。
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { db } from '@/utils/db'
import type { Cover } from '@/types/cover'
import type { PostalRoute, TimelineNode } from '@/types/route'
import { buildTimeline } from '@/utils/timeline'
import { daysBetween, isValidDate } from '@/utils/dateRange'

// 重新导出，保持对旧调用方的兼容
export { buildTimeline } from '@/utils/timeline'

export function useCoverRoute(coverId: Ref<number | null> | ComputedRef<number | null>) {
  const cover = ref<Cover | null>(null)
  const route = ref<PostalRoute | null>(null)
  const loading = ref(false)
  const error = ref('')

  async function load(): Promise<void> {
    const id = coverId.value
    if (id == null || Number.isNaN(id)) {
      cover.value = null
      route.value = null
      error.value = id == null ? '' : '封号无效'
      return
    }
    loading.value = true
    try {
      const found = await db.covers.get(id)
      cover.value = found ?? null
      error.value = found ? '' : `未找到编号为 ${id} 的实寄封`
      if (found && typeof found.routeId === 'number') {
        const rt = await db.routes.get(found.routeId)
        route.value = rt ?? null
      } else {
        route.value = null
      }
    } finally {
      loading.value = false
    }
  }

  watch(coverId, () => void load(), { immediate: true })

  const timeline = computed<TimelineNode[]>(() => buildTimeline(cover.value, route.value))

  /** 在途天数：寄出日期 → 到达日期 */
  const transitDays = computed<number | null>(() => {
    if (!cover.value) return null
    return daysBetween(cover.value.postDate, cover.value.arriveDate)
  })

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

  return { cover, route, timeline, transitDays, missingDateNodes, chronological, loading, error, load }
}
