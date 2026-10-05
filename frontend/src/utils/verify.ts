/**
 * 实寄封核对逻辑：关联信息（邮路节点、邮戳年代）变动后重新核对。
 * 检查项：缺到达日、日期倒挂（寄出晚于到达 / 邮路节点顺序倒挂）、
 * 寄出或到达日期超出关联邮戳的使用年代。
 */
import type { Cover } from '@/types/cover'
import type { Postmark } from '@/types/postmark'
import type { PostalRoute } from '@/types/route'
import { buildTimeline } from '@/utils/timeline'
import { compareDate, isValidDate } from '@/utils/dateRange'

export interface VerifyResult {
  status: 'ok' | 'pending'
  reasons: string[]
}

/**
 * 核对一枚实寄封：结合其邮路与关联邮戳，返回核对状态与原因列表。
 * 无问题时 status 为 ok；任一检查项不通过则为 pending。
 */
export function verifyCover(
  cover: Cover,
  route: PostalRoute | null,
  postmarks: Postmark[]
): VerifyResult {
  const reasons: string[] = []

  // 缺到达日
  if (!cover.arriveDate) {
    reasons.push('缺少到达日期')
  }

  // 寄出晚于到达（日期倒挂）
  if (isValidDate(cover.postDate) && isValidDate(cover.arriveDate)) {
    if (compareDate(cover.postDate, cover.arriveDate) > 0) {
      reasons.push(`寄出日期 ${cover.postDate} 晚于到达日期 ${cover.arriveDate}，日期倒挂`)
    }
  }

  // 邮路节点日期顺序
  const timeline = buildTimeline(cover, route)
  const dated = timeline.filter((n) => isValidDate(n.date))
  for (let i = 1; i < dated.length; i += 1) {
    if (compareDate(dated[i - 1].date, dated[i].date) > 0) {
      reasons.push('邮路节点日期顺序有误，存在倒挂')
      break
    }
  }

  // 寄出 / 到达日期超出关联邮戳的使用年代
  for (const pm of postmarks) {
    const checkDates = [cover.postDate, cover.arriveDate].filter(isValidDate)
    for (const d of checkDates) {
      const year = Number(d.slice(0, 4))
      if (year < pm.yearFrom || year > pm.yearTo) {
        reasons.push(
          `寄出/到达日期 ${d} 超出关联邮戳 ${pm.pmNo} 使用年代（${pm.yearFrom}-${pm.yearTo}）`
        )
        break
      }
    }
  }

  return {
    status: reasons.length > 0 ? 'pending' : 'ok',
    reasons
  }
}
