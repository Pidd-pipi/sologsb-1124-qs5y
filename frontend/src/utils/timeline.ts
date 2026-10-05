/**
 * 由实寄封与邮路节点拼出寄递时间轴。
 * 被封详情页、邮路编辑器与核对逻辑复用。
 */
import type { Cover } from '@/types/cover'
import type { PostalRoute, TimelineNode } from '@/types/route'

/** 由封与邮路拼时间轴：寄出 → 中转（邮路节点 / 中转地） → 到达。 */
export function buildTimeline(cover: Cover | null, route: PostalRoute | null): TimelineNode[] {
  if (!cover) return []
  const nodes: TimelineNode[] = [
    {
      key: 'sent',
      label: '寄出',
      office: cover.sentFrom || '寄出地待考',
      date: cover.postDate,
      mark: '收寄日戳',
      kind: 'sent'
    }
  ]

  const transit: TimelineNode[] = []
  if (route && route.nodes.length) {
    for (const node of route.nodes) {
      const isFirst = node.office === cover.sentFrom
      const isLast = node.office === cover.sentTo
      if (isFirst) continue
      transit.push({
        key: node.key,
        label: isLast ? '到达' : '中转',
        office: node.office || '节点待补',
        date: node.arriveDate,
        mark: node.transitMark || '中转戳待补',
        kind: isLast ? 'arrive' : 'transit'
      })
    }
  } else {
    cover.viaPoints.forEach((point, index) => {
      transit.push({
        key: `via-${index}`,
        label: '中转',
        office: point,
        date: '',
        mark: '中转戳待考',
        kind: 'transit'
      })
    })
  }

  const hasArrive = transit.some((n) => n.kind === 'arrive')
  nodes.push(...transit)
  if (!hasArrive) {
    nodes.push({
      key: 'arrive',
      label: '到达',
      office: cover.sentTo || '收件地待考',
      date: cover.arriveDate,
      mark: '到达戳',
      kind: 'arrive'
    })
  } else {
    const last = nodes[nodes.length - 1]
    if (!last.date && cover.arriveDate) last.date = cover.arriveDate
  }
  return nodes
}
