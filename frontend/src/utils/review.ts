/**
 * 实寄封核对：关联信息（邮路节点、邮戳年代、寄出/到达日期）一旦变动，
 * 按当前数据重新核对每一封实寄封。核对不通过时，目录与详情把该封标为
 * 「待核对」并写明原因，旧的在途天数不再展示。
 *
 * 核对规则（覆盖需求点名的三类问题）：
 *  1. 日期倒挂：寄出/中转/到达中，任一已填日期早于前面的节点日期；
 *  2. 缺到达日：到达（或寄出）日期缺失，无法形成完整寄递过程；
 *  3. 超出戳年代：寄出或到达日期不在任一关联邮戳的使用年代区间内；
 *  4. 缺节点日期：所挂邮路存在没有日期的节点，时间轴不完整。
 */
import type { Cover } from '@/types/cover'
import type { Postmark } from '@/types/postmark'
import type { PostalRoute, TimelineNode } from '@/types/route'
import { isValidDate } from '@/utils/dateRange'
import { buildTimeline } from '@/utils/timeline'

/** 待核对项的类别，决定目录徽标与详情色块 */
export type ReviewCode =
  | 'dates-reversed'
  | 'missing-sent-date'
  | 'missing-arrive-date'
  | 'missing-node-date'
  | 'out-of-postmark-era'

export type ReviewSeverity = 'error' | 'warning'

export interface ReviewIssue {
  code: ReviewCode
  severity: ReviewSeverity
  /** 写明的中文原因，直接展示给收藏者 */
  message: string
}

export interface CoverReview {
  /** 是否有待核对项；true 时详情与目录标「待核对」，在途天数不再展示 */
  needsReview: boolean
  issues: ReviewIssue[]
  /** 合并后的原因文案，供目录行/卡片的 tooltip 使用 */
  summary: string
}

/** 没有问题时的复用结果。 */
export const CLEAN_REVIEW: CoverReview = { needsReview: false, issues: [], summary: '' }

/** 时间轴中第一个出现倒挂的相邻已填节点，返回倒挂的两段说明；无倒挂返回 null。 */
function findReversal(nodes: TimelineNode[]): { earlier: TimelineNode; later: TimelineNode } | null {
  let prev: TimelineNode | null = null
  for (const node of nodes) {
    if (!isValidDate(node.date)) continue
    if (prev && prev.date > node.date) return { earlier: prev, later: node }
    prev = node
  }
  return null
}

/** 取日期的公元年；非合法日期返回 null。 */
function yearOf(date: string): number | null {
  if (!isValidDate(date)) return null
  return Number(date.slice(0, 4))
}

function postmarkLabel(pm: Postmark): string {
  return `${pm.pmNo} ${pm.office}（${pm.yearFrom}-${pm.yearTo}）`
}

/** 单枚邮戳的年代区间文案。 */
function eraText(pm: Postmark): string {
  return pm.yearFrom === pm.yearTo ? `${pm.yearFrom} 年` : `${pm.yearFrom}-${pm.yearTo} 年`
}

/**
 * 核对一封实寄封。所有判断都基于传入的「当前」封、所挂邮路、关联邮戳，
 * 因此邮路节点或邮戳年代在别的标签页被改动后，重新调用即可得到新结论。
 */
export function reviewCover(
  cover: Cover | null,
  route: PostalRoute | null,
  postmarks: Postmark[]
): CoverReview {
  if (!cover) return CLEAN_REVIEW
  const issues: ReviewIssue[] = []
  const timeline = buildTimeline(cover, route)

  // 规则 1：日期倒挂（寄出 → 中转 → 到达 中任一相邻已填节点逆序）
  const reversal = findReversal(timeline)
  if (reversal) {
    issues.push({
      code: 'dates-reversed',
      severity: 'error',
      message: `日期倒挂：${reversal.earlier.office}（${reversal.earlier.date}）晚于 ${reversal.later.office}（${reversal.later.date}），请核对寄递顺序`
    })
  }

  // 规则 2：缺寄出/到达日
  if (!isValidDate(cover.postDate)) {
    issues.push({
      code: 'missing-sent-date',
      severity: 'warning',
      message: '缺寄出日期，无法核对寄递过程与在途天数'
    })
  }
  if (!isValidDate(cover.arriveDate)) {
    issues.push({
      code: 'missing-arrive-date',
      severity: 'warning',
      message: '缺到达日期，无法核对在途天数'
    })
  }

  // 规则 4：所挂邮路有节点缺日期
  if (route) {
    const missing = route.nodes.filter((n) => !isValidDate(n.arriveDate))
    if (missing.length) {
      issues.push({
        code: 'missing-node-date',
        severity: 'warning',
        message: `邮路 ${route.routeNo} 节点缺日期：${missing.map((n) => n.office || '节点待补').join('、')}`
      })
    }
  }

  // 规则 3：寄出/到达日期超出关联邮戳的使用年代
  const checkDateAgainstEra = (date: string, label: string) => {
    const year = yearOf(date)
    if (year == null) return
    for (const pm of postmarks) {
      if (year < pm.yearFrom || year > pm.yearTo) {
        issues.push({
          code: 'out-of-postmark-era',
          severity: 'error',
          message: `${label}日期 ${date} 超出关联邮戳 ${postmarkLabel(pm)} 的使用年代（${eraText(pm)}）`
        })
      }
    }
  }
  checkDateAgainstEra(cover.postDate, '寄出')
  checkDateAgainstEra(cover.arriveDate, '到达')

  if (!issues.length) return CLEAN_REVIEW
  return {
    needsReview: true,
    issues,
    summary: issues.map((i) => i.message).join('；')
  }
}
